use anyhow::Result;

use crate::cli::json;
use crate::core::app::app_info;

pub fn run(as_json: bool) -> Result<()> {
    let info = app_info();

    if as_json {
        return json::print_success("info", info);
    }

    println!("rTerm {}", info.version);
    println!("Profile: {}", info.profile);
    println!("Architecture: {}", info.architecture);
    println!("Config path: {}", info.paths.config_dir);
    println!("Data path: {}", info.paths.data_dir);
    println!("Cache path: {}", info.paths.cache_dir);

    Ok(())
}
