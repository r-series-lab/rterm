use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use rterm::core::host::HostBridge;
use rterm::core::transfer;
use rterm::platform::paths::resolve_app_paths;
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use super::remote_pool::RemoteSessionRegistry;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenEntryResult {
    pub path: String,
    pub cached: bool,
}

fn sanitize_name(name: &str) -> String {
    let sanitized = name
        .chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-' | '_' => ch,
            _ => '-',
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();

    if sanitized.is_empty() {
        String::from("remote-file")
    } else {
        sanitized
    }
}

fn remote_cache_target(remote: &str, path: &Path) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .ok_or_else(|| format!("无法确定文件名 {}", path.display()))?;
    let mut hasher = DefaultHasher::new();
    remote.hash(&mut hasher);
    path.hash(&mut hasher);
    let cache_dir = PathBuf::from(resolve_app_paths().cache_dir).join("remote-open");
    fs::create_dir_all(&cache_dir)
        .map_err(|error| format!("无法创建缓存目录 {}: {error}", cache_dir.display()))?;

    Ok(cache_dir.join(format!(
        "{:016x}-{}",
        hasher.finish(),
        sanitize_name(&file_name)
    )))
}

#[tauri::command]
pub fn open_local_entry(app: AppHandle, path: String) -> Result<OpenEntryResult, String> {
    let entry_path = PathBuf::from(&path);
    if !entry_path.exists() {
        return Err(format!("路径不存在 {}", entry_path.display()));
    }

    app.opener()
        .open_path(path.clone(), None::<&str>)
        .map_err(|error| error.to_string())?;

    Ok(OpenEntryResult {
        path,
        cached: false,
    })
}

#[tauri::command]
pub async fn open_remote_entry(
    app: AppHandle,
    registry: State<'_, RemoteSessionRegistry>,
    remote: String,
    path: String,
) -> Result<OpenEntryResult, String> {
    let registry = registry.inner().clone();
    let remote_for_task = remote.clone();
    let path_for_task = path.clone();
    let cache_path = tauri::async_runtime::spawn_blocking(move || -> Result<PathBuf, String> {
        let remote_path = PathBuf::from(&path_for_task);
        registry.with_remote_host(&remote_for_task, |host, _| {
            let entry = host
                .stat(remote_path.as_path())
                .map_err(|error| error.to_string())?;
            if entry.metadata.is_dir {
                return Err(String::from("暂不支持直接打开远端目录"));
            }
            Ok(())
        })?;

        let cache_path = remote_cache_target(&remote_for_task, remote_path.as_path())?;
        transfer::download_path(
            &remote_for_task,
            remote_path.as_path(),
            cache_path.as_path(),
        )
        .map_err(|error| error.to_string())?;
        Ok(cache_path)
    })
    .await
    .map_err(|error| format!("failed to join open_remote_entry task: {error}"))??;

    let resolved_path = cache_path.display().to_string();
    app.opener()
        .open_path(resolved_path.clone(), None::<&str>)
        .map_err(|error| error.to_string())?;

    Ok(OpenEntryResult {
        path: resolved_path,
        cached: true,
    })
}
