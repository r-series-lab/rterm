use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use rterm::core::browse::{
    BrowseListData, SearchContentMatch, SearchContentOptions, SearchResultData,
    SearchRuntimeOptions, build_content_search_results, build_listing, build_search_results,
    search_entries_with_options, search_file_contents_in_paths_with_options,
};
use rterm::core::host::{HostBridge, HostEntry, LocalHost};
use serde_json::Value;
use tauri::State;

use super::remote_pool::RemoteSessionRegistry;

const DEFAULT_SEARCH_LIMIT: usize = 200;
const MAX_SEARCH_LIMIT: usize = 1000;
const CONTENT_SEARCH_MAX_FILE_BYTES: usize = 16 * 1024 * 1024;
const CONTENT_SEARCH_MAX_ARCHIVE_BYTES: usize = 64 * 1024 * 1024;
const CONTENT_SEARCH_MAX_ARCHIVE_DEPTH: usize = 1;
const CONTENT_SEARCH_MAX_ARCHIVE_FILES: usize = 2000;
const SEARCH_CANCELLED_MESSAGE: &str = "搜索已取消";

#[derive(Clone, Default)]
pub struct SearchRegistry {
    active: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl SearchRegistry {
    fn register(&self, search_id: &str) -> Arc<AtomicBool> {
        let token = Arc::new(AtomicBool::new(false));

        if let Ok(mut active) = self.active.lock() {
            active.insert(search_id.to_string(), token.clone());
        }

        token
    }

    fn cancel(&self, search_id: &str) {
        if let Ok(active) = self.active.lock()
            && let Some(token) = active.get(search_id)
        {
            token.store(true, Ordering::SeqCst);
        }
    }

    fn remove(&self, search_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(search_id);
        }
    }
}

fn content_search_options(limit: usize) -> SearchContentOptions {
    SearchContentOptions {
        max_results: limit,
        max_file_bytes: CONTENT_SEARCH_MAX_FILE_BYTES,
        max_archive_bytes: CONTENT_SEARCH_MAX_ARCHIVE_BYTES,
        max_archive_depth: CONTENT_SEARCH_MAX_ARCHIVE_DEPTH,
        max_scanned_archive_files: CONTENT_SEARCH_MAX_ARCHIVE_FILES,
    }
}

fn search_runtime_options(
    ignore_patterns: Option<Vec<String>>,
    cancel_token: Option<Arc<AtomicBool>>,
) -> SearchRuntimeOptions {
    SearchRuntimeOptions::new(ignore_patterns.unwrap_or_default(), cancel_token)
}

fn search_was_cancelled(cancel_token: Option<&Arc<AtomicBool>>) -> bool {
    cancel_token.is_some_and(|token| token.load(Ordering::SeqCst))
}

fn search_cancelled_error() -> String {
    SEARCH_CANCELLED_MESSAGE.to_string()
}

fn is_search_cancelled_error(error: &str) -> bool {
    error.contains(SEARCH_CANCELLED_MESSAGE)
        || error.to_ascii_lowercase().contains("search cancelled")
}

fn is_content_search(mode: Option<&str>) -> bool {
    mode.map(str::trim)
        .is_some_and(|value| value.eq_ignore_ascii_case("content"))
}

fn is_archive_candidate(path: &Path) -> bool {
    let lowered = path.to_string_lossy().to_ascii_lowercase();
    lowered.ends_with(".tar.gz")
        || lowered.ends_with(".tgz")
        || lowered.ends_with(".tar")
        || lowered.ends_with(".zip")
}

fn trim_rg_line(line: &str) -> String {
    const MAX_LINE_CHARS: usize = 240;
    let trimmed = line.trim();
    let total_chars = trimmed.chars().count();
    if total_chars <= MAX_LINE_CHARS {
        return trimmed.to_string();
    }

    let mut value: String = trimmed.chars().take(MAX_LINE_CHARS).collect();
    value.push_str("...");
    value
}

