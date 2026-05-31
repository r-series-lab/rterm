use std::path::PathBuf;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub config_dir: String,
    pub data_dir: String,
    pub cache_dir: String,
    pub logs_path: String,
}

pub fn resolve_app_paths() -> AppPaths {
    let config_dir = app_dir(dirs::config_dir());
    let data_dir = app_dir(dirs::data_local_dir().or_else(dirs::data_dir));
    let cache_dir = app_dir(dirs::cache_dir());
    let logs_path = cache_dir.join("rterm.log");

    AppPaths {
        config_dir: config_dir.display().to_string(),
        data_dir: data_dir.display().to_string(),
        cache_dir: cache_dir.display().to_string(),
        logs_path: logs_path.display().to_string(),
    }
}

fn app_dir(base: Option<PathBuf>) -> PathBuf {
    base.unwrap_or_else(std::env::temp_dir).join("rterm")
}
