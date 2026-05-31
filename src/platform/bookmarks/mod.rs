use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::platform::keychain::favorite_passwords;
use crate::platform::paths::resolve_app_paths;
use crate::platform::storage::Storage;

const RECENT_CONNECTIONS_FILE: &str = "recent-connections.json";
const FAVORITES_FILE: &str = "favorites.json";
const DEFAULT_LIMIT: usize = 6;
const DEFAULT_TERMINAL_PROFILE: &str = "auto";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentConnectionRecord {
    pub id: String,
    pub host: String,
    #[serde(default)]
    pub port: Option<u16>,
    pub path: String,
    pub protocol: String,
    pub last_connected_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RememberRecentConnectionInput {
    pub host: String,
    #[serde(default)]
    pub port: Option<u16>,
    pub path: String,
    pub protocol: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteRecord {
    pub id: String,
    pub name: String,
    pub host: String,
    #[serde(default)]
    pub port: Option<u16>,
    pub path: String,
    #[serde(default)]
    pub paths: Vec<String>,
    pub protocol: String,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default = "default_terminal_profile")]
    pub terminal_profile: String,
    #[serde(default)]
    pub legacy_ssh_host_key_algorithms: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveFavoriteInput {
    pub name: String,
    pub host: String,
    #[serde(default)]
    pub port: Option<u16>,
    pub path: String,
    #[serde(default)]
    pub paths: Vec<String>,
    pub protocol: String,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default = "default_terminal_profile")]
    pub terminal_profile: String,
    #[serde(default)]
    pub legacy_ssh_host_key_algorithms: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenameFavoriteInput {
    pub id: String,
    pub name: String,
}

pub fn list_recent_connections(
    limit: Option<usize>,
) -> Result<Vec<RecentConnectionRecord>, String> {
    let storage = storage_with_legacy_migration()?;
    storage.list_recent_connections(limit.unwrap_or(DEFAULT_LIMIT))
}

pub fn remember_recent_connection(
    input: RememberRecentConnectionInput,
    limit: Option<usize>,
) -> Result<Vec<RecentConnectionRecord>, String> {
    let storage = storage_with_legacy_migration()?;
    let sanitized = sanitize_input(input)?;
    let record = RecentConnectionRecord {
        id: record_id(
            sanitized.protocol.as_str(),
            sanitized.host.as_str(),
            sanitized.port,
            sanitized.path.as_str(),
        ),
        host: sanitized.host,
        port: sanitized.port,
        path: sanitized.path,
        protocol: sanitized.protocol,
        last_connected_at: timestamp_millis(),
    };

    storage.save_recent_connection(&record, limit.unwrap_or(DEFAULT_LIMIT))
}

pub fn remove_recent_connection(
    id: &str,
    limit: Option<usize>,
) -> Result<Vec<RecentConnectionRecord>, String> {
    let storage = storage_with_legacy_migration()?;
    storage.remove_recent_connection(id, limit.unwrap_or(DEFAULT_LIMIT))
}

pub fn list_favorites() -> Result<Vec<FavoriteRecord>, String> {
    let storage = storage_with_legacy_migration()?;
    storage.list_favorites()
}

pub fn load_favorite_password(id: &str) -> Result<Option<String>, String> {
    let storage = storage_with_legacy_migration()?;
    storage.load_favorite_password(id)
}

pub fn save_favorite(input: SaveFavoriteInput) -> Result<Vec<FavoriteRecord>, String> {
    let storage = storage_with_legacy_migration()?;
    let sanitized = sanitize_favorite_input(input)?;
    let password_update_requested = sanitized.password.is_some();
    let record_id = record_id(
        sanitized.protocol.as_str(),
        sanitized.host.as_str(),
        sanitized.port,
        sanitized.path.as_str(),
    );
    let persisted_password = if password_update_requested {
        sanitized.password.clone()
    } else {
        sanitized.password.clone().or_else(|| {
            storage
                .load_favorite_password(record_id.as_str())
                .ok()
                .flatten()
        })
    };
    let record = FavoriteRecord {
        id: record_id,
        name: sanitized.name,
        host: sanitized.host,
        port: sanitized.port,
        path: sanitized.path,
        paths: sanitized.paths,
        protocol: sanitized.protocol,
        username: sanitized.username,
        password: persisted_password,
        terminal_profile: sanitized.terminal_profile,
        legacy_ssh_host_key_algorithms: sanitized.legacy_ssh_host_key_algorithms,
    };

    storage.save_favorite(&record, password_update_requested, timestamp_millis())
}