fn parse_rg_match_path(value: &Value) -> Option<PathBuf> {
    value
        .get("data")?
        .get("path")?
        .get("text")?
        .as_str()
        .map(PathBuf::from)
}

fn parse_rg_match_line(value: &Value) -> Option<String> {
    value
        .get("data")?
        .get("lines")?
        .get("text")?
        .as_str()
        .map(trim_rg_line)
}

fn parse_rg_match_line_number(value: &Value) -> Option<usize> {
    value
        .get("data")?
        .get("line_number")?
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())
}

fn try_search_local_content_with_rg(
    base_dir: &Path,
    target_paths: &[PathBuf],
    query: &str,
    show_hidden: bool,
    limit: usize,
    ignore_patterns: &[String],
    cancel_token: Option<&Arc<AtomicBool>>,
) -> Result<Option<SearchResultData>, String> {
    if query.trim().is_empty()
        || limit == 0
        || target_paths
            .iter()
            .any(|path| is_archive_candidate(path.as_path()))
    {
        return Ok(None);
    }

    let mut command = Command::new("rg");
    command
        .current_dir(base_dir)
        .arg("--json")
        .arg("--line-number")
        .arg("--with-filename")
        .arg("--color")
        .arg("never")
        .arg("--max-columns")
        .arg("240")
        .arg("--max-columns-preview")
        .arg("--max-count")
        .arg(limit.to_string())
        .arg("-i");

    if show_hidden {
        command.arg("--hidden");
    }

    for pattern in ignore_patterns {
        let pattern = pattern.trim();
        if !pattern.is_empty() {
            command.arg("-g").arg(format!("!{pattern}"));
        }
    }

    command.arg("--").arg(query);
    for target_path in target_paths {
        command.arg(target_path);
    }

    let mut child = match command.stdout(Stdio::piped()).stderr(Stdio::null()).spawn() {
        Ok(child) => child,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("failed to run rg search: {error}")),
    };
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| String::from("failed to capture rg output"))?;
    let child = Arc::new(Mutex::new(child));
    let watcher_done = Arc::new(AtomicBool::new(false));
    if let Some(token) = cancel_token.cloned() {
        let watcher_child = Arc::clone(&child);
        let watcher_done = Arc::clone(&watcher_done);
        thread::spawn(move || {
            while !watcher_done.load(Ordering::SeqCst) {
                if token.load(Ordering::SeqCst) {
                    if let Ok(mut child) = watcher_child.lock() {
                        let _ = child.kill();
                    }
                    return;
                }
                thread::sleep(Duration::from_millis(40));
            }
        });
    }

    let mut host = LocalHost::new(base_dir.to_path_buf()).map_err(|error| error.to_string())?;
    let mut entry_cache: HashMap<PathBuf, HostEntry> = HashMap::new();
    let mut matches = Vec::new();
    let stdout = BufReader::new(stdout);
    let mut capped_by_limit = false;

    for line in stdout.lines() {
        if search_was_cancelled(cancel_token) {
            if let Ok(mut child) = child.lock() {
                let _ = child.kill();
            }
            watcher_done.store(true, Ordering::SeqCst);
            return Err(search_cancelled_error());
        }

        let line = match line {
            Ok(line) => line,
            Err(_) => continue,
        };
        let value = match serde_json::from_str::<Value>(line.as_str()) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if value.get("type").and_then(Value::as_str) != Some("match") {
            continue;
        }

        let Some(path) = parse_rg_match_path(&value) else {
            continue;
        };
        let Some(line_number) = parse_rg_match_line_number(&value) else {
            continue;
        };
        let Some(line) = parse_rg_match_line(&value) else {
            continue;
        };

        let entry = if let Some(entry) = entry_cache.get(path.as_path()).cloned() {
            entry
        } else {
            let Ok(entry) = host.stat(path.as_path()) else {
                continue;
            };
            entry_cache.insert(path.clone(), entry.clone());
            entry
        };

        if entry.is_dir() || entry.metadata.is_symlink || (!show_hidden && entry.is_hidden()) {
            continue;
        }

        matches.push(SearchContentMatch {
            entry,
            archive_path: None,
            line_number,
            line,
        });
        if matches.len() >= limit {
            capped_by_limit = true;
            if let Ok(mut child) = child.lock() {
                let _ = child.kill();
            }
            break;
        }
    }
    let status = child
        .lock()
        .map_err(|_| String::from("failed to wait for rg search"))?
        .wait()
        .map_err(|error| format!("failed to wait for rg search: {error}"))?;
    watcher_done.store(true, Ordering::SeqCst);

    if search_was_cancelled(cancel_token) {
        return Err(search_cancelled_error());
    }

    if !status.success() && status.code() != Some(1) && !capped_by_limit {
        return Ok(None);
    }

    let capped = capped_by_limit || matches.len() >= limit;
    Ok(Some(build_content_search_results(
        "local",
        None,
        base_dir.to_path_buf(),
        query.to_string(),
        matches,
        capped,
    )))
}

