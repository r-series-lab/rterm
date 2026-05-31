use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use rterm::core::transfer::{
    TransferConflict, TransferConflictPolicy, TransferOptions, TransferProgress, TransferResult,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use super::remote_pool::RemoteSessionRegistry;

#[derive(Default)]
pub struct TransferRegistry {
    active: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl TransferRegistry {
    fn register(&self, transfer_id: &str) -> Arc<AtomicBool> {
        let token = Arc::new(AtomicBool::new(false));

        if let Ok(mut active) = self.active.lock() {
            active.insert(transfer_id.to_string(), token.clone());
        }

        token
    }

    fn cancel(&self, transfer_id: &str) {
        if let Ok(active) = self.active.lock()
            && let Some(token) = active.get(transfer_id)
        {
            token.store(true, Ordering::SeqCst);
        }
    }

    fn remove(&self, transfer_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(transfer_id);
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransferProgressEvent {
    transfer_id: String,
    #[serde(flatten)]
    progress: TransferProgress,
}

fn is_retryable_remote_session_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    [
        "channel send error",
        "connection",
        "disconnect",
        "broken pipe",
        "timed out",
        "timeout",
        "reset by peer",
        "transport",
        "eof",
        "protocol error",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

#[tauri::command]
pub async fn upload_path(
    app: AppHandle,
    registry: State<'_, TransferRegistry>,
    remote_registry: State<'_, RemoteSessionRegistry>,
    transfer_id: String,
    conflict_policy: Option<TransferConflictPolicy>,
    remote: String,
    local_path: String,
    remote_path: String,
) -> Result<TransferResult, String> {
    let cancel_token = registry.register(&transfer_id);
    let remote_registry = remote_registry.inner().clone();
    let progress_app = app.clone();
    let progress_transfer_id = transfer_id.clone();
    let options = TransferOptions::default()
        .with_cancel_token(cancel_token)
        .with_conflict_policy(conflict_policy.unwrap_or_default())
        .with_progress(move |progress| {
            let _ = progress_app.emit(
                "transfer-progress",
                TransferProgressEvent {
                    transfer_id: progress_transfer_id.clone(),
                    progress,
                },
            );
        });

    let result = tauri::async_runtime::spawn_blocking(move || {
        remote_registry.with_remote_host(&remote, |host, _| {
            rterm::core::transfer::upload_path_with_connected_remote(
                host.remote_fs(),
                local_path.as_str(),
                remote_path.as_str(),
                options,
            )
        })
    })
    .await
    .map_err(|error| error.to_string());

    registry.remove(&transfer_id);
    result?
}

#[tauri::command]
pub async fn download_path(
    app: AppHandle,
    registry: State<'_, TransferRegistry>,
    remote_registry: State<'_, RemoteSessionRegistry>,
    transfer_id: String,
    conflict_policy: Option<TransferConflictPolicy>,
    remote: String,
    remote_path: String,
    local_path: String,
) -> Result<TransferResult, String> {
    let cancel_token = registry.register(&transfer_id);
    let remote_registry = remote_registry.inner().clone();
    let progress_app = app.clone();
    let progress_transfer_id = transfer_id.clone();
    let options = TransferOptions::default()
        .with_cancel_token(cancel_token)
        .with_conflict_policy(conflict_policy.unwrap_or_default())
        .with_progress(move |progress| {
            let _ = progress_app.emit(
                "transfer-progress",
                TransferProgressEvent {
                    transfer_id: progress_transfer_id.clone(),
                    progress,
                },
            );
        });

    let result = tauri::async_runtime::spawn_blocking(move || {
        let cached_options = options.clone();
        let result = remote_registry.with_remote_host(&remote, |host, _| {
            rterm::core::transfer::download_path_with_connected_remote(
                host.remote_fs(),
                remote_path.as_str(),
                local_path.as_str(),
                cached_options,
            )
        });

        match result {
            Err(error) if is_retryable_remote_session_error(error.as_str()) => {
                match rterm::core::transfer::download_path_with_options(
                    remote.as_str(),
                    remote_path.as_str(),
                    local_path.as_str(),
                    options,
                ) {
                    Ok(result) => Ok(result),
                    Err(retry_error) => Err(format!(
                        "download failed after reconnect: {retry_error}; first cached-session error: {error}"
                    )),
                }
            }
            other => other,
        }
    })
    .await
    .map_err(|error| error.to_string());

    registry.remove(&transfer_id);
    result?
}

#[tauri::command]
pub async fn copy_remote_path(
    app: AppHandle,
    registry: State<'_, TransferRegistry>,
    remote_registry: State<'_, RemoteSessionRegistry>,
    transfer_id: String,
    conflict_policy: Option<TransferConflictPolicy>,
    source_remote: String,
    source_path: String,
    target_remote: String,
    target_path: String,
) -> Result<TransferResult, String> {
    let cancel_token = registry.register(&transfer_id);
    let remote_registry = remote_registry.inner().clone();
    let progress_app = app.clone();
    let progress_transfer_id = transfer_id.clone();
    let options = TransferOptions::default()
        .with_cancel_token(cancel_token)
        .with_conflict_policy(conflict_policy.unwrap_or_default())
        .with_progress(move |progress| {
            let _ = progress_app.emit(
                "transfer-progress",
                TransferProgressEvent {
                    transfer_id: progress_transfer_id.clone(),
                    progress,
                },
            );
        });

    let result = tauri::async_runtime::spawn_blocking(move || {
        let cached_options = options.clone();
        let result = remote_registry.with_remote_host(&source_remote, |host, _| {
            rterm::core::transfer::copy_remote_path_with_connected_source(
                host.remote_fs(),
                target_remote.as_str(),
                source_path.as_str(),
                target_path.as_str(),
                cached_options,
            )
        });

        match result {
            Err(error) if is_retryable_remote_session_error(error.as_str()) => {
                match rterm::core::transfer::copy_remote_path_with_options(
                    source_remote.as_str(),
                    source_path.as_str(),
                    target_remote.as_str(),
                    target_path.as_str(),
                    options,
                ) {
                    Ok(result) => Ok(result),
                    Err(retry_error) => Err(format!(
                        "remote copy failed after reconnect: {retry_error}; first cached-session error: {error}"
                    )),
                }
            }
            other => other,
        }
    })
    .await
    .map_err(|error| error.to_string());

    registry.remove(&transfer_id);
    result?
}

#[tauri::command]
pub fn cancel_transfer(
    transfer_id: String,
    registry: State<'_, TransferRegistry>,
) -> Result<(), String> {
    registry.cancel(&transfer_id);
    Ok(())
}

#[tauri::command]
pub async fn inspect_upload_conflicts(
    remote_registry: State<'_, RemoteSessionRegistry>,
    remote: String,
    local_path: String,
    remote_path: String,
) -> Result<Vec<TransferConflict>, String> {
    let remote_registry = remote_registry.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        remote_registry.with_remote_host(&remote, |host, _| {
            rterm::core::transfer::inspect_upload_conflicts_with_connected_remote(
                host.remote_fs(),
                local_path.as_str(),
                remote_path.as_str(),
            )
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn inspect_remote_copy_conflicts(
    remote_registry: State<'_, RemoteSessionRegistry>,
    source_remote: String,
    source_path: String,
    target_remote: String,
    target_path: String,
) -> Result<Vec<TransferConflict>, String> {
    let remote_registry = remote_registry.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = remote_registry.with_remote_host(&source_remote, |host, _| {
            rterm::core::transfer::inspect_remote_copy_conflicts_with_connected_source(
                host.remote_fs(),
                source_path.as_str(),
                target_remote.as_str(),
                target_path.as_str(),
            )
        });

        match result {
            Err(error) if is_retryable_remote_session_error(error.as_str()) => {
                match rterm::core::transfer::inspect_remote_copy_conflicts(
                    source_remote.as_str(),
                    source_path.as_str(),
                    target_remote.as_str(),
                    target_path.as_str(),
                ) {
                    Ok(conflicts) => Ok(conflicts),
                    Err(retry_error) => Err(format!(
                        "remote copy preparation failed after reconnect: {retry_error}; first cached-session error: {error}"
                    )),
                }
            }
            other => other,
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn inspect_download_conflicts(
    remote_registry: State<'_, RemoteSessionRegistry>,
    remote: String,
    remote_path: String,
    local_path: String,
) -> Result<Vec<TransferConflict>, String> {
    let remote_registry = remote_registry.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = remote_registry.with_remote_host(&remote, |host, _| {
            rterm::core::transfer::inspect_download_conflicts_with_connected_remote(
                host.remote_fs(),
                remote_path.as_str(),
                local_path.as_str(),
            )
        });

        match result {
            Err(error) if is_retryable_remote_session_error(error.as_str()) => {
                match rterm::core::transfer::inspect_download_conflicts(
                    remote.as_str(),
                    remote_path.as_str(),
                    local_path.as_str(),
                ) {
                    Ok(conflicts) => Ok(conflicts),
                    Err(retry_error) => Err(format!(
                        "download preparation failed after reconnect: {retry_error}; first cached-session error: {error}"
                    )),
                }
            }
            other => other,
        }
    })
    .await
    .map_err(|error| error.to_string())?
}