pub fn remove_favorite(id: &str) -> Result<Vec<FavoriteRecord>, String> {
    let storage = storage_with_legacy_migration()?;
    storage.remove_favorite(id)
}

pub fn rename_favorite(input: RenameFavoriteInput) -> Result<Vec<FavoriteRecord>, String> {
    let storage = storage_with_legacy_migration()?;
    let next_name = sanitize_favorite_name(input.name.as_str(), "", "");
    if next_name.trim().is_empty() {
        return Err(String::from("favorite name is required"));
    }

    storage.rename_favorite(input.id.as_str(), next_name.as_str(), timestamp_millis())
}

fn storage_with_legacy_migration() -> Result<Storage, String> {
    let storage = Storage::new_default()?;
    migrate_legacy_files_once(&storage)?;
    Ok(storage)
}

fn migrate_legacy_files_once(storage: &Storage) -> Result<(), String> {
    if storage.is_legacy_migrated()? {
        return Ok(());
    }

    let recents = load_recent_connections_from_path(recent_connections_path().as_path())?;
    storage.import_recent_connections(recents.as_slice(), DEFAULT_LIMIT)?;

    let mut favorites = load_favorites_from_path(favorites_path().as_path())?;
    for record in &mut favorites {
        if record.password.is_none() {
            record.password = favorite_passwords::load_password(record.id.as_str())
                .ok()
                .flatten();
        }
    }
    storage.import_favorites(favorites.as_slice(), timestamp_millis())?;
    storage.mark_legacy_migrated(timestamp_millis())?;

    Ok(())
}

#[cfg(test)]
fn remove_favorite_at(path: &Path, id: &str) -> Result<Vec<FavoriteRecord>, String> {
    let mut records = load_favorites_from_path(path)?;
    records.retain(|record| record.id != id);
    write_favorites(path, records.as_slice())?;
    favorite_passwords::remove_password(id)?;
    hydrate_favorite_passwords(records)
}

#[cfg(test)]
fn rename_favorite_at(
    path: &Path,
    input: RenameFavoriteInput,
) -> Result<Vec<FavoriteRecord>, String> {
    let mut records = load_favorites_from_path(path)?;
    let next_name = sanitize_favorite_name(input.name.as_str(), "", "");
    if next_name.trim().is_empty() {
        return Err(String::from("favorite name is required"));
    }

    let mut found = false;
    for record in &mut records {
        if record.id == input.id {
            record.name = next_name.clone();
            found = true;
            break;
        }
    }

    if !found {
        return Err(String::from("favorite not found"));
    }

    write_favorites(path, records.as_slice())?;
    hydrate_favorite_passwords(records)
}

fn recent_connections_path() -> PathBuf {
    PathBuf::from(resolve_app_paths().config_dir).join(RECENT_CONNECTIONS_FILE)
}

fn favorites_path() -> PathBuf {
    PathBuf::from(resolve_app_paths().config_dir).join(FAVORITES_FILE)
}

#[cfg(test)]
fn remember_recent_connection_at(
    path: &Path,
    input: RememberRecentConnectionInput,
    limit: usize,
) -> Result<Vec<RecentConnectionRecord>, String> {
    let sanitized = sanitize_input(input)?;
    let mut records = load_recent_connections_from_path(path)?;
    let next_record = RecentConnectionRecord {
        id: record_id(
            sanitized.protocol.as_str(),
            sanitized.host.as_str(),
            sanitized.port,
            sanitized.path.as_str(),
        ),
        host: sanitized.host,
        port: sanitized.port,
        path: sanitized.path,
        protocol: sanitized.protocol,
        last_connected_at: timestamp_millis(),
    };

    records.retain(|record| record.id != next_record.id);
    records.insert(0, next_record);
    let trimmed = limit_records(records, limit);

    write_recent_connections(path, trimmed.as_slice())?;
    Ok(trimmed)
}