fn try_search_local_names_with_rg_files(
    base_dir: &Path,
    target_paths: &[PathBuf],
    query: &str,
    show_hidden: bool,
    limit: usize,
    ignore_patterns: &[String],
    cancel_token: Option<&Arc<AtomicBool>>,
) -> Result<Option<SearchResultData>, String> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() || limit == 0 {
        return Ok(None);
    }

    let mut command = Command::new("rg");
    command
        .current_dir(base_dir)
        .arg("--files")
        .arg("--color")
        .arg("never")
        .arg("--no-messages");

    if show_hidden {
        command.arg("--hidden");
    }

    for pattern in ignore_patterns {
        let pattern = pattern.trim();
        if !pattern.is_empty() {
            command.arg("-g").arg(format!("!{pattern}"));
        }
    }

    for target_path in target_paths {
        command.arg(target_path);
    }

    let mut child = match command.stdout(Stdio::piped()).stderr(Stdio::null()).spawn() {
        Ok(child) => child,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("failed to run rg file search: {error}")),
    };
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| String::from("failed to capture rg file search output"))?;
    let child = Arc::new(Mutex::new(child));
    let watcher_done = Arc::new(AtomicBool::new(false));
    if let Some(token) = cancel_token.cloned() {
        let watcher_child = Arc::clone(&child);
        let watcher_done = Arc::clone(&watcher_done);
        thread::spawn(move || {
            while !watcher_done.load(Ordering::SeqCst) {
                if token.load(Ordering::SeqCst) {
                    if let Ok(mut child) = watcher_child.lock() {
                        let _ = child.kill();
                    }
                    return;
                }
                thread::sleep(Duration::from_millis(40));
            }
        });
    }

    let mut host = LocalHost::new(base_dir.to_path_buf()).map_err(|error| error.to_string())?;
    let mut seen_paths = HashSet::new();
    let mut results = Vec::new();
    let stdout = BufReader::new(stdout);
    let mut capped_by_limit = false;

    for line in stdout.lines() {
        if search_was_cancelled(cancel_token) {
            if let Ok(mut child) = child.lock() {
                let _ = child.kill();
            }
            watcher_done.store(true, Ordering::SeqCst);
            return Err(search_cancelled_error());
        }

        let line = match line {
            Ok(line) => line,
            Err(_) => continue,
        };
        let raw_path = PathBuf::from(line.trim());
        let full_path = if raw_path.is_absolute() {
            raw_path
        } else {
            base_dir.join(raw_path)
        };

        let relative_path = full_path
            .strip_prefix(base_dir)
            .unwrap_or(full_path.as_path());
        let mut candidate = base_dir.to_path_buf();
        for component in relative_path.components() {
            let std::path::Component::Normal(name) = component else {
                continue;
            };
            candidate.push(name);
            if name
                .to_string_lossy()
                .to_lowercase()
                .contains(needle.as_str())
                && push_rg_name_candidate(
                    &mut host,
                    &mut seen_paths,
                    &mut results,
                    candidate.as_path(),
                    show_hidden,
                    limit,
                )?
            {
                capped_by_limit = true;
                if let Ok(mut child) = child.lock() {
                    let _ = child.kill();
                }
                break;
            }
        }

        if capped_by_limit {
            break;
        }
    }

    let status = child
        .lock()
        .map_err(|_| String::from("failed to wait for rg file search"))?
        .wait()
        .map_err(|error| format!("failed to wait for rg file search: {error}"))?;
    watcher_done.store(true, Ordering::SeqCst);

    if search_was_cancelled(cancel_token) {
        return Err(search_cancelled_error());
    }

    if !status.success() && status.code() != Some(1) && !capped_by_limit {
        return Ok(None);
    }

    results.sort_by_cached_key(|value| value.path.to_string_lossy().to_lowercase());
    Ok(Some(build_search_results(
        "local",
        None,
        base_dir.to_path_buf(),
        query.to_string(),
        results,
        capped_by_limit,
    )))
}

