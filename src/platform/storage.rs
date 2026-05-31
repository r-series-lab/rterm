use std::fs;
use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::RngCore;
use rusqlite::{Connection, OptionalExtension, params};

use crate::platform::bookmarks::{FavoriteRecord, RecentConnectionRecord};
use crate::platform::paths::resolve_app_paths;

const DATABASE_FILE: &str = "rterm.sqlite";
#[cfg(not(test))]
const MASTER_KEY_SERVICE: &str = "rterm.sqlite-master-key";
#[cfg(not(test))]
const MASTER_KEY_ACCOUNT: &str = "default";
#[cfg(not(test))]
const FALLBACK_MASTER_KEY_FILE: &str = "sqlite-master-key.local";
const LEGACY_MIGRATION_KEY: &str = "legacy-bookmarks-migrated";

#[derive(Debug, Clone)]
pub struct Storage {
    db_path: PathBuf,
}

impl Storage {
    pub fn new(db_path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create storage directory: {error}"))?;
        }

        let storage = Self { db_path };
        storage.init_schema()?;
        Ok(storage)
    }

    pub fn new_default() -> Result<Self, String> {
        Self::new(default_storage_path())
    }

    pub fn db_path(&self) -> &Path {
        self.db_path.as_path()
    }

    fn open(&self) -> Result<Connection, String> {
        Connection::open(self.db_path.as_path())
            .map_err(|error| format!("failed to open SQLite storage: {error}"))
    }

    fn init_schema(&self) -> Result<(), String> {
        let connection = self.open()?;
        connection
            .execute_batch(
                r#"
                PRAGMA journal_mode = WAL;
                PRAGMA foreign_keys = ON;

                CREATE TABLE IF NOT EXISTS app_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS recent_connections (
                    id TEXT PRIMARY KEY,
                    host TEXT NOT NULL,
                    port INTEGER,
                    path TEXT NOT NULL,
                    protocol TEXT NOT NULL,
                    last_connected_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS favorites (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    host TEXT NOT NULL,
                    port INTEGER,
                    path TEXT NOT NULL,
                    paths TEXT NOT NULL DEFAULT '[]',
                    protocol TEXT NOT NULL,
                    username TEXT,
                    terminal_profile TEXT NOT NULL DEFAULT 'auto',
                    legacy_ssh_host_key_algorithms INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS favorite_passwords (
                    favorite_id TEXT PRIMARY KEY,
                    nonce BLOB NOT NULL,
                    ciphertext BLOB NOT NULL,
                    updated_at INTEGER NOT NULL,
                    FOREIGN KEY(favorite_id) REFERENCES favorites(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_recent_connections_last_connected
                    ON recent_connections(last_connected_at DESC);
                CREATE INDEX IF NOT EXISTS idx_favorites_updated_at
                    ON favorites(updated_at DESC);
                "#,
            )
            .map_err(|error| format!("failed to initialize SQLite schema: {error}"))?;
        ensure_column(
            &connection,
            "favorites",
            "paths",
            "TEXT NOT NULL DEFAULT '[]'",
        )?;
        ensure_column(
            &connection,
            "favorites",
            "terminal_profile",
            "TEXT NOT NULL DEFAULT 'auto'",
        )?;
        Ok(())
    }

    pub fn is_legacy_migrated(&self) -> Result<bool, String> {
        let connection = self.open()?;
        let value: Option<String> = connection
            .query_row(
                "SELECT value FROM app_meta WHERE key = ?1",
                params![LEGACY_MIGRATION_KEY],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("failed to read migration state: {error}"))?;

        Ok(value.as_deref() == Some("1"))
    }

    pub fn mark_legacy_migrated(&self, now: u64) -> Result<(), String> {
        let connection = self.open()?;
        connection
            .execute(
                r#"
                INSERT INTO app_meta(key, value, updated_at)
                VALUES (?1, '1', ?2)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
                "#,
                params![LEGACY_MIGRATION_KEY, now as i64],
            )
            .map_err(|error| format!("failed to save migration state: {error}"))?;
        Ok(())
    }

    pub fn list_recent_connections(
        &self,
        limit: usize,
    ) -> Result<Vec<RecentConnectionRecord>, String> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                r#"
                SELECT id, host, port, path, protocol, last_connected_at
                FROM recent_connections
                ORDER BY last_connected_at DESC
                LIMIT ?1
                "#,
            )
            .map_err(|error| format!("failed to prepare recent connection query: {error}"))?;

        let rows = statement
            .query_map(params![limit as i64], |row| {
                Ok(RecentConnectionRecord {
                    id: row.get(0)?,
                    host: row.get(1)?,
                    port: optional_u16(row.get::<_, Option<i64>>(2)?),
                    path: row.get(3)?,
                    protocol: row.get(4)?,
                    last_connected_at: row.get::<_, i64>(5)? as u64,
                })
            })
            .map_err(|error| format!("failed to read recent connections: {error}"))?;

        collect_rows(rows, "recent connections")
    }

    pub fn save_recent_connection(
        &self,
        record: &RecentConnectionRecord,
        limit: usize,
    ) -> Result<Vec<RecentConnectionRecord>, String> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("failed to open recent connection transaction: {error}"))?;
        transaction
            .execute(
                r#"
                INSERT INTO recent_connections(id, host, port, path, protocol, last_connected_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                ON CONFLICT(id) DO UPDATE SET
                    host = excluded.host,
                    port = excluded.port,
                    path = excluded.path,
                    protocol = excluded.protocol,
                    last_connected_at = excluded.last_connected_at
                "#,
                params![
                    record.id,
                    record.host,
                    record.port.map(i64::from),
                    record.path,
                    record.protocol,
                    record.last_connected_at as i64,
                ],
            )
            .map_err(|error| format!("failed to save recent connection: {error}"))?;
        prune_recent_connections(&transaction, limit)?;
        transaction
            .commit()
            .map_err(|error| format!("failed to commit recent connection: {error}"))?;

        self.list_recent_connections(limit)
    }

    pub fn import_recent_connections(
        &self,
        records: &[RecentConnectionRecord],
        limit: usize,
    ) -> Result<(), String> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("failed to open recent import transaction: {error}"))?;

        for record in records {
            transaction
                .execute(
                    r#"
                    INSERT INTO recent_connections(id, host, port, path, protocol, last_connected_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                    ON CONFLICT(id) DO UPDATE SET
                        host = excluded.host,
                        port = excluded.port,
                        path = excluded.path,
                        protocol = excluded.protocol,
                        last_connected_at = MAX(recent_connections.last_connected_at, excluded.last_connected_at)
                    "#,
                    params![
                        record.id,
                        record.host,
                        record.port.map(i64::from),
                        record.path,
                        record.protocol,
                        record.last_connected_at as i64,
                    ],
                )
                .map_err(|error| format!("failed to import recent connection: {error}"))?;
        }

        prune_recent_connections(&transaction, limit)?;
        transaction
            .commit()
            .map_err(|error| format!("failed to commit recent import: {error}"))?;
        Ok(())
    }

    pub fn remove_recent_connection(
        &self,
        id: &str,
        limit: usize,
    ) -> Result<Vec<RecentConnectionRecord>, String> {
        let connection = self.open()?;
        connection
            .execute("DELETE FROM recent_connections WHERE id = ?1", params![id])
            .map_err(|error| format!("failed to remove recent connection: {error}"))?;
        self.list_recent_connections(limit)
    }

    pub fn list_favorites(&self) -> Result<Vec<FavoriteRecord>, String> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                r#"
                SELECT id, name, host, port, path, paths, protocol, username, terminal_profile,
                       legacy_ssh_host_key_algorithms
                FROM favorites
                ORDER BY created_at ASC, name ASC
                "#,
            )
            .map_err(|error| format!("failed to prepare favorites query: {error}"))?;

        let rows = statement
            .query_map([], |row| {
                Ok(FavoriteRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    port: optional_u16(row.get::<_, Option<i64>>(3)?),
                    path: row.get(4)?,
                    paths: decode_paths(row.get::<_, String>(5)?),
                    protocol: row.get(6)?,
                    username: row.get(7)?,
                    password: None,
                    terminal_profile: row.get(8)?,
                    legacy_ssh_host_key_algorithms: row.get::<_, i64>(9)? != 0,
                })
            })
            .map_err(|error| format!("failed to read favorites: {error}"))?;

        let mut records = collect_rows(rows, "favorites")?;
        for record in &mut records {
            record.password = self.load_favorite_password(record.id.as_str())?;
        }
        Ok(records)
    }

    pub fn import_favorites(&self, records: &[FavoriteRecord], now: u64) -> Result<(), String> {
        for record in records {
            self.save_favorite(record, record.password.is_some(), now)?;
        }
        Ok(())
    }

    pub fn save_favorite(
        &self,
        record: &FavoriteRecord,
        password_update_requested: bool,
        now: u64,
    ) -> Result<Vec<FavoriteRecord>, String> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("failed to open favorite transaction: {error}"))?;
        transaction
            .execute(
                r#"
                INSERT INTO favorites(
                    id, name, host, port, path, paths, protocol, username,
                    terminal_profile, legacy_ssh_host_key_algorithms, created_at, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    host = excluded.host,
                    port = excluded.port,
                    path = excluded.path,
                    paths = excluded.paths,
                    protocol = excluded.protocol,
                    username = excluded.username,
                    terminal_profile = excluded.terminal_profile,
                    legacy_ssh_host_key_algorithms = excluded.legacy_ssh_host_key_algorithms,
                    updated_at = excluded.updated_at
                "#,
                params![
                    record.id,
                    record.name,
                    record.host,
                    record.port.map(i64::from),
                    record.path,
                    encode_paths(record.paths.as_slice()),
                    record.protocol,
                    record.username,
                    record.terminal_profile,
                    bool_to_i64(record.legacy_ssh_host_key_algorithms),
                    now as i64,
                ],
            )
            .map_err(|error| format!("failed to save favorite: {error}"))?;

        if password_update_requested {
            if let Some(password) = record.password.as_deref() {
                let encrypted = encrypt_password(password)?;
                transaction
                    .execute(
                        r#"
                        INSERT INTO favorite_passwords(favorite_id, nonce, ciphertext, updated_at)
                        VALUES (?1, ?2, ?3, ?4)
                        ON CONFLICT(favorite_id) DO UPDATE SET
                            nonce = excluded.nonce,
                            ciphertext = excluded.ciphertext,
                            updated_at = excluded.updated_at
                        "#,
                        params![record.id, encrypted.nonce, encrypted.ciphertext, now as i64],
                    )
                    .map_err(|error| {
                        format!("failed to save encrypted favorite password: {error}")
                    })?;
            } else {
                transaction
                    .execute(
                        "DELETE FROM favorite_passwords WHERE favorite_id = ?1",
                        params![record.id],
                    )
                    .map_err(|error| format!("failed to clear favorite password: {error}"))?;
            }
        }

        transaction
            .commit()
            .map_err(|error| format!("failed to commit favorite: {error}"))?;
        self.list_favorites()
    }

    pub fn load_favorite_password(&self, id: &str) -> Result<Option<String>, String> {
        let connection = self.open()?;
        let encrypted: Option<EncryptedPassword> = connection
            .query_row(
                "SELECT nonce, ciphertext FROM favorite_passwords WHERE favorite_id = ?1",
                params![id],
                |row| {
                    Ok(EncryptedPassword {
                        nonce: row.get(0)?,
                        ciphertext: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("failed to read encrypted favorite password: {error}"))?;

        let Some(encrypted) = encrypted else {
            return Ok(None);
        };

        match decrypt_password(&encrypted) {
            Ok(password) => Ok(Some(password)),
            Err(error) if should_clear_unreadable_password(error.as_str()) => {
                connection
                    .execute(
                        "DELETE FROM favorite_passwords WHERE favorite_id = ?1",
                        params![id],
                    )
                    .map_err(|delete_error| {
                        format!(
                            "{error}; failed to clear unreadable favorite password: {delete_error}"
                        )
                    })?;
                Ok(None)
            }
            Err(error) => Err(error),
        }
    }

    pub fn remove_favorite(&self, id: &str) -> Result<Vec<FavoriteRecord>, String> {
        let connection = self.open()?;
        connection
            .execute("DELETE FROM favorites WHERE id = ?1", params![id])
            .map_err(|error| format!("failed to remove favorite: {error}"))?;
        Ok(self.list_favorites()?)
    }

    pub fn rename_favorite(
        &self,
        id: &str,
        name: &str,
        now: u64,
    ) -> Result<Vec<FavoriteRecord>, String> {
        let connection = self.open()?;
        let changed = connection
            .execute(
                "UPDATE favorites SET name = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, name, now as i64],
            )
            .map_err(|error| format!("failed to rename favorite: {error}"))?;
        if changed == 0 {
            return Err(String::from("favorite not found"));
        }
        self.list_favorites()
    }
}

#[derive(Debug)]
struct EncryptedPassword {
    nonce: Vec<u8>,
    ciphertext: Vec<u8>,
}

fn default_storage_path() -> PathBuf {
    PathBuf::from(resolve_app_paths().data_dir).join(DATABASE_FILE)
}

fn bool_to_i64(value: bool) -> i64 {
    if value { 1 } else { 0 }
}

fn optional_u16(value: Option<i64>) -> Option<u16> {
    value.and_then(|value| u16::try_from(value).ok())
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(format!("PRAGMA table_info({table})").as_str())
        .map_err(|error| format!("failed to inspect {table} schema: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("failed to read {table} columns: {error}"))?;
    let columns = collect_rows(rows, "table columns")?;
    if columns.iter().any(|name| name == column) {
        return Ok(());
    }

    connection
        .execute(
            format!("ALTER TABLE {table} ADD COLUMN {column} {definition}").as_str(),
            [],
        )
        .map_err(|error| format!("failed to migrate {table}.{column}: {error}"))?;
    Ok(())
}

fn encode_paths(paths: &[String]) -> String {
    serde_json::to_string(paths).unwrap_or_else(|_| String::from("[]"))
}

fn decode_paths(value: String) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(value.as_str()).unwrap_or_default()
}

fn collect_rows<T>(
    rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>>,
    label: &str,
) -> Result<Vec<T>, String> {
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to collect {label}: {error}"))
}

fn prune_recent_connections(connection: &Connection, limit: usize) -> Result<(), String> {
    if limit == 0 {
        connection
            .execute("DELETE FROM recent_connections", [])
            .map_err(|error| format!("failed to prune recent connections: {error}"))?;
        return Ok(());
    }

    connection
        .execute(
            r#"
            DELETE FROM recent_connections
            WHERE id NOT IN (
                SELECT id FROM recent_connections
                ORDER BY last_connected_at DESC
                LIMIT ?1
            )
            "#,
            params![limit as i64],
        )
        .map_err(|error| format!("failed to prune recent connections: {error}"))?;
    Ok(())
}

fn encrypt_password(password: &str) -> Result<EncryptedPassword, String> {
    let key = load_or_create_master_key()?;
    let cipher = Aes256Gcm::new_from_slice(key.as_slice())
        .map_err(|error| format!("failed to initialize password cipher: {error}"))?;
    let mut nonce = [0_u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), password.as_bytes())
        .map_err(|error| format!("failed to encrypt favorite password: {error}"))?;

    Ok(EncryptedPassword {
        nonce: nonce.to_vec(),
        ciphertext,
    })
}

fn decrypt_password(value: &EncryptedPassword) -> Result<String, String> {
    let key = load_or_create_master_key()?;
    let cipher = Aes256Gcm::new_from_slice(key.as_slice())
        .map_err(|error| format!("failed to initialize password cipher: {error}"))?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(value.nonce.as_slice()),
            value.ciphertext.as_slice(),
        )
        .map_err(|error| format!("failed to decrypt favorite password: {error}"))?;

    String::from_utf8(plaintext)
        .map_err(|error| format!("favorite password is not valid UTF-8: {error}"))
}

fn should_clear_unreadable_password(error: &str) -> bool {
    error.starts_with("failed to decrypt favorite password:")
        || error.starts_with("favorite password is not valid UTF-8:")
}

#[cfg(not(test))]
fn load_or_create_master_key() -> Result<[u8; 32], String> {
    use keyring::{Entry, Error as KeyringError};

    match Entry::new(MASTER_KEY_SERVICE, MASTER_KEY_ACCOUNT) {
        Ok(entry) => match entry.get_password() {
            Ok(value) => parse_hex_key(value.as_str()),
            Err(KeyringError::NoEntry) => {
                let key = generate_master_key();
                match entry.set_password(hex_encode(key.as_slice()).as_str()) {
                    Ok(()) => Ok(key),
                    Err(_) => load_or_create_fallback_master_key(),
                }
            }
            Err(_) => load_or_create_fallback_master_key(),
        },
        Err(_) => load_or_create_fallback_master_key(),
    }
}

#[cfg(test)]
fn load_or_create_master_key() -> Result<[u8; 32], String> {
    Ok([7_u8; 32])
}

#[cfg(not(test))]
fn generate_master_key() -> [u8; 32] {
    let mut key = [0_u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut key);
    key
}

#[cfg(not(test))]
fn load_or_create_fallback_master_key() -> Result<[u8; 32], String> {
    let path = PathBuf::from(resolve_app_paths().data_dir).join(FALLBACK_MASTER_KEY_FILE);
    if path.exists() {
        let raw = fs::read_to_string(path.as_path())
            .map_err(|error| format!("failed to read fallback SQLite master key: {error}"))?;
        return parse_hex_key(raw.trim());
    }

    let key = generate_master_key();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create fallback master key directory: {error}"))?;
    }
    fs::write(path.as_path(), hex_encode(key.as_slice()))
        .map_err(|error| format!("failed to write fallback SQLite master key: {error}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let _ = fs::set_permissions(path.as_path(), fs::Permissions::from_mode(0o600));
    }

    Ok(key)
}

#[cfg(not(test))]
fn parse_hex_key(value: &str) -> Result<[u8; 32], String> {
    let bytes = hex_decode(value)?;
    bytes
        .try_into()
        .map_err(|_| String::from("SQLite master key has invalid length"))
}

#[cfg(not(test))]
fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

#[cfg(not(test))]
fn hex_decode(value: &str) -> Result<Vec<u8>, String> {
    let trimmed = value.trim();
    if !trimmed.len().is_multiple_of(2) {
        return Err(String::from("hex value has odd length"));
    }

    let mut bytes = Vec::with_capacity(trimmed.len() / 2);
    let raw = trimmed.as_bytes();
    for index in (0..raw.len()).step_by(2) {
        let high = hex_nibble(raw[index])?;
        let low = hex_nibble(raw[index + 1])?;
        bytes.push((high << 4) | low);
    }
    Ok(bytes)
}

#[cfg(not(test))]
fn hex_nibble(value: u8) -> Result<u8, String> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err(String::from("hex value contains invalid character")),
    }
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn stores_favorites_and_encrypted_passwords() {
        let temp_dir = tempdir().expect("tempdir");
        let storage = Storage::new(temp_dir.path().join("rterm.sqlite")).expect("storage");
        let favorite = FavoriteRecord {
            id: String::from("SFTP:files.internal:/release"),
            name: String::from("发布目录"),
            host: String::from("files.internal"),
            port: Some(22),
            path: String::from("/release"),
            paths: vec![String::from("/release"), String::from("/release/archive")],
            protocol: String::from("SFTP"),
            username: Some(String::from("deploy")),
            password: Some(String::from("secret-123")),
            terminal_profile: String::from("bash"),
            legacy_ssh_host_key_algorithms: false,
        };

        let records = storage
            .save_favorite(&favorite, true, 100)
            .expect("save favorite");

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].password.as_deref(), Some("secret-123"));

        let raw = fs::read(temp_dir.path().join("rterm.sqlite")).expect("read db");
        assert!(!String::from_utf8_lossy(raw.as_slice()).contains("secret-123"));
    }

    #[test]
    fn keeps_saved_password_when_updating_favorite_metadata() {
        let temp_dir = tempdir().expect("tempdir");
        let storage = Storage::new(temp_dir.path().join("rterm.sqlite")).expect("storage");
        let favorite = FavoriteRecord {
            id: String::from("SFTP:files.internal:/release"),
            name: String::from("发布目录"),
            host: String::from("files.internal"),
            port: Some(22),
            path: String::from("/release"),
            paths: vec![String::from("/release")],
            protocol: String::from("SFTP"),
            username: Some(String::from("deploy")),
            password: Some(String::from("secret-123")),
            terminal_profile: String::from("bash"),
            legacy_ssh_host_key_algorithms: false,
        };

        storage
            .save_favorite(&favorite, true, 100)
            .expect("save favorite with password");

        let records = storage
            .save_favorite(
                &FavoriteRecord {
                    name: String::from("发布目录 2"),
                    password: None,
                    ..favorite
                },
                false,
                101,
            )
            .expect("update favorite metadata");

        assert_eq!(records[0].password.as_deref(), Some("secret-123"));
    }

    #[test]
    fn clears_unreadable_favorite_passwords_without_blocking_save() {
        let temp_dir = tempdir().expect("tempdir");
        let storage = Storage::new(temp_dir.path().join("rterm.sqlite")).expect("storage");
        let favorite = FavoriteRecord {
            id: String::from("SFTP:files.internal:/release"),
            name: String::from("发布目录"),
            host: String::from("files.internal"),
            port: Some(22),
            path: String::from("/release"),
            paths: vec![String::from("/release")],
            protocol: String::from("SFTP"),
            username: Some(String::from("deploy")),
            password: None,
            terminal_profile: String::from("bash"),
            legacy_ssh_host_key_algorithms: false,
        };

        storage
            .save_favorite(&favorite, false, 100)
            .expect("save favorite");
        storage
            .open()
            .expect("open db")
            .execute(
                r#"
                INSERT INTO favorite_passwords(favorite_id, nonce, ciphertext, updated_at)
                VALUES (?1, ?2, ?3, ?4)
                "#,
                params![favorite.id, vec![0_u8; 12], vec![1_u8; 16], 101_i64],
            )
            .expect("insert unreadable password");

        let records = storage
            .save_favorite(
                &FavoriteRecord {
                    name: String::from("发布目录 2"),
                    ..favorite.clone()
                },
                false,
                102,
            )
            .expect("save favorite with unreadable old password");

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].password, None);

        let remaining: i64 = storage
            .open()
            .expect("open db")
            .query_row(
                "SELECT COUNT(*) FROM favorite_passwords WHERE favorite_id = ?1",
                params![favorite.id],
                |row| row.get(0),
            )
            .expect("count unreadable password rows");
        assert_eq!(remaining, 0);
    }

    #[test]
    fn remembers_recent_connections_with_limit() {
        let temp_dir = tempdir().expect("tempdir");
        let storage = Storage::new(temp_dir.path().join("rterm.sqlite")).expect("storage");

        for index in 0..3 {
            storage
                .save_recent_connection(
                    &RecentConnectionRecord {
                        id: format!("SFTP:host-{index}:/"),
                        host: format!("host-{index}"),
                        port: Some(22),
                        path: String::from("/"),
                        protocol: String::from("SFTP"),
                        last_connected_at: index,
                    },
                    2,
                )
                .expect("save recent");
        }

        let records = storage.list_recent_connections(6).expect("list");
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].host, "host-2");
        assert_eq!(records[1].host, "host-1");
    }
}
