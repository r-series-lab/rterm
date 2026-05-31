use rterm::platform::bookmarks::{self, FavoriteRecord, RecentConnectionRecord};
use tauri::State;

use super::remote_pool::{RemoteSessionRegistry, RemoteSessionState};

#[tauri::command]
pub async fn test_connection(
    remote: String,
    registry: State<'_, RemoteSessionRegistry>,
) -> Result<rterm::core::connections::ConnectionTestResult, String> {
    let registry = registry.inner().clone();
    tauri::async_runtime::spawn_blocking(move || registry.test_connection(&remote))
        .await
        .map_err(|error| format!("failed to join test_connection task: {error}"))?
}

#[tauri::command]
pub fn list_remote_session_states(
    registry: State<'_, RemoteSessionRegistry>,
) -> Result<Vec<RemoteSessionState>, String> {
    Ok(registry.list_states())
}

#[tauri::command]
pub fn disconnect_remote_session(
    remote: String,
    registry: State<'_, RemoteSessionRegistry>,
) -> Result<(), String> {
    registry.disconnect_session(remote.as_str());
    Ok(())
}

#[tauri::command]
pub fn list_recent_connections(
    limit: Option<usize>,
) -> Result<Vec<RecentConnectionRecord>, String> {
    bookmarks::list_recent_connections(limit)
}

#[tauri::command]
pub fn remember_recent_connection(
    host: String,
    port: Option<u16>,
    path: String,
    protocol: String,
    limit: Option<usize>,
) -> Result<Vec<RecentConnectionRecord>, String> {
    bookmarks::remember_recent_connection(
        bookmarks::RememberRecentConnectionInput {
            host,
            port,
            path,
            protocol,
        },
        limit,
    )
}

#[tauri::command]
pub fn remove_recent_connection(
    id: String,
    limit: Option<usize>,
) -> Result<Vec<RecentConnectionRecord>, String> {
    bookmarks::remove_recent_connection(id.as_str(), limit)
}

#[tauri::command]
pub fn list_favorites() -> Result<Vec<FavoriteRecord>, String> {
    bookmarks::list_favorites()
}

#[tauri::command]
pub fn load_favorite_password(id: String) -> Result<Option<String>, String> {
    bookmarks::load_favorite_password(id.as_str())
}

#[tauri::command]
pub fn save_favorite(
    name: String,
    host: String,
    port: Option<u16>,
    path: String,
    paths: Option<Vec<String>>,
    protocol: String,
    username: Option<String>,
    password: Option<String>,
    terminal_profile: Option<String>,
    legacy_ssh_host_key_algorithms: Option<bool>,
) -> Result<Vec<FavoriteRecord>, String> {
    bookmarks::save_favorite(bookmarks::SaveFavoriteInput {
        name,
        host,
        port,
        path,
        paths: paths.unwrap_or_default(),
        protocol,
        username,
        password,
        terminal_profile: terminal_profile.unwrap_or_else(|| String::from("auto")),
        legacy_ssh_host_key_algorithms: legacy_ssh_host_key_algorithms.unwrap_or(false),
    })
}

#[tauri::command]
pub fn remove_favorite(id: String) -> Result<Vec<FavoriteRecord>, String> {
    bookmarks::remove_favorite(id.as_str())
}

#[tauri::command]
pub fn rename_favorite(id: String, name: String) -> Result<Vec<FavoriteRecord>, String> {
    bookmarks::rename_favorite(bookmarks::RenameFavoriteInput { id, name })
}
