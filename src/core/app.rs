use serde::Serialize;

use crate::core::protocols::supported_protocols;
use crate::platform::paths::{AppPaths, resolve_app_paths};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: &'static str,
    pub display_name: &'static str,
    pub version: &'static str,
    pub architecture: &'static str,
    pub profile: &'static str,
    pub architecture_profile: &'static str,
    pub paths: AppPaths,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCapabilities {
    pub protocols: Vec<&'static str>,
    pub desktop_pages: Vec<&'static str>,
    pub cli_commands: Vec<&'static str>,
    pub storage: StorageCapabilities,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageCapabilities {
    pub config_format: &'static str,
    pub state_database: &'static str,
    pub secret_store: &'static str,
}

pub fn app_info() -> AppInfo {
    AppInfo {
        name: "rterm",
        display_name: "rTerm",
        version: env!("CARGO_PKG_VERSION"),
        architecture: std::env::consts::ARCH,
        profile: if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        },
        architecture_profile: "modular-workbench",
        paths: resolve_app_paths(),
    }
}

pub fn app_capabilities() -> AppCapabilities {
    AppCapabilities {
        protocols: supported_protocols(),
        desktop_pages: vec!["Sessions", "Workbench", "Settings"],
        cli_commands: vec!["info", "capabilities", "browse list", "connections test"],
        storage: StorageCapabilities {
            config_format: "toml",
            state_database: "sqlite",
            secret_store: "encrypted-sqlite-with-system-keychain-master-key",
        },
    }
}
