#[cfg(not(test))]
use keyring::{Entry, Error as KeyringError};
#[cfg(not(test))]
use serde::{Deserialize, Serialize};
#[cfg(not(test))]
use std::{collections::BTreeMap, fs, path::PathBuf};

#[cfg(not(test))]
use crate::platform::paths::resolve_app_paths;

#[cfg(not(test))]
const FAVORITE_PASSWORD_SERVICE: &str = "rterm.favorite-password";
#[cfg(not(test))]
const FALLBACK_PASSWORDS_FILE: &str = "favorite-passwords.local.json";

#[cfg(not(test))]
#[derive(Debug, Default, Serialize, Deserialize)]
struct FallbackPasswordStore {
    #[serde(default)]
    passwords: BTreeMap<String, String>,
}

#[cfg(not(test))]
fn favorite_entry(id: &str) -> Result<Entry, String> {
    Entry::new(FAVORITE_PASSWORD_SERVICE, id)
        .map_err(|error| format!("无法访问系统密码存储: {error}"))
}

#[cfg(not(test))]
pub fn load_password(id: &str) -> Result<Option<String>, String> {
    match favorite_entry(id) {
        Ok(entry) => match entry.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(KeyringError::NoEntry) => load_fallback_password(id),
            Err(error) => load_fallback_password(id).map_err(|fallback_error| {
                format!("无法读取已保存密码: {error}; 本地后备也不可用: {fallback_error}")
            }),
        },
        Err(error) => load_fallback_password(id)
            .map_err(|fallback_error| format!("{error}; 本地后备也不可用: {fallback_error}")),
    }
}

#[cfg(not(test))]
pub fn save_password(id: &str, password: &str) -> Result<(), String> {
    match favorite_entry(id) {
        Ok(entry) => match entry.set_password(password) {
            Ok(()) => {
                let _ = remove_fallback_password(id);
                Ok(())
            }
            Err(error) => save_fallback_password(id, password).map_err(|fallback_error| {
                format!("无法写入系统密码存储: {error}; 本地后备也不可用: {fallback_error}")
            }),
        },
        Err(error) => save_fallback_password(id, password)
            .map_err(|fallback_error| format!("{error}; 本地后备也不可用: {fallback_error}")),
    }
}

#[cfg(not(test))]
pub fn remove_password(id: &str) -> Result<(), String> {
    let keychain_result = match favorite_entry(id) {
        Ok(entry) => match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(format!("无法移除已保存密码: {error}")),
        },
        Err(error) => Err(error),
    };
    let fallback_result = remove_fallback_password(id);

    match (keychain_result, fallback_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
        (Err(keychain_error), Err(fallback_error)) => {
            Err(format!("{keychain_error}; {fallback_error}"))
        }
    }
}

#[cfg(not(test))]
fn fallback_passwords_path() -> PathBuf {
    PathBuf::from(resolve_app_paths().config_dir).join(FALLBACK_PASSWORDS_FILE)
}

#[cfg(not(test))]
fn read_fallback_store() -> Result<FallbackPasswordStore, String> {
    let path = fallback_passwords_path();
    if !path.exists() {
        return Ok(FallbackPasswordStore::default());
    }

    let raw = fs::read_to_string(path.as_path())
        .map_err(|error| format!("无法读取本地密码后备文件: {error}"))?;
    if raw.trim().is_empty() {
        return Ok(FallbackPasswordStore::default());
    }

    serde_json::from_str(raw.as_str()).map_err(|error| format!("无法解析本地密码后备文件: {error}"))
}

#[cfg(not(test))]
fn write_fallback_store(store: &FallbackPasswordStore) -> Result<(), String> {
    let path = fallback_passwords_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建本地密码目录: {error}"))?;
    }

    let json = serde_json::to_string_pretty(store)
        .map_err(|error| format!("无法编码本地密码后备文件: {error}"))?;
    fs::write(path.as_path(), json).map_err(|error| format!("无法写入本地密码后备文件: {error}"))
}

#[cfg(not(test))]
fn load_fallback_password(id: &str) -> Result<Option<String>, String> {
    Ok(read_fallback_store()?.passwords.get(id).cloned())
}

#[cfg(not(test))]
fn save_fallback_password(id: &str, password: &str) -> Result<(), String> {
    let mut store = read_fallback_store()?;
    store.passwords.insert(id.to_string(), password.to_string());
    write_fallback_store(&store)
}

#[cfg(not(test))]
fn remove_fallback_password(id: &str) -> Result<(), String> {
    let mut store = read_fallback_store()?;
    store.passwords.remove(id);
    write_fallback_store(&store)
}

#[cfg(test)]
pub fn load_password(_id: &str) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(test)]
pub fn save_password(_id: &str, _password: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
pub fn remove_password(_id: &str) -> Result<(), String> {
    Ok(())
}
