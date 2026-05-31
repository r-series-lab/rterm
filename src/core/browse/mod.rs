use std::cmp::Reverse;
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{self, Cursor, Read};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use flate2::read::GzDecoder;
use serde::Serialize;

use crate::core::host::{HostBridge, HostEntry, HostError, HostResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileSorting {
    Name,
    ModifyTime,
    CreationTime,
    Size,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GroupDirs {
    First,
    Last,
}

#[derive(Debug, Clone)]
pub struct FileExplorer {
    pub wrkdir: PathBuf,
    dirstack: VecDeque<PathBuf>,
    stack_size: usize,
    file_sorting: FileSorting,
    group_dirs: Option<GroupDirs>,
    show_hidden_files: bool,
    entries: Vec<HostEntry>,
    transfer_queue: HashMap<PathBuf, PathBuf>,
}

impl Default for FileExplorer {
    fn default() -> Self {
        Self {
            wrkdir: PathBuf::from("/"),
            dirstack: VecDeque::with_capacity(16),
            stack_size: 16,
            file_sorting: FileSorting::Name,
            group_dirs: None,
            show_hidden_files: false,
            entries: Vec::new(),
            transfer_queue: HashMap::new(),
        }
    }
}

impl FileExplorer {
    pub fn pushd(&mut self, directory: &Path) {
        while self.dirstack.len() >= self.stack_size {
            self.dirstack.pop_front();
        }
        self.dirstack.push_back(directory.to_path_buf());
    }

    pub fn popd(&mut self) -> Option<PathBuf> {
        self.dirstack.pop_back()
    }

    pub fn set_entries(&mut self, entries: Vec<HostEntry>) {
        self.entries = entries;
        self.sort();
    }

    pub fn iter_entries(&self) -> impl Iterator<Item = &HostEntry> + '_ {
        self.entries
            .iter()
            .filter(move |entry| self.show_hidden_files || !entry.is_hidden())
    }

    pub fn iter_entries_all(&self) -> impl Iterator<Item = &HostEntry> + '_ {
        self.entries.iter()
    }

    pub fn get(&self, index: usize) -> Option<&HostEntry> {
        self.iter_entries().nth(index)
    }

    pub fn enqueue(&mut self, source: &Path, destination: &Path) {
        self.transfer_queue
            .insert(source.to_path_buf(), destination.to_path_buf());
    }

    pub fn enqueue_all(&mut self, destination: &Path) {
        let paths: Vec<PathBuf> = self
            .iter_entries()
            .map(|entry| entry.path.clone())
            .collect();
        for path in paths {
            self.enqueue(path.as_path(), destination);
        }
    }

    pub fn enqueued(&self) -> &HashMap<PathBuf, PathBuf> {
        &self.transfer_queue
    }

    pub fn clear_queue(&mut self) {
        self.transfer_queue.clear();
    }

    pub fn sort_by(&mut self, sorting: FileSorting) {
        if self.file_sorting != sorting {
            self.file_sorting = sorting;
            self.sort();
        }
    }

    pub fn group_dirs_by(&mut self, group_dirs: Option<GroupDirs>) {
        if self.group_dirs != group_dirs {
            self.group_dirs = group_dirs;
            self.sort();
        }
    }

    pub fn toggle_hidden_files(&mut self) {
        self.show_hidden_files = !self.show_hidden_files;
    }

    pub fn hidden_files_visible(&self) -> bool {
        self.show_hidden_files
    }

    fn sort(&mut self) {
        match self.file_sorting {
            FileSorting::Name => self
                .entries
                .sort_by_cached_key(|entry| entry.name().to_lowercase()),
            FileSorting::ModifyTime => self
                .entries
                .sort_by_key(|entry| Reverse(entry.metadata.modified)),
            FileSorting::CreationTime => self
                .entries
                .sort_by_key(|entry| Reverse(entry.metadata.created)),
            FileSorting::Size => self
                .entries
                .sort_by_key(|entry| Reverse(entry.metadata.size)),
            FileSorting::None => {}
        }

        match self.group_dirs {
            Some(GroupDirs::First) => self.entries.sort_by_key(|entry| !entry.is_dir()),
            Some(GroupDirs::Last) => self.entries.sort_by_key(|entry| entry.is_dir()),
            None => {}
        }
    }
}

pub struct FileExplorerBuilder {
    explorer: FileExplorer,
}

impl FileExplorerBuilder {
    pub fn new() -> Self {
        Self {
            explorer: FileExplorer::default(),
        }
    }

    pub fn with_hidden_files(mut self, value: bool) -> Self {
        self.explorer.show_hidden_files = value;
        self
    }

    pub fn with_file_sorting(mut self, sorting: FileSorting) -> Self {
        self.explorer.file_sorting = sorting;
        self
    }

    pub fn with_group_dirs(mut self, group_dirs: Option<GroupDirs>) -> Self {
        self.explorer.group_dirs = group_dirs;
        self
    }