fn push_rg_name_candidate(
    host: &mut LocalHost,
    seen_paths: &mut HashSet<PathBuf>,
    results: &mut Vec<HostEntry>,
    path: &Path,
    show_hidden: bool,
    limit: usize,
) -> Result<bool, String> {
    if seen_paths.contains(path) {
        return Ok(false);
    }

    let entry = match host.stat(path) {
        Ok(entry) => entry,
        Err(_) => return Ok(false),
    };
    if !show_hidden && entry.is_hidden() {
        return Ok(false);
    }

    seen_paths.insert(entry.path.clone());
    results.push(entry);
    Ok(results.len() >= limit)
}

fn is_retryable_remote_browse_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    [
        "connection",
        "disconnect",
        "broken pipe",
        "timed out",
        "timeout",
        "reset by peer",
        "ssh",
        "transport",
        "unexpectedeof",
        "unexpected eof",
        "early eof",
        "eof",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

fn browse_remote_once(
    registry: &RemoteSessionRegistry,
    remote: &str,
    path: Option<&str>,
    show_hidden: bool,
) -> Result<BrowseListData, String> {
    registry.with_remote_host(remote, |host, params| {
        let endpoint = params.params.endpoint_label();
        let target_dir = path
            .map(PathBuf::from)
            .or_else(|| params.remote_path.clone());
        let working_dir = match target_dir {
            Some(directory) => host
                .change_wrkdir(directory.as_path())
                .map_err(|error| error.to_string())?,
            None => host.pwd().map_err(|error| error.to_string())?,
        };
        let entries = host
            .list_dir(working_dir.as_path())
            .map_err(|error| error.to_string())?;

        Ok(build_listing(
            "remote",
            Some(endpoint),
            working_dir,
            entries,
            show_hidden,
        ))
    })
}

fn search_remote_once(
    registry: &RemoteSessionRegistry,
    remote: &str,
    path: Option<&str>,
    target_paths: Option<&[String]>,
    query: &str,
    mode: Option<&str>,
    show_hidden: bool,
    limit: usize,
    runtime_options: &SearchRuntimeOptions,
) -> Result<SearchResultData, String> {
    registry.with_remote_host(remote, |host, params| {
        let endpoint = params.params.endpoint_label();
        let base_dir = path
            .map(PathBuf::from)
            .or_else(|| params.remote_path.clone())
            .unwrap_or_else(|| PathBuf::from("/"));
        let working_dir = host
            .change_wrkdir(base_dir.as_path())
            .map_err(|error| error.to_string())?;
        if is_content_search(mode) {
            let selected_paths: Vec<PathBuf> = target_paths
                .filter(|paths| !paths.is_empty())
                .map(|paths| paths.iter().map(PathBuf::from).collect())
                .unwrap_or_else(|| vec![working_dir.clone()]);
            let (matches, capped) = search_file_contents_in_paths_with_options(
                host,
                selected_paths.as_slice(),
                query,
                show_hidden,
                content_search_options(limit),
                runtime_options,
            )
            .map_err(|error| error.to_string())?;

            return Ok(build_content_search_results(
                "remote",
                Some(endpoint),
                working_dir,
                query.to_string(),
                matches,
                capped,
            ));
        }

        let (entries, capped) = search_entries_with_options(
            host,
            working_dir.as_path(),
            query,
            show_hidden,
            limit,
            runtime_options,
        )
        .map_err(|error| error.to_string())?;

        Ok(build_search_results(
            "remote",
            Some(endpoint),
            working_dir,
            query.to_string(),
            entries,
            capped,
        ))
    })
}

fn default_local_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

#[tauri::command]
pub async fn browse_local(
    path: Option<String>,
    show_hidden: Option<bool>,
) -> Result<BrowseListData, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<BrowseListData, String> {
        let base_dir = path.map(PathBuf::from).unwrap_or_else(default_local_dir);
        let mut host = LocalHost::new(base_dir).map_err(|error| error.to_string())?;
        let working_dir = host.pwd().map_err(|error| error.to_string())?;
        let entries = host
            .list_dir(working_dir.as_path())
            .map_err(|error| error.to_string())?;

        Ok(build_listing(
            "local",
            None,
            working_dir,
            entries,
            show_hidden.unwrap_or(false),
        ))
    })
    .await
    .map_err(|error| format!("failed to join browse_local task: {error}"))?
}

