use anyhow::Result;

use crate::cli::json;
use crate::core::app::app_capabilities;

pub fn run(as_json: bool) -> Result<()> {
    let capabilities = app_capabilities();

    if as_json {
        return json::print_success("capabilities", capabilities);
    }

    println!("Supported protocols: {}", capabilities.protocols.join(", "));
    println!("Desktop pages: {}", capabilities.desktop_pages.join(", "));
    println!("CLI commands: {}", capabilities.cli_commands.join(", "));
    println!("State storage: {}", capabilities.storage.state_database);
    println!("Secret storage: {}", capabilities.storage.secret_store);

    Ok(())
}