    pub fn with_stack_size(mut self, size: usize) -> Self {
        self.explorer.stack_size = size;
        self.explorer.dirstack = VecDeque::with_capacity(size);
        self
    }

    pub fn build(self) -> FileExplorer {
        self.explorer
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowseListData {
    pub source: &'static str,
    pub endpoint: Option<String>,
    pub directory: String,
    pub total_entries: usize,
    pub visible_entries: usize,
    pub entries: Vec<BrowseEntryView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowseEntryView {
    pub name: String,
    pub path: String,
    pub kind: &'static str,
    pub hidden: bool,
    pub size: u64,
    pub modified_at: Option<u64>,
    pub permissions: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultData {
    pub source: &'static str,
    pub endpoint: Option<String>,
    pub directory: String,
    pub query: String,
    pub search_mode: &'static str,
    pub total_matches: usize,
    pub capped: bool,
    pub entries: Vec<BrowseEntryView>,
    pub matches: Vec<SearchMatchView>,
}

#[derive(Debug, Clone)]
pub struct SearchContentMatch {
    pub entry: HostEntry,
    pub archive_path: Option<String>,
    pub line_number: usize,
    pub line: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatchView {
    pub entry: BrowseEntryView,
    pub archive_path: Option<String>,
    pub line_number: usize,
    pub line: String,
}

#[derive(Debug, Clone, Copy)]
pub struct SearchContentOptions {
    pub max_results: usize,
    pub max_file_bytes: usize,
    pub max_archive_bytes: usize,
    pub max_archive_depth: usize,
    pub max_scanned_archive_files: usize,
}

#[derive(Debug, Clone, Default)]
pub struct SearchRuntimeOptions {
    pub ignore_patterns: Vec<String>,
    pub cancel_token: Option<Arc<AtomicBool>>,
}

impl SearchRuntimeOptions {
    pub fn new(ignore_patterns: Vec<String>, cancel_token: Option<Arc<AtomicBool>>) -> Self {
        Self {
            ignore_patterns: normalize_ignore_patterns(ignore_patterns),
            cancel_token,
        }
    }
}

pub fn build_listing(
    source: &'static str,
    endpoint: Option<String>,
    working_dir: PathBuf,
    entries: Vec<HostEntry>,
    show_hidden: bool,
) -> BrowseListData {
    let mut explorer = FileExplorerBuilder::new()
        .with_hidden_files(show_hidden)
        .build();
    explorer.wrkdir = working_dir.clone();
    explorer.set_entries(entries);

    let visible_entries: Vec<BrowseEntryView> = explorer
        .iter_entries()
        .map(|entry| BrowseEntryView {
            name: entry.name(),
            path: entry.path.display().to_string(),
            kind: if entry.is_dir() { "directory" } else { "file" },
            hidden: entry.is_hidden(),
            size: entry.metadata.size,
            modified_at: system_time_millis(entry.metadata.modified),
            permissions: entry.metadata.mode.map(format_permissions),
        })
        .collect();

    BrowseListData {
        source,
        endpoint,
        directory: working_dir.display().to_string(),
        total_entries: explorer.iter_entries_all().count(),
        visible_entries: visible_entries.len(),
        entries: visible_entries,
    }
}

pub fn search_entries(
    host: &mut impl HostBridge,
    base_dir: &Path,
    query: &str,
    show_hidden: bool,
    max_results: usize,
) -> HostResult<(Vec<HostEntry>, bool)> {
    search_entries_with_options(
        host,
        base_dir,
        query,
        show_hidden,
        max_results,
        &SearchRuntimeOptions::default(),
    )
}

pub fn search_entries_with_options(
    host: &mut impl HostBridge,
    base_dir: &Path,
    query: &str,
    show_hidden: bool,
    max_results: usize,
    runtime_options: &SearchRuntimeOptions,
) -> HostResult<(Vec<HostEntry>, bool)> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() || max_results == 0 {
        return Ok((Vec::new(), false));
    }

    let mut queue = VecDeque::from([base_dir.to_path_buf()]);
    let mut results = Vec::new();

    while let Some(directory) = queue.pop_front() {
        if search_was_cancelled(runtime_options) {
            return Err(search_cancelled_error());
        }

        let entries = host.list_dir(directory.as_path())?;
        for entry in entries {
            if !show_hidden && entry.is_hidden() {
                continue;
            }
            if entry_is_ignored(&entry, runtime_options) {
                continue;
            }

            if entry.name().to_lowercase().contains(&needle) {
                results.push(entry.clone());
                if results.len() >= max_results {
                    results.sort_by_cached_key(|value| value.path.to_string_lossy().to_lowercase());
                    return Ok((results, true));
                }
            }

            if entry.is_dir() && !entry.metadata.is_symlink {
                queue.push_back(entry.path.clone());
            }
        }
    }

    results.sort_by_cached_key(|value| value.path.to_string_lossy().to_lowercase());
    Ok((results, false))
}

fn normalize_ignore_patterns(patterns: Vec<String>) -> Vec<String> {
    patterns
        .into_iter()
        .map(|pattern| pattern.trim().to_lowercase())
        .filter(|pattern| !pattern.is_empty())
        .take(80)
        .collect()
}

fn search_was_cancelled(options: &SearchRuntimeOptions) -> bool {
    options
        .cancel_token
        .as_ref()
        .is_some_and(|token| token.load(Ordering::SeqCst))
}

fn search_cancelled_error() -> HostError {
    HostError::Io {
        path: String::from("search"),
        source: io::Error::new(io::ErrorKind::Interrupted, "search cancelled"),
    }
}

fn entry_is_ignored(entry: &HostEntry, options: &SearchRuntimeOptions) -> bool {
    path_is_ignored(entry.path.as_path(), entry.name().as_str(), options)
}

fn path_is_ignored(path: &Path, name: &str, options: &SearchRuntimeOptions) -> bool {
    if options.ignore_patterns.is_empty() {
        return false;
    }

    let normalized_name = name.to_lowercase();
    let normalized_path = path.to_string_lossy().replace('\\', "/").to_lowercase();
    options.ignore_patterns.iter().any(|pattern| {
        wildcard_matches(pattern, normalized_name.as_str())
            || wildcard_matches(pattern, normalized_path.as_str())
    })
}

fn wildcard_matches(pattern: &str, value: &str) -> bool {
    if pattern.is_empty() {
        return false;
    }

    let pattern_chars: Vec<char> = pattern.chars().collect();
    let value_chars: Vec<char> = value.chars().collect();
    let mut pattern_index = 0;
    let mut value_index = 0;
    let mut star_index: Option<usize> = None;
    let mut star_value_index = 0;

    while value_index < value_chars.len() {
        if pattern_index < pattern_chars.len()
            && (pattern_chars[pattern_index] == '?'
                || pattern_chars[pattern_index] == value_chars[value_index])
        {
            pattern_index += 1;
            value_index += 1;
            continue;
        }

        if pattern_index < pattern_chars.len() && pattern_chars[pattern_index] == '*' {
            star_index = Some(pattern_index);
            pattern_index += 1;
            star_value_index = value_index;
            continue;
        }

        if let Some(star) = star_index {
            pattern_index = star + 1;
            star_value_index += 1;
            value_index = star_value_index;
            continue;
        }

        return false;
    }

    while pattern_index < pattern_chars.len() && pattern_chars[pattern_index] == '*' {
        pattern_index += 1;
    }

    pattern_index == pattern_chars.len()
}

fn trim_search_line(line: &str, needle: &str) -> String {
    const MAX_LINE_CHARS: usize = 240;
    let trimmed = line.trim();

    let total_chars = trimmed.chars().count();
    if total_chars <= MAX_LINE_CHARS {
        return trimmed.to_string();
    }

    let lowered = trimmed.to_lowercase();
    let match_char_index = lowered
        .find(needle)
        .map(|byte_index| lowered[..byte_index].chars().count())
        .unwrap_or(0);
    let start = match_char_index.saturating_sub(MAX_LINE_CHARS / 3);
    let end = (start + MAX_LINE_CHARS).min(total_chars);
    let mut value: String = trimmed.chars().skip(start).take(end - start).collect();
    if start > 0 {
        value.insert_str(0, "...");
    }
    if end < total_chars {
        value.push_str("...");
    }
    value
}

fn is_probably_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(4096).any(|byte| *byte == 0)
}

fn is_supported_archive_name(name: &str) -> bool {
    let lowered = name.to_ascii_lowercase();
    lowered.ends_with(".tar.gz")
        || lowered.ends_with(".tgz")
        || lowered.ends_with(".tar")
        || lowered.ends_with(".zip")
}

fn read_limited(reader: &mut impl Read, max_bytes: usize) -> std::io::Result<(Vec<u8>, bool)> {
    let mut bytes = Vec::new();
    Read::by_ref(reader)
        .take(max_bytes.saturating_add(1) as u64)
        .read_to_end(&mut bytes)?;
    let truncated = bytes.len() > max_bytes;
    if truncated {
        bytes.truncate(max_bytes);
    }
    Ok((bytes, truncated))
}

fn push_text_matches(
    results: &mut Vec<SearchContentMatch>,
    entry: &HostEntry,
    archive_path: Option<&str>,
    bytes: &[u8],
    needle: &str,
    max_results: usize,
) -> bool {
    if bytes.is_empty() || is_probably_binary(bytes) {
        return false;
    }

    let content = String::from_utf8_lossy(bytes);
    for (line_index, line) in content.lines().enumerate() {
        if !line.to_lowercase().contains(needle) {
            continue;
        }

        results.push(SearchContentMatch {
            entry: entry.clone(),
            archive_path: archive_path.map(str::to_string),
            line_number: line_index + 1,
            line: trim_search_line(line, needle),
        });
        if results.len() >= max_results {
            return true;
        }
    }

    false
}

fn archive_child_path(prefix: Option<&str>, child: &str) -> String {
    match prefix {
        Some(prefix) if !prefix.is_empty() => format!("{prefix}!/{child}"),
        _ => child.to_string(),
    }
}

fn search_tar_archive_contents<R: Read>(
    results: &mut Vec<SearchContentMatch>,
    outer_entry: &HostEntry,
    prefix: Option<&str>,
    reader: R,
    depth: usize,
    needle: &str,
    options: SearchContentOptions,
    scanned_archive_files: &mut usize,
) -> bool {
    let mut archive = tar::Archive::new(reader);
    let entries = match archive.entries() {
        Ok(entries) => entries,
        Err(_) => return false,
    };

    for entry in entries {
        let mut archive_entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if archive_entry.header().entry_type().is_dir() {
            continue;
        }

        let child_name = match archive_entry.path() {
            Ok(path) => path.to_string_lossy().to_string(),
            Err(_) => continue,
        };
        if child_name.is_empty() {
            continue;
        }

        if *scanned_archive_files >= options.max_scanned_archive_files {
            return true;
        }
        *scanned_archive_files += 1;

        let child_path = archive_child_path(prefix, child_name.as_str());
        let child_is_archive =
            depth < options.max_archive_depth && is_supported_archive_name(child_name.as_str());
        let read_limit = if child_is_archive {
            options.max_archive_bytes
        } else {
            options.max_file_bytes
        };
        let (child_bytes, truncated) = match read_limited(&mut archive_entry, read_limit) {
            Ok(result) => result,
            Err(_) => continue,
        };

        if child_is_archive {
            if truncated {
                continue;
            }
            if search_archive_bytes(
                results,
                outer_entry,
                Some(child_path.as_str()),
                child_name.as_str(),
                child_bytes.as_slice(),
                depth + 1,
                needle,
                options,
                scanned_archive_files,
            ) {
                return true;
            }
            continue;
        }

        if push_text_matches(
            results,
            outer_entry,
            Some(child_path.as_str()),
            child_bytes.as_slice(),
            needle,
            options.max_results,
        ) {
            return true;
        }
    }

    false
}

fn search_zip_archive_contents(
    results: &mut Vec<SearchContentMatch>,
    outer_entry: &HostEntry,
    prefix: Option<&str>,
    bytes: &[u8],
    depth: usize,
    needle: &str,
    options: SearchContentOptions,
    scanned_archive_files: &mut usize,
) -> bool {
    let cursor = Cursor::new(bytes);
    let mut archive = match zip::ZipArchive::new(cursor) {
        Ok(archive) => archive,
        Err(_) => return false,
    };

    for index in 0..archive.len() {
        let mut file = match archive.by_index(index) {
            Ok(file) => file,
            Err(_) => continue,
        };
        if file.is_dir() {
            continue;
        }

        let child_name = file.name().to_string();
        if child_name.is_empty() {
            continue;
        }

        if *scanned_archive_files >= options.max_scanned_archive_files {
            return true;
        }
        *scanned_archive_files += 1;

        let child_path = archive_child_path(prefix, child_name.as_str());
        let child_is_archive =
            depth < options.max_archive_depth && is_supported_archive_name(child_name.as_str());
        let read_limit = if child_is_archive {
            options.max_archive_bytes
        } else {
            options.max_file_bytes
        };
        let (child_bytes, truncated) = match read_limited(&mut file, read_limit) {
            Ok(result) => result,
            Err(_) => continue,
        };

        if child_is_archive {
            if truncated {
                continue;
            }
            if search_archive_bytes(
                results,
                outer_entry,
                Some(child_path.as_str()),
                child_name.as_str(),
                child_bytes.as_slice(),
                depth + 1,
                needle,
                options,
                scanned_archive_files,
            ) {
                return true;
            }
            continue;
        }

        if push_text_matches(
            results,
            outer_entry,
            Some(child_path.as_str()),
            child_bytes.as_slice(),
            needle,
            options.max_results,
        ) {
            return true;
        }
    }

    false
}

fn search_archive_bytes(
    results: &mut Vec<SearchContentMatch>,
    outer_entry: &HostEntry,
    prefix: Option<&str>,
    archive_name: &str,
    bytes: &[u8],
    depth: usize,
    needle: &str,
    options: SearchContentOptions,
    scanned_archive_files: &mut usize,
) -> bool {
    let lowered = archive_name.to_ascii_lowercase();
    if lowered.ends_with(".tar.gz") || lowered.ends_with(".tgz") {
        let decoder = GzDecoder::new(Cursor::new(bytes));
        return search_tar_archive_contents(
            results,
            outer_entry,
            prefix,
            decoder,
            depth,
            needle,
            options,
            scanned_archive_files,
        );
    }

    if lowered.ends_with(".tar") {
        return search_tar_archive_contents(
            results,
            outer_entry,
            prefix,
            Cursor::new(bytes),
            depth,
            needle,
            options,
            scanned_archive_files,
        );
    }

    if lowered.ends_with(".zip") {
        return search_zip_archive_contents(
            results,
            outer_entry,
            prefix,
            bytes,
            depth,
            needle,
            options,
            scanned_archive_files,
        );
    }

    false
}

pub fn search_file_contents(
    host: &mut impl HostBridge,
    base_dir: &Path,
    query: &str,
    show_hidden: bool,
    options: SearchContentOptions,
) -> HostResult<(Vec<SearchContentMatch>, bool)> {
    search_file_contents_in_paths_with_options(
        host,
        &[base_dir.to_path_buf()],
        query,
        show_hidden,
        options,
        &SearchRuntimeOptions::default(),
    )
}

pub fn search_file_contents_in_paths(
    host: &mut impl HostBridge,
    target_paths: &[PathBuf],
    query: &str,
    show_hidden: bool,
    options: SearchContentOptions,
) -> HostResult<(Vec<SearchContentMatch>, bool)> {
    search_file_contents_in_paths_with_options(
        host,
        target_paths,
        query,
        show_hidden,
        options,
        &SearchRuntimeOptions::default(),
    )
}

pub fn search_file_contents_in_paths_with_options(
    host: &mut impl HostBridge,
    target_paths: &[PathBuf],
    query: &str,
    show_hidden: bool,
    options: SearchContentOptions,
    runtime_options: &SearchRuntimeOptions,
) -> HostResult<(Vec<SearchContentMatch>, bool)> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty()
        || options.max_results == 0
        || options.max_file_bytes == 0
        || options.max_archive_bytes == 0
        || target_paths.is_empty()
    {
        return Ok((Vec::new(), false));
    }

    let mut queue: VecDeque<(PathBuf, bool)> = target_paths
        .iter()
        .cloned()
        .map(|path| (path, true))
        .collect();
    let mut results = Vec::new();
    let mut scanned_archive_files = 0;

    while let Some((path, is_explicit_target)) = queue.pop_front() {
        if search_was_cancelled(runtime_options) {
            return Err(search_cancelled_error());
        }

        let entry = host.stat(path.as_path())?;
        if !is_explicit_target && !show_hidden && entry.is_hidden() {
            continue;
        }
        if entry_is_ignored(&entry, runtime_options) {
            continue;
        }

        if entry.is_dir() {
            if entry.metadata.is_symlink {
                continue;
            }

            let entries = host.list_dir(entry.path.as_path())?;
            for child in entries {
                queue.push_back((child.path, false));
            }
            continue;
        }

        if entry.metadata.is_symlink {
            continue;
        }

        let is_archive = is_supported_archive_name(entry.name().as_str());
        let read_limit = if is_archive {
            options.max_archive_bytes
        } else {
            options.max_file_bytes
        };
        let preview = match host.read_file_preview(entry.path.as_path(), read_limit) {
            Ok(preview) => preview,
            Err(_) => continue,
        };

        if is_archive {
            if preview.truncated {
                continue;
            }
            if search_archive_bytes(
                &mut results,
                &entry,
                None,
                entry.name().as_str(),
                preview.bytes.as_slice(),
                0,
                needle.as_str(),
                options,
                &mut scanned_archive_files,
            ) {
                results.sort_by_cached_key(|value| {
                    (
                        value.entry.path.to_string_lossy().to_lowercase(),
                        value.archive_path.clone().unwrap_or_default(),
                        value.line_number,
                    )
                });
                return Ok((results, true));
            }
            continue;
        }

        if push_text_matches(
            &mut results,
            &entry,
            None,
            preview.bytes.as_slice(),
            needle.as_str(),
            options.max_results,
        ) {
            results.sort_by_cached_key(|value| {
                (
                    value.entry.path.to_string_lossy().to_lowercase(),
                    value.archive_path.clone().unwrap_or_default(),
                    value.line_number,
                )
            });
            return Ok((results, true));
        }
    }

    results.sort_by_cached_key(|value| {
        (
            value.entry.path.to_string_lossy().to_lowercase(),
            value.archive_path.clone().unwrap_or_default(),
            value.line_number,
        )
    });
    Ok((results, false))
}

fn entry_to_view(entry: HostEntry) -> BrowseEntryView {
    BrowseEntryView {
        name: entry.name(),
        path: entry.path.display().to_string(),
        kind: if entry.is_dir() { "directory" } else { "file" },
        hidden: entry.is_hidden(),
        size: entry.metadata.size,
        modified_at: system_time_millis(entry.metadata.modified),
        permissions: entry.metadata.mode.map(format_permissions),
    }
}

pub fn build_search_results(
    source: &'static str,
    endpoint: Option<String>,
    base_dir: PathBuf,
    query: String,
    entries: Vec<HostEntry>,
    capped: bool,
) -> SearchResultData {
    let visible_entries: Vec<BrowseEntryView> = entries.into_iter().map(entry_to_view).collect();

    SearchResultData {
        source,
        endpoint,
        directory: base_dir.display().to_string(),
        query,
        search_mode: "name",
        total_matches: visible_entries.len(),
        capped,
        entries: visible_entries,
        matches: Vec::new(),
    }
}

pub fn build_content_search_results(
    source: &'static str,
    endpoint: Option<String>,
    base_dir: PathBuf,
    query: String,
    matches: Vec<SearchContentMatch>,
    capped: bool,
) -> SearchResultData {
    let mut seen_paths = HashSet::new();
    let mut entries = Vec::new();
    let mut visible_matches = Vec::new();

    for matched in matches {
        let entry_view = entry_to_view(matched.entry);
        if seen_paths.insert(entry_view.path.clone()) {
            entries.push(entry_view.clone());
        }
        visible_matches.push(SearchMatchView {
            entry: entry_view,
            archive_path: matched.archive_path,
            line_number: matched.line_number,
            line: matched.line,
        });
    }

    SearchResultData {
        source,
        endpoint,
        directory: base_dir.display().to_string(),
        query,
        search_mode: "content",
        total_matches: visible_matches.len(),
        capped,
        entries,
        matches: visible_matches,
    }
}

fn format_permissions(mode: u32) -> String {
    let normalized = mode & 0o7777;
    if normalized > 0o777 {
        format!("{normalized:04o}")
    } else {
        format!("{normalized:03o}")
    }
}

fn system_time_millis(value: Option<SystemTime>) -> Option<u64> {
    value
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
}

impl std::fmt::Display for FileSorting {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let value = match self {
            Self::CreationTime => "by_creation_time",
            Self::ModifyTime => "by_mtime",
            Self::Name => "by_name",
            Self::Size => "by_size",
            Self::None => "none",
        };

        write!(f, "{value}")
    }
}

impl FromStr for FileSorting {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.to_ascii_lowercase().as_str() {
            "by_creation_time" => Ok(Self::CreationTime),
            "by_mtime" => Ok(Self::ModifyTime),
            "by_name" => Ok(Self::Name),
            "by_size" => Ok(Self::Size),
            "none" => Ok(Self::None),
            _ => Err(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::thread::sleep;
    use std::time::Duration;

    use flate2::Compression;
    use flate2::write::GzEncoder;
    use tempfile::tempdir;

    use super::*;
    use crate::core::host::HostBridge;
    use crate::core::host::LocalHost;

    fn test_search_content_options() -> SearchContentOptions {
        SearchContentOptions {
            max_results: 10,
            max_file_bytes: 4096,
            max_archive_bytes: 1024 * 1024,
            max_archive_depth: 1,
            max_scanned_archive_files: 100,
        }
    }

    #[test]
    fn hides_dotfiles_by_default() {
        let temp_dir = tempdir().expect("tempdir");
        fs::write(temp_dir.path().join(".env"), "secret").expect("write hidden");
        fs::write(temp_dir.path().join("notes.txt"), "hello").expect("write visible");
        let mut host = LocalHost::new(temp_dir.path().to_path_buf()).expect("host");
        let entries = host.list_dir(temp_dir.path()).expect("entries");

        let mut explorer = FileExplorer::default();
        explorer.set_entries(entries);

        let names: Vec<String> = explorer.iter_entries().map(HostEntry::name).collect();
        assert_eq!(names, vec!["notes.txt".to_string()]);
    }

    #[test]
    fn sorts_by_size_and_groups_directories_first() {
        let temp_dir = tempdir().expect("tempdir");
        fs::create_dir(temp_dir.path().join("folder")).expect("dir");
        fs::write(temp_dir.path().join("small.txt"), "a").expect("small");
        sleep(Duration::from_millis(5));
        fs::write(temp_dir.path().join("large.txt"), "abcdef").expect("large");
        let mut host = LocalHost::new(temp_dir.path().to_path_buf()).expect("host");
        let entries = host.list_dir(temp_dir.path()).expect("entries");

        let mut explorer = FileExplorerBuilder::new()
            .with_group_dirs(Some(GroupDirs::First))
            .with_file_sorting(FileSorting::Size)
            .build();
        explorer.set_entries(entries);

        let names: Vec<String> = explorer.iter_entries().map(HostEntry::name).collect();
        assert_eq!(
            names,
            vec![
                "folder".to_string(),
                "large.txt".to_string(),
                "small.txt".to_string()
            ]
        );
    }

    #[test]
    fn recursively_searches_matching_entries() {
        let temp_dir = tempdir().expect("tempdir");
        fs::create_dir_all(temp_dir.path().join("docs/design")).expect("nested");
        fs::write(temp_dir.path().join("docs/design/review-notes.md"), "hello").expect("file");
        fs::write(temp_dir.path().join("docs/summary.txt"), "summary").expect("file");

        let mut host = LocalHost::new(temp_dir.path().to_path_buf()).expect("host");
        let (results, capped) =
            search_entries(&mut host, temp_dir.path(), "review", false, 20).expect("search");

        assert!(!capped);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name(), "review-notes.md");
    }

