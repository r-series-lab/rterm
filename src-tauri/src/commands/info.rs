#[tauri::command]
pub fn info() -> rterm::core::app::AppInfo {
    rterm::core::app::app_info()
}

#[tauri::command]
pub fn capabilities() -> rterm::core::app::AppCapabilities {
    rterm::core::app::app_capabilities()
}