fn load_recent_connections_from_path(path: &Path) -> Result<Vec<RecentConnectionRecord>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(path)
        .map_err(|error| format!("failed to read recent connections: {error}"))?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }

    let mut records: Vec<RecentConnectionRecord> = serde_json::from_str(raw.as_str())
        .map_err(|error| format!("failed to parse recent connections: {error}"))?;
    records.sort_by(|left, right| right.last_connected_at.cmp(&left.last_connected_at));

    Ok(records)
}

fn load_favorites_from_path(path: &Path) -> Result<Vec<FavoriteRecord>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw =
        fs::read_to_string(path).map_err(|error| format!("failed to read favorites: {error}"))?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }

    serde_json::from_str(raw.as_str())
        .map_err(|error| format!("failed to parse favorites: {error}"))
}

#[cfg(test)]
fn save_favorite_at(path: &Path, input: SaveFavoriteInput) -> Result<Vec<FavoriteRecord>, String> {
    let sanitized = sanitize_favorite_input(input)?;
    let password_update_requested = sanitized.password.is_some();
    let mut records = load_favorites_from_path(path)?;
    let record_id = record_id(
        sanitized.protocol.as_str(),
        sanitized.host.as_str(),
        sanitized.port,
        sanitized.path.as_str(),
    );
    let persisted_password = if password_update_requested {
        sanitized.password.clone()
    } else {
        sanitized
            .password
            .clone()
            .or_else(|| {
                favorite_passwords::load_password(record_id.as_str())
                    .ok()
                    .flatten()
            })
            .or_else(|| {
                records
                    .iter()
                    .find(|record| record.id == record_id)
                    .and_then(|record| record.password.clone())
            })
    };
    let next_record = FavoriteRecord {
        id: record_id.clone(),
        name: sanitized.name,
        host: sanitized.host,
        port: sanitized.port,
        path: sanitized.path,
        paths: sanitized.paths,
        protocol: sanitized.protocol,
        username: sanitized.username,
        password: persisted_password,
        terminal_profile: sanitized.terminal_profile,
        legacy_ssh_host_key_algorithms: sanitized.legacy_ssh_host_key_algorithms,
    };

    records.retain(|record| record.id != next_record.id);
    records.insert(0, next_record.clone());
    write_favorites(path, records.as_slice())?;
    if let Some(password) = next_record.password.as_deref() {
        favorite_passwords::save_password(next_record.id.as_str(), password)?;
    } else if password_update_requested {
        favorite_passwords::remove_password(next_record.id.as_str())?;
    }
    hydrate_favorite_passwords(records)
}

#[cfg(test)]
fn write_recent_connections(path: &Path, records: &[RecentConnectionRecord]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create config directory: {error}"))?;
    }

    let json = serde_json::to_string_pretty(records)
        .map_err(|error| format!("failed to encode recent connections: {error}"))?;
    fs::write(path, json).map_err(|error| format!("failed to write recent connections: {error}"))
}

#[cfg(test)]
fn write_favorites(path: &Path, records: &[FavoriteRecord]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create config directory: {error}"))?;
    }

    let persisted_records: Vec<FavoriteRecord> = records
        .iter()
        .cloned()
        .map(|record| FavoriteRecord {
            password: None,
            ..record
        })
        .collect();

    let json = serde_json::to_string_pretty(persisted_records.as_slice())
        .map_err(|error| format!("failed to encode favorites: {error}"))?;
    fs::write(path, json).map_err(|error| format!("failed to write favorites: {error}"))
}

fn sanitize_input(
    input: RememberRecentConnectionInput,
) -> Result<RememberRecentConnectionInput, String> {
    let (host, port, path, protocol) = sanitize_connection_parts(
        input.host.as_str(),
        input.port,
        input.path.as_str(),
        input.protocol.as_str(),
    )?;

    Ok(RememberRecentConnectionInput {
        host,
        port,
        path,
        protocol,
    })
}

fn sanitize_favorite_input(input: SaveFavoriteInput) -> Result<SaveFavoriteInput, String> {
    let (host, port, path, protocol) = sanitize_connection_parts(
        input.host.as_str(),
        input.port,
        input.path.as_str(),
        input.protocol.as_str(),
    )?;
    let name = sanitize_favorite_name(input.name.as_str(), host.as_str(), path.as_str());

    Ok(SaveFavoriteInput {
        name,
        host,
        port,
        paths: normalize_directory_list(input.paths.as_slice(), path.as_str()),
        path,
        protocol,
        username: sanitize_optional_field(input.username),
        password: sanitize_optional_field(input.password),
        terminal_profile: sanitize_terminal_profile(input.terminal_profile.as_str()),
        legacy_ssh_host_key_algorithms: input.legacy_ssh_host_key_algorithms,
    })
}