    #[test]
    fn search_hides_dotfiles_when_requested() {
        let temp_dir = tempdir().expect("tempdir");
        fs::write(temp_dir.path().join(".env"), "secret").expect("write hidden");

        let mut host = LocalHost::new(temp_dir.path().to_path_buf()).expect("host");
        let (hidden_results, _) =
            search_entries(&mut host, temp_dir.path(), "env", false, 20).expect("search");
        let (shown_results, _) =
            search_entries(&mut host, temp_dir.path(), "env", true, 20).expect("search");

        assert!(hidden_results.is_empty());
        assert_eq!(shown_results.len(), 1);
        assert_eq!(shown_results[0].name(), ".env");
    }

    #[test]
    fn search_entries_respects_ignore_patterns() {
        let temp_dir = tempdir().expect("tempdir");
        fs::create_dir_all(temp_dir.path().join("logs")).expect("logs dir");
        fs::write(temp_dir.path().join("logs/token-report.txt"), "secret").expect("ignored file");
        fs::write(temp_dir.path().join("review-notes.md"), "review").expect("visible file");

        let mut host = LocalHost::new(temp_dir.path().to_path_buf()).expect("host");
        let options = SearchRuntimeOptions::new(vec![String::from("*token*")], None);
        let (results, capped) =
            search_entries_with_options(&mut host, temp_dir.path(), "t", true, 20, &options)
                .expect("search");

        assert!(!capped);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name(), "review-notes.md");
    }

