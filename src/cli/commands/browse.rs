use std::path::PathBuf;

use anyhow::Result;

use crate::cli::json;
use crate::cli::{CliError, CliResult};
use crate::core::browse::{BrowseListData, build_listing};
use crate::core::connections;
use crate::core::host::{HostBridge, LocalHost, RemoteHost};

pub fn list(
    path: Option<PathBuf>,
    remote: Option<String>,
    show_hidden: bool,
    as_json: bool,
) -> CliResult<()> {
    let payload = match execute_list(path, remote, show_hidden) {
        Ok(payload) => payload,
        Err(error) => {
            let message = error.to_string();
            if as_json {
                json::print_error("browse_list_failed", &message).map_err(CliError::from)?;
                return Err(CliError::rendered(message));
            }
            return Err(CliError::plain(message));
        }
    };

    if as_json {
        return json::print_success("browse.list", payload).map_err(CliError::from);
    }

    println!("Source: {}", payload.source);
    if let Some(endpoint) = payload.endpoint.as_deref() {
        println!("Endpoint: {endpoint}");
    }
    println!("Directory: {}", payload.directory);
    println!("Entries: {}", payload.visible_entries);
    for entry in payload.entries {
        println!("{}\t{}\t{}", entry.kind, entry.size, entry.path);
    }

    Ok(())
}

fn execute_list(
    path: Option<PathBuf>,
    remote: Option<String>,
    show_hidden: bool,
) -> Result<BrowseListData> {
    match remote {
        Some(spec) => list_remote(spec, path, show_hidden),
        None => list_local(path, show_hidden),
    }
}

fn list_local(path: Option<PathBuf>, show_hidden: bool) -> Result<BrowseListData> {
    let base_dir = path.unwrap_or(std::env::current_dir()?);
    let mut host = LocalHost::new(base_dir)?;
    let working_dir = host.pwd()?;
    let entries = host.list_dir(working_dir.as_path())?;

    Ok(build_payload(
        "local",
        None,
        working_dir,
        entries,
        show_hidden,
    ))
}

fn list_remote(remote: String, path: Option<PathBuf>, show_hidden: bool) -> Result<BrowseListData> {
    let params = connections::parse_remote_spec(&remote).map_err(anyhow::Error::msg)?;
    let endpoint = params.params.endpoint_label();
    let target_dir = path.or_else(|| params.remote_path.clone());
    let mut host = RemoteHost::from_params(&params)?;
    host.connect()?;

    let listing = (|| -> Result<BrowseListData> {
        let working_dir = match target_dir {
            Some(directory) => host.change_wrkdir(directory.as_path())?,
            None => host.pwd()?,
        };
        let entries = host.list_dir(working_dir.as_path())?;

        Ok(build_payload(
            "remote",
            Some(endpoint.clone()),
            working_dir,
            entries,
            show_hidden,
        ))
    })();

    let disconnect_result = host.disconnect();
    if let Err(error) = disconnect_result
        && listing.is_ok()
    {
        return Err(error.into());
    }

    listing
}

fn build_payload(
    source: &'static str,
    endpoint: Option<String>,
    working_dir: PathBuf,
    entries: Vec<crate::core::host::HostEntry>,
    show_hidden: bool,
) -> BrowseListData {
    build_listing(source, endpoint, working_dir, entries, show_hidden)
}