fn default_terminal_profile() -> String {
    String::from(DEFAULT_TERMINAL_PROFILE)
}

fn sanitize_terminal_profile(value: &str) -> String {
    match value.trim() {
        "posix" | "bash" | "zsh" | "fish" | "powershell" | "cmd" => value.trim().to_string(),
        _ => String::from(DEFAULT_TERMINAL_PROFILE),
    }
}

#[cfg(test)]
fn hydrate_favorite_passwords(
    mut records: Vec<FavoriteRecord>,
) -> Result<Vec<FavoriteRecord>, String> {
    for record in &mut records {
        if let Some(password) = favorite_passwords::load_password(record.id.as_str())? {
            record.password = Some(password);
        }
    }

    Ok(records)
}

fn sanitize_optional_field(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

fn sanitize_connection_parts(
    host: &str,
    port: Option<u16>,
    path: &str,
    protocol: &str,
) -> Result<(String, Option<u16>, String, String), String> {
    let host = host.trim().to_string();
    if host.is_empty() {
        return Err(String::from("host is required"));
    }

    let protocol = protocol.trim().to_uppercase();
    if protocol.is_empty() {
        return Err(String::from("protocol is required"));
    }

    let path = normalize_path(path);
    Ok((host, port, path, protocol))
}

fn sanitize_favorite_name(value: &str, host: &str, path: &str) -> String {
    let trimmed = value.trim();
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }

    let fallback = Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty() && *name != "/")
        .unwrap_or(host);

    format!("常用 · {fallback}")
}

fn normalize_path(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::from("/");
    }

    if trimmed.len() >= 3
        && trimmed.as_bytes()[1] == b':'
        && matches!(trimmed.as_bytes()[2], b'/' | b'\\')
    {
        return format!("/{}", trimmed.replace('\\', "/"));
    }

    if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    }
}

fn normalize_directory_list(values: &[String], primary: &str) -> Vec<String> {
    let mut paths = Vec::new();
    push_unique_path(&mut paths, normalize_path(primary));

    for value in values {
        if value.trim().is_empty() {
            continue;
        }

        push_unique_path(&mut paths, normalize_path(value.as_str()));
    }

    paths
}

fn push_unique_path(paths: &mut Vec<String>, value: String) {
    if !paths.iter().any(|path| path == &value) {
        paths.push(value);
    }
}

#[cfg(test)]
fn limit_records(
    mut records: Vec<RecentConnectionRecord>,
    limit: usize,
) -> Vec<RecentConnectionRecord> {
    if limit == 0 {
        return Vec::new();
    }

    records.truncate(limit);
    records
}

fn record_id(protocol: &str, host: &str, port: Option<u16>, path: &str) -> String {
    match port {
        Some(port) => format!("{protocol}:{host}:{port}:{path}"),
        None => format!("{protocol}:{host}:{path}"),
    }
}