    #[test]
    fn searches_file_content_recursively() {
        let temp_dir = tempdir().expect("tempdir");
        fs::create_dir_all(temp_dir.path().join("folder")).expect("dir");
        fs::write(
            temp_dir.path().join("folder/notes.txt"),
            "first\nneedle here\n",
        )
        .expect("write match");
        fs::write(temp_dir.path().join("other.txt"), "nothing").expect("write miss");
        let mut host = LocalHost::new(temp_dir.path().to_path_buf()).expect("host");

        let (matches, capped) = search_file_contents(
            &mut host,
            temp_dir.path(),
            "needle",
            false,
            test_search_content_options(),
        )
        .expect("search content");

        assert!(!capped);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].entry.name(), "notes.txt");
        assert_eq!(matches[0].archive_path, None);
        assert_eq!(matches[0].line_number, 2);
        assert_eq!(matches[0].line, "needle here");
    }

    #[test]
    fn searches_selected_file_without_scanning_siblings() {
        let temp_dir = tempdir().expect("tempdir");
        let selected = temp_dir.path().join("selected.txt");
        fs::write(&selected, "needle in selected\n").expect("write selected");
        fs::write(temp_dir.path().join("sibling.txt"), "needle in sibling\n")
            .expect("write sibling");
        let mut host = LocalHost::new(temp_dir.path().to_path_buf()).expect("host");

        let (matches, capped) = search_file_contents_in_paths(
            &mut host,
            &[selected],
            "needle",
            false,
            test_search_content_options(),
        )
        .expect("search selected file");

        assert!(!capped);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].entry.name(), "selected.txt");
        assert_eq!(matches[0].line, "needle in selected");
    }

    #[test]
    fn content_search_respects_ignore_patterns() {
        let temp_dir = tempdir().expect("tempdir");
        fs::write(temp_dir.path().join("token-notes.txt"), "needle\n").expect("ignored file");
        fs::write(temp_dir.path().join("visible-notes.txt"), "needle\n").expect("visible file");
        let mut host = LocalHost::new(temp_dir.path().to_path_buf()).expect("host");
        let runtime_options = SearchRuntimeOptions::new(vec![String::from("*token*")], None);

        let (matches, capped) = search_file_contents_in_paths_with_options(
            &mut host,
            &[temp_dir.path().to_path_buf()],
            "needle",
            true,
            test_search_content_options(),
            &runtime_options,
        )
        .expect("search content");

        assert!(!capped);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].entry.name(), "visible-notes.txt");
    }

    #[test]
    fn searches_truncated_text_file_prefix() {
        let temp_dir = tempdir().expect("tempdir");
        let selected = temp_dir.path().join("bundle.js");
        fs::write(
            &selected,
            format!("needle before limit\n{}", "x".repeat(256)),
        )
        .expect("write selected");
        let mut host = LocalHost::new(temp_dir.path().to_path_buf()).expect("host");
        let mut options = test_search_content_options();
        options.max_file_bytes = 32;

        let (matches, capped) =
            search_file_contents_in_paths(&mut host, &[selected], "needle", false, options)
                .expect("search selected file");

        assert!(!capped);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].entry.name(), "bundle.js");
        assert_eq!(matches[0].line, "needle before limit");
    }

    #[test]
    fn search_centers_content_match_preview_in_long_line() {
        let temp_dir = tempdir().expect("tempdir");
        let selected = temp_dir.path().join("bundle.js");
        fs::write(
            &selected,
            format!("{}needle{}", "a".repeat(300), "b".repeat(300)),
        )
        .expect("write selected");
        let mut host = LocalHost::new(temp_dir.path().to_path_buf()).expect("host");

        let (matches, capped) = search_file_contents_in_paths(
            &mut host,
            &[selected],
            "needle",
            false,
            test_search_content_options(),
        )
        .expect("search selected file");

        assert!(!capped);
        assert_eq!(matches.len(), 1);
        assert!(matches[0].line.starts_with("..."));
        assert!(matches[0].line.contains("needle"));
        assert!(matches[0].line.ends_with("..."));
    }

    #[test]
    fn searches_truncated_archive_text_entry_prefix() {
        let temp_dir = tempdir().expect("tempdir");
        let tar_gz_path = temp_dir.path().join("dist.tar.gz");
        {
            let outer_file = fs::File::create(&tar_gz_path).expect("archive file");
            let encoder = GzEncoder::new(outer_file, Compression::default());
            let mut builder = tar::Builder::new(encoder);
            let mut header = tar::Header::new_gnu();
            let content = format!("needle before limit\n{}", "x".repeat(256));
            header.set_size(content.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder
                .append_data(&mut header, "static/js/app.js", content.as_bytes())
                .expect("append app bundle");
            let encoder = builder.into_inner().expect("finish tar");
            encoder.finish().expect("finish gzip");
        }

        let mut host = LocalHost::new(temp_dir.path().to_path_buf()).expect("host");
        let mut options = test_search_content_options();
        options.max_file_bytes = 32;
        let (matches, capped) =
            search_file_contents_in_paths(&mut host, &[tar_gz_path], "needle", false, options)
                .expect("search archive content");

        assert!(!capped);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].entry.name(), "dist.tar.gz");
        assert_eq!(
            matches[0].archive_path,
            Some("static/js/app.js".to_string())
        );
        assert_eq!(matches[0].line, "needle before limit");
    }

    #[test]
    fn searches_tar_gz_content_with_one_nested_archive() {
        let temp_dir = tempdir().expect("tempdir");
        let nested_tar_gz_path = temp_dir.path().join("nested.tar.gz");
        {
            let nested_file = fs::File::create(&nested_tar_gz_path).expect("nested file");
            let encoder = GzEncoder::new(nested_file, Compression::default());
            let mut builder = tar::Builder::new(encoder);
            let mut header = tar::Header::new_gnu();
            let content = b"inside nested needle\n";
            header.set_size(content.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder
                .append_data(&mut header, "inner/match.txt", &content[..])
                .expect("append nested");
            let encoder = builder.into_inner().expect("finish nested tar");
            encoder.finish().expect("finish nested gzip");
        }

        let outer_tar_gz_path = temp_dir.path().join("release.tar.gz");
        {
            let outer_file = fs::File::create(&outer_tar_gz_path).expect("outer file");
            let encoder = GzEncoder::new(outer_file, Compression::default());
            let mut builder = tar::Builder::new(encoder);
            builder
                .append_path_with_name(&nested_tar_gz_path, "archives/nested.tar.gz")
                .expect("append nested archive");
            let mut header = tar::Header::new_gnu();
            let content = b"outer needle\n";
            header.set_size(content.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder
                .append_data(&mut header, "plain.txt", &content[..])
                .expect("append plain");
            let encoder = builder.into_inner().expect("finish outer tar");
            encoder.finish().expect("finish outer gzip");
        }
        fs::remove_file(&nested_tar_gz_path).expect("remove standalone nested archive");

        let mut host = LocalHost::new(temp_dir.path().to_path_buf()).expect("host");
        let (matches, capped) = search_file_contents_in_paths(
            &mut host,
            &[outer_tar_gz_path],
            "needle",
            false,
            test_search_content_options(),
        )
        .expect("search archive content");

        assert!(!capped);
        assert_eq!(matches.len(), 2);
        let archive_paths: Vec<Option<String>> = matches
            .into_iter()
            .map(|match_item| match_item.archive_path)
            .collect();
        assert!(archive_paths.contains(&Some("plain.txt".to_string())));
        assert!(
            archive_paths.contains(&Some("archives/nested.tar.gz!/inner/match.txt".to_string()))
        );
    }
}