#[tauri::command]
pub async fn browse_remote(
    remote: String,
    path: Option<String>,
    show_hidden: Option<bool>,
    registry: State<'_, RemoteSessionRegistry>,
) -> Result<BrowseListData, String> {
    let registry = registry.inner().clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<BrowseListData, String> {
        let show_hidden = show_hidden.unwrap_or(false);
        let result = browse_remote_once(&registry, &remote, path.as_deref(), show_hidden);
        match result {
            Err(error) if is_retryable_remote_browse_error(error.as_str()) => {
                browse_remote_once(&registry, &remote, path.as_deref(), show_hidden)
            }
            other => other,
        }
    })
    .await
    .map_err(|error| format!("failed to join browse_remote task: {error}"))?
}

#[tauri::command]
pub async fn search_local(
    path: Option<String>,
    paths: Option<Vec<String>>,
    query: String,
    mode: Option<String>,
    show_hidden: Option<bool>,
    limit: Option<usize>,
    search_id: Option<String>,
    ignore_patterns: Option<Vec<String>>,
    registry: State<'_, SearchRegistry>,
) -> Result<SearchResultData, String> {
    let limit = limit
        .unwrap_or(DEFAULT_SEARCH_LIMIT)
        .clamp(1, MAX_SEARCH_LIMIT);
    let registry = registry.inner().clone();
    let cancel_token = search_id
        .as_deref()
        .map(|search_id| registry.register(search_id));
    let cleanup_search_id = search_id.clone();

    let result =
        tauri::async_runtime::spawn_blocking(move || -> Result<SearchResultData, String> {
            let base_dir = path.map(PathBuf::from).unwrap_or_else(default_local_dir);
            let mut host = LocalHost::new(base_dir.clone()).map_err(|error| error.to_string())?;
            let show_hidden = show_hidden.unwrap_or(false);
            let runtime_options =
                search_runtime_options(ignore_patterns.clone(), cancel_token.clone());

            if is_content_search(mode.as_deref()) {
                let selected_paths: Vec<PathBuf> = paths
                    .filter(|paths| !paths.is_empty())
                    .map(|paths| paths.into_iter().map(PathBuf::from).collect())
                    .unwrap_or_else(|| vec![base_dir.clone()]);
                if let Some(result) = try_search_local_content_with_rg(
                    base_dir.as_path(),
                    selected_paths.as_slice(),
                    query.as_str(),
                    show_hidden,
                    limit,
                    runtime_options.ignore_patterns.as_slice(),
                    runtime_options.cancel_token.as_ref(),
                )? {
                    return Ok(result);
                }

                let (matches, capped) = search_file_contents_in_paths_with_options(
                    &mut host,
                    selected_paths.as_slice(),
                    &query,
                    show_hidden,
                    content_search_options(limit),
                    &runtime_options,
                )
                .map_err(|error| error.to_string())?;

                return Ok(build_content_search_results(
                    "local", None, base_dir, query, matches, capped,
                ));
            }

            let selected_paths: Vec<PathBuf> = paths
                .filter(|paths| !paths.is_empty())
                .map(|paths| paths.into_iter().map(PathBuf::from).collect())
                .unwrap_or_else(|| vec![base_dir.clone()]);
            if let Some(result) = try_search_local_names_with_rg_files(
                base_dir.as_path(),
                selected_paths.as_slice(),
                query.as_str(),
                show_hidden,
                limit,
                runtime_options.ignore_patterns.as_slice(),
                runtime_options.cancel_token.as_ref(),
            )? {
                return Ok(result);
            }

            let (entries, capped) = search_entries_with_options(
                &mut host,
                base_dir.as_path(),
                &query,
                show_hidden,
                limit,
                &runtime_options,
            )
            .map_err(|error| error.to_string())?;

            Ok(build_search_results(
                "local", None, base_dir, query, entries, capped,
            ))
        })
        .await
        .map_err(|error| format!("failed to join search_local task: {error}"))?;

    if let Some(search_id) = cleanup_search_id {
        registry.remove(search_id.as_str());
    }

    result
}