fn timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn returns_empty_when_recents_file_is_missing() {
        let temp_dir = tempdir().expect("tempdir");
        let path = temp_dir.path().join("recent-connections.json");

        let records = load_recent_connections_from_path(path.as_path()).expect("loads");

        assert!(records.is_empty());
    }

    #[test]
    fn remembers_connections_and_keeps_latest_first() {
        let temp_dir = tempdir().expect("tempdir");
        let path = temp_dir.path().join("recent-connections.json");

        let first = remember_recent_connection_at(
            path.as_path(),
            RememberRecentConnectionInput {
                host: String::from("files.internal"),
                port: None,
                path: String::from("/srv/releases/current"),
                protocol: String::from("sftp"),
            },
            6,
        )
        .expect("saves first");
        assert_eq!(first.len(), 1);

        let second = remember_recent_connection_at(
            path.as_path(),
            RememberRecentConnectionInput {
                host: String::from("assets.office"),
                port: Some(443),
                path: String::from("/Volumes/assets"),
                protocol: String::from("webdav"),
            },
            6,
        )
        .expect("saves second");

        assert_eq!(second[0].host, "assets.office");
        assert_eq!(second[1].host, "files.internal");
    }

    #[test]
    fn deduplicates_existing_connection_id() {
        let temp_dir = tempdir().expect("tempdir");
        let path = temp_dir.path().join("recent-connections.json");

        remember_recent_connection_at(
            path.as_path(),
            RememberRecentConnectionInput {
                host: String::from("files.internal"),
                port: None,
                path: String::from("/srv/releases/current"),
                protocol: String::from("SFTP"),
            },
            6,
        )
        .expect("saves first");

        let records = remember_recent_connection_at(
            path.as_path(),
            RememberRecentConnectionInput {
                host: String::from("files.internal"),
                port: None,
                path: String::from("/srv/releases/current"),
                protocol: String::from("sftp"),
            },
            6,
        )
        .expect("updates existing");

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].protocol, "SFTP");
    }

    #[test]
    fn saves_and_lists_favorites() {
        let temp_dir = tempdir().expect("tempdir");
        let path = temp_dir.path().join("favorites.json");

        let records = save_favorite_at(
            path.as_path(),
            SaveFavoriteInput {
                name: String::new(),
                host: String::from("files.internal"),
                port: None,
                path: String::from("/srv/releases/current"),
                paths: Vec::new(),
                protocol: String::from("sftp"),
                username: Some(String::from("deploy")),
                password: None,
                terminal_profile: String::from("bash"),
                legacy_ssh_host_key_algorithms: false,
            },
        )
        .expect("saves favorite");

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].name, "常用 · current");
        assert_eq!(records[0].username.as_deref(), Some("deploy"));
        assert_eq!(records[0].terminal_profile, "bash");

        let loaded = load_favorites_from_path(path.as_path()).expect("loads favorites");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].host, "files.internal");
    }

    #[test]
    fn favorites_file_does_not_store_plaintext_password() {
        let temp_dir = tempdir().expect("tempdir");
        let path = temp_dir.path().join("favorites.json");

        let saved = save_favorite_at(
            path.as_path(),
            SaveFavoriteInput {
                name: String::from("Windows"),
                host: String::from("example.internal"),
                port: Some(22),
                path: String::from("/C:/Work/demo"),
                paths: Vec::new(),
                protocol: String::from("sftp"),
                username: Some(String::from("demo")),
                password: Some(String::from("secret-123")),
                terminal_profile: String::from("powershell"),
                legacy_ssh_host_key_algorithms: false,
            },
        )
        .expect("saves favorite");

        assert_eq!(saved[0].password.as_deref(), Some("secret-123"));

        let raw = fs::read_to_string(path.as_path()).expect("reads favorites");
        assert!(!raw.contains("secret-123"));
    }

    #[test]
    fn removes_favorite_by_id() {
        let temp_dir = tempdir().expect("tempdir");
        let path = temp_dir.path().join("favorites.json");

        let saved = save_favorite_at(
            path.as_path(),
            SaveFavoriteInput {
                name: String::from("发布目录"),
                host: String::from("files.internal"),
                port: None,
                path: String::from("/srv/releases/current"),
                paths: Vec::new(),
                protocol: String::from("sftp"),
                username: None,
                password: None,
                terminal_profile: String::from("auto"),
                legacy_ssh_host_key_algorithms: false,
            },
        )
        .expect("saves favorite");

        let removed =
            remove_favorite_at(path.as_path(), saved[0].id.as_str()).expect("removes favorite");
        assert!(removed.is_empty());
    }

    #[test]
    fn renames_favorite_by_id() {
        let temp_dir = tempdir().expect("tempdir");
        let path = temp_dir.path().join("favorites.json");

        let saved = save_favorite_at(
            path.as_path(),
            SaveFavoriteInput {
                name: String::from("发布目录"),
                host: String::from("files.internal"),
                port: None,
                path: String::from("/srv/releases/current"),
                paths: Vec::new(),
                protocol: String::from("sftp"),
                username: None,
                password: None,
                terminal_profile: String::from("auto"),
                legacy_ssh_host_key_algorithms: false,
            },
        )
        .expect("saves favorite");

        let renamed = rename_favorite_at(
            path.as_path(),
            RenameFavoriteInput {
                id: saved[0].id.clone(),
                name: String::from("生产目录"),
            },
        )
        .expect("renames favorite");
        assert_eq!(renamed[0].name, "生产目录");
    }
}