#[tauri::command]
pub async fn search_remote(
    remote: String,
    path: Option<String>,
    paths: Option<Vec<String>>,
    query: String,
    mode: Option<String>,
    show_hidden: Option<bool>,
    limit: Option<usize>,
    search_id: Option<String>,
    ignore_patterns: Option<Vec<String>>,
    search_registry: State<'_, SearchRegistry>,
    registry: State<'_, RemoteSessionRegistry>,
) -> Result<SearchResultData, String> {
    let limit = limit
        .unwrap_or(DEFAULT_SEARCH_LIMIT)
        .clamp(1, MAX_SEARCH_LIMIT);
    let search_registry = search_registry.inner().clone();
    let cancel_token = search_id
        .as_deref()
        .map(|search_id| search_registry.register(search_id));
    let cleanup_search_id = search_id.clone();
    let registry = registry.inner().clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || -> Result<SearchResultData, String> {
            let show_hidden = show_hidden.unwrap_or(false);
            let runtime_options = search_runtime_options(ignore_patterns, cancel_token);
            let result = search_remote_once(
                &registry,
                &remote,
                path.as_deref(),
                paths.as_deref(),
                query.as_str(),
                mode.as_deref(),
                show_hidden,
                limit,
                &runtime_options,
            );
            match result {
                Err(error)
                    if !is_search_cancelled_error(error.as_str())
                        && is_retryable_remote_browse_error(error.as_str()) =>
                {
                    search_remote_once(
                        &registry,
                        &remote,
                        path.as_deref(),
                        paths.as_deref(),
                        query.as_str(),
                        mode.as_deref(),
                        show_hidden,
                        limit,
                        &runtime_options,
                    )
                }
                other => other,
            }
        })
        .await
        .map_err(|error| format!("failed to join search_remote task: {error}"))?;

    if let Some(search_id) = cleanup_search_id {
        search_registry.remove(search_id.as_str());
    }

    result
}

#[tauri::command]
pub fn cancel_search(search_id: String, registry: State<'_, SearchRegistry>) -> Result<(), String> {
    registry.cancel(search_id.as_str());
    Ok(())
}
