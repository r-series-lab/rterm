use std::fs;
use std::io::{self, ErrorKind, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use remotefs::fs::{Metadata, UnixPex};
use remotefs::{File as RemoteFile, RemoteError, RemoteErrorType, RemoteFs};
use serde::{Deserialize, Serialize};

use crate::core::connections;
use crate::core::protocols::remotefs_builder::RemoteFsBuilder;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferResult {
    pub direction: &'static str,
    pub source_path: String,
    pub target_path: String,
    pub bytes_transferred: u64,
    pub files_transferred: usize,
    pub skipped: usize,
    pub renamed: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub direction: &'static str,
    pub source_path: String,
    pub target_path: String,
    pub current_path: String,
    pub bytes_transferred: u64,
    pub files_transferred: usize,
    pub skipped: usize,
    pub current_file_bytes: u64,
    pub current_file_total_bytes: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferConflictPolicy {
    Overwrite,
    Skip,
    Rename,
}

impl Default for TransferConflictPolicy {
    fn default() -> Self {
        Self::Overwrite
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferConflictKind {
    ExistingFile,
    TypeMismatch,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferConflict {
    pub source_path: String,
    pub target_path: String,
    pub kind: TransferConflictKind,
}

type ProgressCallback = Arc<dyn Fn(TransferProgress) + Send + Sync>;

#[derive(Clone, Default)]
pub struct TransferOptions {
    cancel_token: Option<Arc<AtomicBool>>,
    progress: Option<ProgressCallback>,
    conflict_policy: TransferConflictPolicy,
}

impl TransferOptions {
    pub fn with_cancel_token(mut self, token: Arc<AtomicBool>) -> Self {
        self.cancel_token = Some(token);
        self
    }

    pub fn with_progress<F>(mut self, callback: F) -> Self
    where
        F: Fn(TransferProgress) + Send + Sync + 'static,
    {
        self.progress = Some(Arc::new(callback));
        self
    }

    pub fn with_conflict_policy(mut self, policy: TransferConflictPolicy) -> Self {
        self.conflict_policy = policy;
        self
    }
}

#[derive(Debug, Default, Clone)]
struct TransferStats {
    bytes_transferred: u64,
    files_transferred: usize,
    skipped: usize,
    renamed: usize,
}

#[derive(Clone)]
struct TransferReporter {
    direction: &'static str,
    source_path: String,
    target_path: String,
    stats: Arc<Mutex<TransferStats>>,
    cancel_token: Option<Arc<AtomicBool>>,
    progress: Option<ProgressCallback>,
}

impl TransferReporter {
    fn new(
        direction: &'static str,
        source_path: &Path,
        target_path: &Path,
        options: TransferOptions,
    ) -> Self {
        Self {
            direction,
            source_path: source_path.display().to_string(),
            target_path: target_path.display().to_string(),
            stats: Arc::new(Mutex::new(TransferStats::default())),
            cancel_token: options.cancel_token,
            progress: options.progress,
        }
    }

    fn snapshot(&self) -> TransferStats {
        self.stats
            .lock()
            .map(|stats| stats.clone())
            .unwrap_or_default()
    }

    fn is_cancelled(&self) -> bool {
        self.cancel_token
            .as_ref()
            .is_some_and(|token| token.load(Ordering::SeqCst))
    }

    fn check_cancelled(&self) -> Result<(), String> {
        if self.is_cancelled() {
            return Err("transfer cancelled".to_string());
        }

        Ok(())
    }

    fn check_cancelled_io(&self) -> io::Result<()> {
        if self.is_cancelled() {
            return Err(io::Error::new(ErrorKind::Interrupted, "transfer cancelled"));
        }

        Ok(())
    }

    fn record_chunk(
        &self,
        current_path: &Path,
        chunk_bytes: u64,
        current_file_bytes: u64,
        current_file_total_bytes: Option<u64>,
    ) -> io::Result<()> {
        self.check_cancelled_io()?;

        let snapshot = match self.stats.lock() {
            Ok(mut stats) => {
                stats.bytes_transferred += chunk_bytes;
                stats.clone()
            }
            Err(_) => TransferStats::default(),
        };

        self.emit(
            current_path,
            current_file_bytes,
            current_file_total_bytes,
            snapshot,
        );
        Ok(())
    }

    fn record_file_complete(&self, current_path: &Path, current_file_total_bytes: Option<u64>) {
        let snapshot = match self.stats.lock() {
            Ok(mut stats) => {
                stats.files_transferred += 1;
                stats.clone()
            }
            Err(_) => TransferStats::default(),
        };

        self.emit(
            current_path,
            current_file_total_bytes.unwrap_or_default(),
            current_file_total_bytes,
            snapshot,
        );
    }

    fn record_skipped(
        &self,
        current_path: &Path,
        current_file_total_bytes: Option<u64>,
        count: usize,
    ) {
        let snapshot = match self.stats.lock() {
            Ok(mut stats) => {
                stats.skipped += count;
                stats.clone()
            }
            Err(_) => TransferStats::default(),
        };

        self.emit(current_path, 0, current_file_total_bytes, snapshot);
    }

    fn record_renamed(&self) {
        if let Ok(mut stats) = self.stats.lock() {
            stats.renamed += 1;
        }
    }

    fn emit(
        &self,
        current_path: &Path,
        current_file_bytes: u64,
        current_file_total_bytes: Option<u64>,
        snapshot: TransferStats,
    ) {
        if let Some(progress) = &self.progress {
            progress(TransferProgress {
                direction: self.direction,
                source_path: self.source_path.clone(),
                target_path: self.target_path.clone(),
                current_path: current_path.display().to_string(),
                bytes_transferred: snapshot.bytes_transferred,
                files_transferred: snapshot.files_transferred,
                skipped: snapshot.skipped,
                current_file_bytes,
                current_file_total_bytes,
            });
        }
    }
}

struct ProgressReader<R> {
    inner: R,
    reporter: TransferReporter,
    current_path: String,
    total_bytes: Option<u64>,
    current_file_bytes: u64,
}

impl<R> ProgressReader<R> {
    fn new(
        inner: R,
        reporter: TransferReporter,
        current_path: &Path,
        total_bytes: Option<u64>,
    ) -> Self {
        Self {
            inner,
            reporter,
            current_path: current_path.display().to_string(),
            total_bytes,
            current_file_bytes: 0,
        }
    }
}

impl<R: Read> Read for ProgressReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.reporter.check_cancelled_io()?;

        let read = self.inner.read(buf)?;
        if read > 0 {
            self.current_file_bytes += read as u64;
            self.reporter.record_chunk(
                Path::new(self.current_path.as_str()),
                read as u64,
                self.current_file_bytes,
                self.total_bytes,
            )?;
        }

        Ok(read)
    }
}

struct ProgressWriter<W> {
    inner: W,
    reporter: TransferReporter,
    current_path: String,
    total_bytes: Option<u64>,
    current_file_bytes: u64,
}

impl<W> ProgressWriter<W> {
    fn new(
        inner: W,
        reporter: TransferReporter,
        current_path: &Path,
        total_bytes: Option<u64>,
    ) -> Self {
        Self {
            inner,
            reporter,
            current_path: current_path.display().to_string(),
            total_bytes,
            current_file_bytes: 0,
        }
    }
}

impl<W: Write> Write for ProgressWriter<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.reporter.check_cancelled_io()?;

        let written = self.inner.write(buf)?;
        if written > 0 {
            self.current_file_bytes += written as u64;
            self.reporter.record_chunk(
                Path::new(self.current_path.as_str()),
                written as u64,
                self.current_file_bytes,
                self.total_bytes,
            )?;
        }

        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

enum ResolvedTarget {
    Transfer { path: PathBuf, renamed: bool },
    Skip,
}

pub fn upload_path(
    remote: &str,
    local_path: impl AsRef<Path>,
    remote_path: impl AsRef<Path>,
) -> Result<TransferResult, String> {
    upload_path_with_options(remote, local_path, remote_path, TransferOptions::default())
}

pub fn upload_path_with_options(
    remote: &str,
    local_path: impl AsRef<Path>,
    remote_path: impl AsRef<Path>,
    options: TransferOptions,
) -> Result<TransferResult, String> {
    let params = connections::parse_remote_spec(remote)?;
    let local_path = local_path.as_ref().to_path_buf();
    let remote_path = remote_path.as_ref().to_path_buf();
    let policy = options.conflict_policy;
    let mut remote = RemoteFsBuilder::build(&params).map_err(|error| error.to_string())?;
    let reporter = TransferReporter::new(
        "upload",
        local_path.as_path(),
        remote_path.as_path(),
        options,
    );

    remote.connect().map_err(|error| error.to_string())?;
    reporter.check_cancelled()?;

    let transfer = upload_entry(
        &mut *remote,
        local_path.as_path(),
        remote_path.as_path(),
        &reporter,
        policy,
    );
    let disconnect_result = remote.disconnect().map_err(|error| error.to_string());

    if transfer.is_ok() {
        disconnect_result?;
    }

    transfer?;
    let stats = reporter.snapshot();

    Ok(TransferResult {
        direction: "upload",
        source_path: local_path.display().to_string(),
        target_path: remote_path.display().to_string(),
        bytes_transferred: stats.bytes_transferred,
        files_transferred: stats.files_transferred,
        skipped: stats.skipped,
        renamed: stats.renamed,
    })
}

pub fn upload_path_with_connected_remote(
    remote: &mut dyn RemoteFs,
    local_path: impl AsRef<Path>,
    remote_path: impl AsRef<Path>,
    options: TransferOptions,
) -> Result<TransferResult, String> {
    let local_path = local_path.as_ref().to_path_buf();
    let remote_path = remote_path.as_ref().to_path_buf();
    let policy = options.conflict_policy;
    let reporter = TransferReporter::new(
        "upload",
        local_path.as_path(),
        remote_path.as_path(),
        options,
    );

    reporter.check_cancelled()?;
    upload_entry(
        remote,
        local_path.as_path(),
        remote_path.as_path(),
        &reporter,
        policy,
    )?;
    let stats = reporter.snapshot();

    Ok(TransferResult {
        direction: "upload",
        source_path: local_path.display().to_string(),
        target_path: remote_path.display().to_string(),
        bytes_transferred: stats.bytes_transferred,
        files_transferred: stats.files_transferred,
        skipped: stats.skipped,
        renamed: stats.renamed,
    })
}

pub fn download_path(
    remote: &str,
    remote_path: impl AsRef<Path>,
    local_path: impl AsRef<Path>,
) -> Result<TransferResult, String> {
    download_path_with_options(remote, remote_path, local_path, TransferOptions::default())
}

pub fn download_path_with_options(
    remote: &str,
    remote_path: impl AsRef<Path>,
    local_path: impl AsRef<Path>,
    options: TransferOptions,
) -> Result<TransferResult, String> {
    let params = connections::parse_remote_spec(remote)?;
    let remote_path = remote_path.as_ref().to_path_buf();
    let local_path = local_path.as_ref().to_path_buf();
    let policy = options.conflict_policy;
    let mut remote = RemoteFsBuilder::build(&params).map_err(|error| error.to_string())?;
    let reporter = TransferReporter::new(
        "download",
        remote_path.as_path(),
        local_path.as_path(),
        options,
    );

    remote.connect().map_err(|error| error.to_string())?;
    reporter.check_cancelled()?;

    let transfer = download_entry(
        &mut *remote,
        remote_path.as_path(),
        local_path.as_path(),
        &reporter,
        policy,
    );
    let disconnect_result = remote.disconnect().map_err(|error| error.to_string());

    if transfer.is_ok() {
        disconnect_result?;
    }

    transfer?;
    let stats = reporter.snapshot();

    Ok(TransferResult {
        direction: "download",
        source_path: remote_path.display().to_string(),
        target_path: local_path.display().to_string(),
        bytes_transferred: stats.bytes_transferred,
        files_transferred: stats.files_transferred,
        skipped: stats.skipped,
        renamed: stats.renamed,
    })
}

pub fn download_path_with_connected_remote(
    remote: &mut dyn RemoteFs,
    remote_path: impl AsRef<Path>,
    local_path: impl AsRef<Path>,
    options: TransferOptions,
) -> Result<TransferResult, String> {
    let remote_path = remote_path.as_ref().to_path_buf();
    let local_path = local_path.as_ref().to_path_buf();
    let policy = options.conflict_policy;
    let reporter = TransferReporter::new(
        "download",
        remote_path.as_path(),
        local_path.as_path(),
        options,
    );

    reporter.check_cancelled()?;
    download_entry(
        remote,
        remote_path.as_path(),
        local_path.as_path(),
        &reporter,
        policy,
    )?;
    let stats = reporter.snapshot();

    Ok(TransferResult {
        direction: "download",
        source_path: remote_path.display().to_string(),
        target_path: local_path.display().to_string(),
        bytes_transferred: stats.bytes_transferred,
        files_transferred: stats.files_transferred,
        skipped: stats.skipped,
        renamed: stats.renamed,
    })
}

pub fn copy_remote_path(
    source_remote: &str,
    source_path: impl AsRef<Path>,
    target_remote: &str,
    target_path: impl AsRef<Path>,
) -> Result<TransferResult, String> {
    copy_remote_path_with_options(
        source_remote,
        source_path,
        target_remote,
        target_path,
        TransferOptions::default(),
    )
}

pub fn copy_remote_path_with_options(
    source_remote: &str,
    source_path: impl AsRef<Path>,
    target_remote: &str,
    target_path: impl AsRef<Path>,
    options: TransferOptions,
) -> Result<TransferResult, String> {
    let source_params = connections::parse_remote_spec(source_remote)?;
    let source_path = source_path.as_ref().to_path_buf();
    let target_path = target_path.as_ref().to_path_buf();
    let mut source = RemoteFsBuilder::build(&source_params).map_err(|error| error.to_string())?;

    source.connect().map_err(|error| error.to_string())?;
    let transfer = copy_remote_path_with_connected_source(
        &mut *source,
        target_remote,
        source_path.as_path(),
        target_path.as_path(),
        options,
    );
    let disconnect_result = source.disconnect().map_err(|error| error.to_string());

    if transfer.is_ok() {
        disconnect_result?;
    }

    transfer
}

pub fn copy_remote_path_with_connected_source(
    source: &mut dyn RemoteFs,
    target_remote: &str,
    source_path: impl AsRef<Path>,
    target_path: impl AsRef<Path>,
    options: TransferOptions,
) -> Result<TransferResult, String> {
    let target_params = connections::parse_remote_spec(target_remote)?;
    let source_path = source_path.as_ref().to_path_buf();
    let target_path = target_path.as_ref().to_path_buf();
    let policy = options.conflict_policy;
    let mut target = RemoteFsBuilder::build(&target_params).map_err(|error| error.to_string())?;
    let reporter = TransferReporter::new(
        "remoteCopy",
        source_path.as_path(),
        target_path.as_path(),
        options,
    );

    target.connect().map_err(|error| error.to_string())?;
    reporter.check_cancelled()?;

    let transfer = copy_remote_entry(
        source,
        &mut *target,
        source_path.as_path(),
        target_path.as_path(),
        &reporter,
        policy,
    );
    let disconnect_result = target.disconnect().map_err(|error| error.to_string());

    if transfer.is_ok() {
        disconnect_result?;
    }

    transfer?;
    let stats = reporter.snapshot();

    Ok(TransferResult {
        direction: "remoteCopy",
        source_path: source_path.display().to_string(),
        target_path: target_path.display().to_string(),
        bytes_transferred: stats.bytes_transferred,
        files_transferred: stats.files_transferred,
        skipped: stats.skipped,
        renamed: stats.renamed,
    })
}

pub fn inspect_upload_conflicts(
    remote: &str,
    local_path: impl AsRef<Path>,
    remote_path: impl AsRef<Path>,
) -> Result<Vec<TransferConflict>, String> {
    let params = connections::parse_remote_spec(remote)?;
    let local_path = local_path.as_ref().to_path_buf();
    let remote_path = remote_path.as_ref().to_path_buf();
    let mut remote = RemoteFsBuilder::build(&params).map_err(|error| error.to_string())?;

    remote.connect().map_err(|error| error.to_string())?;
    let mut conflicts = Vec::new();
    let inspect = inspect_upload_entry(
        &mut *remote,
        local_path.as_path(),
        remote_path.as_path(),
        &mut conflicts,
    );
    let disconnect_result = remote.disconnect().map_err(|error| error.to_string());

    if inspect.is_ok() {
        disconnect_result?;
    }

    inspect?;
    Ok(conflicts)
}

pub fn inspect_upload_conflicts_with_connected_remote(
    remote: &mut dyn RemoteFs,
    local_path: impl AsRef<Path>,
    remote_path: impl AsRef<Path>,
) -> Result<Vec<TransferConflict>, String> {
    let local_path = local_path.as_ref().to_path_buf();
    let remote_path = remote_path.as_ref().to_path_buf();
    let mut conflicts = Vec::new();

    inspect_upload_entry(
        remote,
        local_path.as_path(),
        remote_path.as_path(),
        &mut conflicts,
    )?;

    Ok(conflicts)
}

pub fn inspect_download_conflicts(
    remote: &str,
    remote_path: impl AsRef<Path>,
    local_path: impl AsRef<Path>,
) -> Result<Vec<TransferConflict>, String> {
    let params = connections::parse_remote_spec(remote)?;
    let remote_path = remote_path.as_ref().to_path_buf();
    let local_path = local_path.as_ref().to_path_buf();
    let mut remote = RemoteFsBuilder::build(&params).map_err(|error| error.to_string())?;

    remote.connect().map_err(|error| error.to_string())?;
    let mut conflicts = Vec::new();
    let inspect = inspect_download_entry(
        &mut *remote,
        remote_path.as_path(),
        local_path.as_path(),
        &mut conflicts,
    );
    let disconnect_result = remote.disconnect().map_err(|error| error.to_string());

    if inspect.is_ok() {
        disconnect_result?;
    }

    inspect?;
    Ok(conflicts)
}

pub fn inspect_download_conflicts_with_connected_remote(
    remote: &mut dyn RemoteFs,
    remote_path: impl AsRef<Path>,
    local_path: impl AsRef<Path>,
) -> Result<Vec<TransferConflict>, String> {
    let remote_path = remote_path.as_ref().to_path_buf();
    let local_path = local_path.as_ref().to_path_buf();
    let mut conflicts = Vec::new();

    inspect_download_entry(
        remote,
        remote_path.as_path(),
        local_path.as_path(),
        &mut conflicts,
    )?;

    Ok(conflicts)
}

pub fn inspect_remote_copy_conflicts(
    source_remote: &str,
    source_path: impl AsRef<Path>,
    target_remote: &str,
    target_path: impl AsRef<Path>,
) -> Result<Vec<TransferConflict>, String> {
    let source_params = connections::parse_remote_spec(source_remote)?;
    let source_path = source_path.as_ref().to_path_buf();
    let target_path = target_path.as_ref().to_path_buf();
    let mut source = RemoteFsBuilder::build(&source_params).map_err(|error| error.to_string())?;

    source.connect().map_err(|error| error.to_string())?;
    let inspect = inspect_remote_copy_conflicts_with_connected_source(
        &mut *source,
        source_path.as_path(),
        target_remote,
        target_path.as_path(),
    );
    let disconnect_result = source.disconnect().map_err(|error| error.to_string());

    if inspect.is_ok() {
        disconnect_result?;
    }

    inspect
}

pub fn inspect_remote_copy_conflicts_with_connected_source(
    source: &mut dyn RemoteFs,
    source_path: impl AsRef<Path>,
    target_remote: &str,
    target_path: impl AsRef<Path>,
) -> Result<Vec<TransferConflict>, String> {
    let target_params = connections::parse_remote_spec(target_remote)?;
    let source_path = source_path.as_ref().to_path_buf();
    let target_path = target_path.as_ref().to_path_buf();
    let mut target = RemoteFsBuilder::build(&target_params).map_err(|error| error.to_string())?;

    target.connect().map_err(|error| error.to_string())?;
    let mut conflicts = Vec::new();
    let inspect = inspect_remote_copy_entry(
        source,
        &mut *target,
        source_path.as_path(),
        target_path.as_path(),
        &mut conflicts,
    );
    let disconnect_result = target.disconnect().map_err(|error| error.to_string());

    if inspect.is_ok() {
        disconnect_result?;
    }

    inspect?;
    Ok(conflicts)
}

fn upload_entry(
    remote: &mut dyn RemoteFs,
    local_path: &Path,
    remote_path: &Path,
    reporter: &TransferReporter,
    policy: TransferConflictPolicy,
) -> Result<(), String> {
    reporter.check_cancelled()?;

    let metadata = fs::metadata(local_path).map_err(|error| {
        format!(
            "failed to stat local path {}: {error}",
            local_path.display()
        )
    })?;

    if metadata.is_dir() {
        return upload_directory(remote, local_path, remote_path, reporter, policy);
    }

    if !metadata.is_file() {
        return Err(format!(
            "unsupported local entry type for transfer: {}",
            local_path.display()
        ));
    }

    let remote_metadata = Metadata::from(metadata);
    let total_bytes = Some(remote_metadata.size);
    let resolution = resolve_upload_file_target(
        remote,
        local_path,
        remote_path,
        &remote_metadata,
        reporter,
        policy,
    )?;

    let ResolvedTarget::Transfer { path, renamed } = resolution else {
        return Ok(());
    };

    let reader = fs::File::open(local_path).map_err(|error| {
        format!(
            "failed to open local file {}: {error}",
            local_path.display()
        )
    })?;
    let progress_reader = ProgressReader::new(reader, reporter.clone(), local_path, total_bytes);

    match remote.create_file(path.as_path(), &remote_metadata, Box::new(progress_reader)) {
        Ok(_) => {
            if renamed {
                reporter.record_renamed();
            }
            reporter.record_file_complete(local_path, total_bytes);
            let _ = remote.setstat(path.as_path(), remote_metadata);
            Ok(())
        }
        Err(error) => {
            let _ = remote.remove_file(path.as_path());
            if reporter.is_cancelled() {
                Err("transfer cancelled".to_string())
            } else {
                Err(format!(
                    "failed to upload {} to {}: {error}",
                    local_path.display(),
                    path.display()
                ))
            }
        }
    }
}

fn upload_directory(
    remote: &mut dyn RemoteFs,
    local_path: &Path,
    remote_path: &Path,
    reporter: &TransferReporter,
    policy: TransferConflictPolicy,
) -> Result<(), String> {
    match remote_path_entry(remote, remote_path)? {
        Some(entry) if entry.is_file() => match policy {
            TransferConflictPolicy::Rename => {
                let renamed_path = next_available_remote_path(remote, remote_path, true)?;
                create_remote_dir(remote, renamed_path.as_path())?;
                upload_directory_contents(
                    remote,
                    local_path,
                    renamed_path.as_path(),
                    reporter,
                    policy,
                )?;
                reporter.record_renamed();
                let metadata = fs::metadata(local_path)
                    .map(Metadata::from)
                    .map_err(|error| {
                        format!(
                            "failed to stat local path {}: {error}",
                            local_path.display()
                        )
                    })?;
                let _ = remote.setstat(renamed_path.as_path(), metadata);
                Ok(())
            }
            TransferConflictPolicy::Overwrite | TransferConflictPolicy::Skip => {
                let skipped = count_local_transfer_items(local_path)?;
                reporter.record_skipped(local_path, None, skipped);
                Ok(())
            }
        },
        _ => {
            create_remote_dir(remote, remote_path)?;
            upload_directory_contents(remote, local_path, remote_path, reporter, policy)?;
            let metadata = fs::metadata(local_path)
                .map(Metadata::from)
                .map_err(|error| {
                    format!(
                        "failed to stat local path {}: {error}",
                        local_path.display()
                    )
                })?;
            let _ = remote.setstat(remote_path, metadata);
            Ok(())
        }
    }
}

fn upload_directory_contents(
    remote: &mut dyn RemoteFs,
    local_path: &Path,
    remote_path: &Path,
    reporter: &TransferReporter,
    policy: TransferConflictPolicy,
) -> Result<(), String> {
    for entry in fs::read_dir(local_path).map_err(|error| {
        format!(
            "failed to scan local directory {}: {error}",
            local_path.display()
        )
    })? {
        reporter.check_cancelled()?;

        let entry = entry.map_err(|error| {
            format!(
                "failed to read local directory {}: {error}",
                local_path.display()
            )
        })?;
        let child_path = entry.path();
        let child_remote_path = remote_path.join(entry.file_name());
        upload_entry(
            remote,
            child_path.as_path(),
            child_remote_path.as_path(),
            reporter,
            policy,
        )?;
    }

    Ok(())
}

fn download_entry(
    remote: &mut dyn RemoteFs,
    remote_path: &Path,
    local_path: &Path,
    reporter: &TransferReporter,
    policy: TransferConflictPolicy,
) -> Result<(), String> {
    reporter.check_cancelled()?;

    let remote_entry = remote.stat(remote_path).map_err(|error| {
        format!(
            "failed to stat remote path {}: {error}",
            remote_path.display()
        )
    })?;

    if remote_entry.is_dir() {
        return download_directory(remote, remote_path, local_path, reporter, policy);
    }

    if !remote_entry.is_file() {
        return Err(format!(
            "unsupported remote entry type for transfer: {}",
            remote_path.display()
        ));
    }

    let remote_metadata = remote_entry.metadata().clone();
    let total_bytes = Some(remote_metadata.size);
    let resolution =
        resolve_download_file_target(local_path, remote_path, &remote_metadata, reporter, policy)?;

    let ResolvedTarget::Transfer { path, renamed } = resolution else {
        return Ok(());
    };

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create local directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let writer = fs::File::create(path.as_path())
        .map_err(|error| format!("failed to create local file {}: {error}", path.display()))?;
    let progress_writer = ProgressWriter::new(writer, reporter.clone(), remote_path, total_bytes);

    match remote.open_file(remote_path, Box::new(progress_writer)) {
        Ok(_) => {
            if renamed {
                reporter.record_renamed();
            }
            reporter.record_file_complete(remote_path, total_bytes);
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_file(path.as_path());
            if reporter.is_cancelled() {
                Err("transfer cancelled".to_string())
            } else {
                Err(format!(
                    "failed to download {} to {}: {error}",
                    remote_path.display(),
                    path.display()
                ))
            }
        }
    }
}

fn download_directory(
    remote: &mut dyn RemoteFs,
    remote_path: &Path,
    local_path: &Path,
    reporter: &TransferReporter,
    policy: TransferConflictPolicy,
) -> Result<(), String> {
    match local_path_entry(local_path)? {
        Some(metadata) if metadata.is_file() => match policy {
            TransferConflictPolicy::Rename => {
                let renamed_path = next_available_local_path(local_path, true)?;
                fs::create_dir_all(renamed_path.as_path()).map_err(|error| {
                    format!(
                        "failed to create local directory {}: {error}",
                        renamed_path.display()
                    )
                })?;
                download_directory_contents(
                    remote,
                    remote_path,
                    renamed_path.as_path(),
                    reporter,
                    policy,
                )?;
                reporter.record_renamed();
                Ok(())
            }
            TransferConflictPolicy::Overwrite | TransferConflictPolicy::Skip => {
                let skipped = count_remote_transfer_items(remote, remote_path)?;
                reporter.record_skipped(remote_path, None, skipped);
                Ok(())
            }
        },
        _ => {
            fs::create_dir_all(local_path).map_err(|error| {
                format!(
                    "failed to create local directory {}: {error}",
                    local_path.display()
                )
            })?;
            download_directory_contents(remote, remote_path, local_path, reporter, policy)
        }
    }
}

fn download_directory_contents(
    remote: &mut dyn RemoteFs,
    remote_path: &Path,
    local_path: &Path,
    reporter: &TransferReporter,
    policy: TransferConflictPolicy,
) -> Result<(), String> {
    let entries = remote.list_dir(remote_path).map_err(|error| {
        format!(
            "failed to scan remote directory {}: {error}",
            remote_path.display()
        )
    })?;

    for entry in entries
        .into_iter()
        .filter(|entry| !is_self_reference(remote_path, entry))
    {
        reporter.check_cancelled()?;

        let child_local_path = local_path.join(entry.name());
        download_entry(
            remote,
            entry.path(),
            child_local_path.as_path(),
            reporter,
            policy,
        )?;
    }

    Ok(())
}

fn copy_remote_entry(
    source: &mut dyn RemoteFs,
    target: &mut dyn RemoteFs,
    source_path: &Path,
    target_path: &Path,
    reporter: &TransferReporter,
    policy: TransferConflictPolicy,
) -> Result<(), String> {
    reporter.check_cancelled()?;

    let source_entry = source.stat(source_path).map_err(|error| {
        format!(
            "failed to stat source remote path {}: {error}",
            source_path.display()
        )
    })?;

    if source_entry.is_dir() {
        return copy_remote_directory(source, target, source_path, target_path, reporter, policy);
    }

    if !source_entry.is_file() {
        return Err(format!(
            "unsupported source remote entry type for transfer: {}",
            source_path.display()
        ));
    }

    let source_metadata = source_entry.metadata().clone();
    let total_bytes = Some(source_metadata.size);
    let resolution = resolve_upload_file_target(
        target,
        source_path,
        target_path,
        &source_metadata,
        reporter,
        policy,
    )?;

    let ResolvedTarget::Transfer { path, renamed } = resolution else {
        return Ok(());
    };

    let mut source_stream = source.open(source_path).map_err(|error| {
        format!(
            "failed to open source remote file {}: {error}",
            source_path.display()
        )
    })?;

    let mut target_stream = match target.create(path.as_path(), &source_metadata) {
        Ok(stream) => stream,
        Err(error) => {
            let _ = source.on_read(source_stream);
            return Err(format!(
                "failed to create target remote file {}: {error}",
                path.display()
            ));
        }
    };

    let copy_result = {
        let mut progress_reader = ProgressReader::new(
            &mut source_stream,
            reporter.clone(),
            source_path,
            total_bytes,
        );
        io::copy(&mut progress_reader, &mut target_stream)
    };
    let flush_result = if copy_result.is_ok() {
        target_stream.flush()
    } else {
        Ok(())
    };
    let write_finalize = target.on_written(target_stream);
    let read_finalize = source.on_read(source_stream);

    match (copy_result, flush_result, write_finalize, read_finalize) {
        (Ok(_), Ok(_), Ok(_), Ok(_)) => {
            if renamed {
                reporter.record_renamed();
            }
            reporter.record_file_complete(source_path, total_bytes);
            let _ = target.setstat(path.as_path(), source_metadata);
            Ok(())
        }
        (copy_result, flush_result, write_finalize, read_finalize) => {
            let _ = target.remove_file(path.as_path());

            if reporter.is_cancelled() {
                return Err("transfer cancelled".to_string());
            }

            let detail = match copy_result {
                Err(error) => error.to_string(),
                Ok(_) => match flush_result {
                    Err(error) => error.to_string(),
                    Ok(_) => match write_finalize {
                        Err(error) => error.to_string(),
                        Ok(_) => read_finalize
                            .err()
                            .map(|error| error.to_string())
                            .unwrap_or_else(|| "unknown transfer finalization error".to_string()),
                    },
                },
            };

            Err(format!(
                "failed to copy {} to {} through local stream: {detail}",
                source_path.display(),
                path.display()
            ))
        }
    }
}

fn copy_remote_directory(
    source: &mut dyn RemoteFs,
    target: &mut dyn RemoteFs,
    source_path: &Path,
    target_path: &Path,
    reporter: &TransferReporter,
    policy: TransferConflictPolicy,
) -> Result<(), String> {
    match remote_path_entry(target, target_path)? {
        Some(entry) if entry.is_file() => match policy {
            TransferConflictPolicy::Rename => {
                let renamed_path = next_available_remote_path(target, target_path, true)?;
                create_remote_dir(target, renamed_path.as_path())?;
                copy_remote_directory_contents(
                    source,
                    target,
                    source_path,
                    renamed_path.as_path(),
                    reporter,
                    policy,
                )?;
                reporter.record_renamed();
                if let Ok(source_entry) = source.stat(source_path) {
                    let _ = target.setstat(renamed_path.as_path(), source_entry.metadata().clone());
                }
                Ok(())
            }
            TransferConflictPolicy::Overwrite | TransferConflictPolicy::Skip => {
                let skipped = count_remote_transfer_items(source, source_path)?;
                reporter.record_skipped(source_path, None, skipped);
                Ok(())
            }
        },
        _ => {
            create_remote_dir(target, target_path)?;
            copy_remote_directory_contents(
                source,
                target,
                source_path,
                target_path,
                reporter,
                policy,
            )?;
            if let Ok(source_entry) = source.stat(source_path) {
                let _ = target.setstat(target_path, source_entry.metadata().clone());
            }
            Ok(())
        }
    }
}

fn copy_remote_directory_contents(
    source: &mut dyn RemoteFs,
    target: &mut dyn RemoteFs,
    source_path: &Path,
    target_path: &Path,
    reporter: &TransferReporter,
    policy: TransferConflictPolicy,
) -> Result<(), String> {
    let entries = source.list_dir(source_path).map_err(|error| {
        format!(
            "failed to scan source remote directory {}: {error}",
            source_path.display()
        )
    })?;

    for entry in entries
        .into_iter()
        .filter(|entry| !is_self_reference(source_path, entry))
    {
        reporter.check_cancelled()?;

        let child_target_path = target_path.join(entry.name());
        copy_remote_entry(
            source,
            target,
            entry.path(),
            child_target_path.as_path(),
            reporter,
            policy,
        )?;
    }

    Ok(())
}

fn inspect_upload_entry(
    remote: &mut dyn RemoteFs,
    local_path: &Path,
    remote_path: &Path,
    conflicts: &mut Vec<TransferConflict>,
) -> Result<(), String> {
    let metadata = fs::metadata(local_path).map_err(|error| {
        format!(
            "failed to stat local path {}: {error}",
            local_path.display()
        )
    })?;

    if metadata.is_dir() {
        match remote_path_entry(remote, remote_path)? {
            Some(entry) if entry.is_file() => {
                conflicts.push(TransferConflict {
                    source_path: local_path.display().to_string(),
                    target_path: remote_path.display().to_string(),
                    kind: TransferConflictKind::TypeMismatch,
                });
                Ok(())
            }
            Some(entry) if entry.is_dir() => {
                for entry in fs::read_dir(local_path).map_err(|error| {
                    format!(
                        "failed to scan local directory {}: {error}",
                        local_path.display()
                    )
                })? {
                    let entry = entry.map_err(|error| {
                        format!(
                            "failed to read local directory {}: {error}",
                            local_path.display()
                        )
                    })?;
                    let child_path = entry.path();
                    let child_remote_path = remote_path.join(entry.file_name());
                    inspect_upload_entry(
                        remote,
                        child_path.as_path(),
                        child_remote_path.as_path(),
                        conflicts,
                    )?;
                }
                Ok(())
            }
            _ => Ok(()),
        }
    } else if metadata.is_file() {
        let source_metadata = Metadata::from(metadata);
        match remote_path_entry(remote, remote_path)? {
            Some(entry) if entry.is_dir() => {
                conflicts.push(TransferConflict {
                    source_path: local_path.display().to_string(),
                    target_path: remote_path.display().to_string(),
                    kind: TransferConflictKind::TypeMismatch,
                });
            }
            Some(entry) if entry.is_file() => {
                if metadata_differs(&source_metadata, entry.metadata()) {
                    conflicts.push(TransferConflict {
                        source_path: local_path.display().to_string(),
                        target_path: remote_path.display().to_string(),
                        kind: TransferConflictKind::ExistingFile,
                    });
                }
            }
            _ => {}
        }
        Ok(())
    } else {
        Err(format!(
            "unsupported local entry type for transfer: {}",
            local_path.display()
        ))
    }
}

fn inspect_download_entry(
    remote: &mut dyn RemoteFs,
    remote_path: &Path,
    local_path: &Path,
    conflicts: &mut Vec<TransferConflict>,
) -> Result<(), String> {
    let remote_entry = remote.stat(remote_path).map_err(|error| {
        format!(
            "failed to stat remote path {}: {error}",
            remote_path.display()
        )
    })?;

    if remote_entry.is_dir() {
        match local_path_entry(local_path)? {
            Some(metadata) if metadata.is_file() => {
                conflicts.push(TransferConflict {
                    source_path: remote_path.display().to_string(),
                    target_path: local_path.display().to_string(),
                    kind: TransferConflictKind::TypeMismatch,
                });
                Ok(())
            }
            Some(metadata) if metadata.is_dir() => {
                let entries = remote.list_dir(remote_path).map_err(|error| {
                    format!(
                        "failed to scan remote directory {}: {error}",
                        remote_path.display()
                    )
                })?;

                for entry in entries
                    .into_iter()
                    .filter(|entry| !is_self_reference(remote_path, entry))
                {
                    let child_local_path = local_path.join(entry.name());
                    inspect_download_entry(
                        remote,
                        entry.path(),
                        child_local_path.as_path(),
                        conflicts,
                    )?;
                }

                Ok(())
            }
            _ => Ok(()),
        }
    } else if remote_entry.is_file() {
        let remote_metadata = remote_entry.metadata().clone();
        match local_path_entry(local_path)? {
            Some(metadata) if metadata.is_dir() => {
                conflicts.push(TransferConflict {
                    source_path: remote_path.display().to_string(),
                    target_path: local_path.display().to_string(),
                    kind: TransferConflictKind::TypeMismatch,
                });
            }
            Some(metadata) if metadata.is_file() => {
                let local_metadata = Metadata::from(metadata);
                if metadata_differs(&local_metadata, &remote_metadata) {
                    conflicts.push(TransferConflict {
                        source_path: remote_path.display().to_string(),
                        target_path: local_path.display().to_string(),
                        kind: TransferConflictKind::ExistingFile,
                    });
                }
            }
            _ => {}
        }
        Ok(())
    } else {
        Err(format!(
            "unsupported remote entry type for transfer: {}",
            remote_path.display()
        ))
    }
}

fn inspect_remote_copy_entry(
    source: &mut dyn RemoteFs,
    target: &mut dyn RemoteFs,
    source_path: &Path,
    target_path: &Path,
    conflicts: &mut Vec<TransferConflict>,
) -> Result<(), String> {
    let source_entry = source.stat(source_path).map_err(|error| {
        format!(
            "failed to stat source remote path {}: {error}",
            source_path.display()
        )
    })?;

    if source_entry.is_dir() {
        match remote_path_entry(target, target_path)? {
            Some(entry) if entry.is_file() => {
                conflicts.push(TransferConflict {
                    source_path: source_path.display().to_string(),
                    target_path: target_path.display().to_string(),
                    kind: TransferConflictKind::TypeMismatch,
                });
                Ok(())
            }
            Some(entry) if entry.is_dir() => {
                let entries = source.list_dir(source_path).map_err(|error| {
                    format!(
                        "failed to scan source remote directory {}: {error}",
                        source_path.display()
                    )
                })?;

                for entry in entries
                    .into_iter()
                    .filter(|entry| !is_self_reference(source_path, entry))
                {
                    let child_target_path = target_path.join(entry.name());
                    inspect_remote_copy_entry(
                        source,
                        target,
                        entry.path(),
                        child_target_path.as_path(),
                        conflicts,
                    )?;
                }

                Ok(())
            }
            _ => Ok(()),
        }
    } else if source_entry.is_file() {
        let source_metadata = source_entry.metadata().clone();
        match remote_path_entry(target, target_path)? {
            Some(entry) if entry.is_dir() => {
                conflicts.push(TransferConflict {
                    source_path: source_path.display().to_string(),
                    target_path: target_path.display().to_string(),
                    kind: TransferConflictKind::TypeMismatch,
                });
            }
            Some(entry) if entry.is_file() => {
                if metadata_differs(&source_metadata, entry.metadata()) {
                    conflicts.push(TransferConflict {
                        source_path: source_path.display().to_string(),
                        target_path: target_path.display().to_string(),
                        kind: TransferConflictKind::ExistingFile,
                    });
                }
            }
            _ => {}
        }
        Ok(())
    } else {
        Err(format!(
            "unsupported source remote entry type for transfer: {}",
            source_path.display()
        ))
    }
}

fn resolve_upload_file_target(
    remote: &mut dyn RemoteFs,
    local_path: &Path,
    remote_path: &Path,
    local_metadata: &Metadata,
    reporter: &TransferReporter,
    policy: TransferConflictPolicy,
) -> Result<ResolvedTarget, String> {
    match remote_path_entry(remote, remote_path)? {
        Some(entry) if entry.is_dir() => match policy {
            TransferConflictPolicy::Rename => Ok(ResolvedTarget::Transfer {
                path: next_available_remote_path(remote, remote_path, false)?,
                renamed: true,
            }),
            TransferConflictPolicy::Overwrite | TransferConflictPolicy::Skip => {
                reporter.record_skipped(local_path, Some(local_metadata.size), 1);
                Ok(ResolvedTarget::Skip)
            }
        },
        Some(entry) if entry.is_file() => {
            if !metadata_differs(local_metadata, entry.metadata()) {
                reporter.record_skipped(local_path, Some(local_metadata.size), 1);
                return Ok(ResolvedTarget::Skip);
            }

            match policy {
                TransferConflictPolicy::Overwrite => Ok(ResolvedTarget::Transfer {
                    path: remote_path.to_path_buf(),
                    renamed: false,
                }),
                TransferConflictPolicy::Skip => {
                    reporter.record_skipped(local_path, Some(local_metadata.size), 1);
                    Ok(ResolvedTarget::Skip)
                }
                TransferConflictPolicy::Rename => Ok(ResolvedTarget::Transfer {
                    path: next_available_remote_path(remote, remote_path, false)?,
                    renamed: true,
                }),
            }
        }
        _ => Ok(ResolvedTarget::Transfer {
            path: remote_path.to_path_buf(),
            renamed: false,
        }),
    }
}

fn resolve_download_file_target(
    local_path: &Path,
    remote_path: &Path,
    remote_metadata: &Metadata,
    reporter: &TransferReporter,
    policy: TransferConflictPolicy,
) -> Result<ResolvedTarget, String> {
    match local_path_entry(local_path)? {
        Some(metadata) if metadata.is_dir() => match policy {
            TransferConflictPolicy::Rename => Ok(ResolvedTarget::Transfer {
                path: next_available_local_path(local_path, false)?,
                renamed: true,
            }),
            TransferConflictPolicy::Overwrite | TransferConflictPolicy::Skip => {
                reporter.record_skipped(remote_path, Some(remote_metadata.size), 1);
                Ok(ResolvedTarget::Skip)
            }
        },
        Some(metadata) if metadata.is_file() => {
            let local_metadata = Metadata::from(metadata);
            if !metadata_differs(&local_metadata, remote_metadata) {
                reporter.record_skipped(remote_path, Some(remote_metadata.size), 1);
                return Ok(ResolvedTarget::Skip);
            }

            match policy {
                TransferConflictPolicy::Overwrite => Ok(ResolvedTarget::Transfer {
                    path: local_path.to_path_buf(),
                    renamed: false,
                }),
                TransferConflictPolicy::Skip => {
                    reporter.record_skipped(remote_path, Some(remote_metadata.size), 1);
                    Ok(ResolvedTarget::Skip)
                }
                TransferConflictPolicy::Rename => Ok(ResolvedTarget::Transfer {
                    path: next_available_local_path(local_path, false)?,
                    renamed: true,
                }),
            }
        }
        _ => Ok(ResolvedTarget::Transfer {
            path: local_path.to_path_buf(),
            renamed: false,
        }),
    }
}

fn create_remote_dir(remote: &mut dyn RemoteFs, path: &Path) -> Result<(), String> {
    match remote.create_dir(path, UnixPex::from(0o755)) {
        Ok(()) => Ok(()),
        Err(RemoteError {
            kind: RemoteErrorType::DirectoryAlreadyExists,
            ..
        }) => Ok(()),
        Err(error) => Err(format!(
            "failed to create remote directory {}: {error}",
            path.display()
        )),
    }
}

fn metadata_differs(left: &Metadata, right: &Metadata) -> bool {
    left.modified != right.modified || left.size != right.size
}

fn remote_path_entry(remote: &mut dyn RemoteFs, path: &Path) -> Result<Option<RemoteFile>, String> {
    match remote.stat(path) {
        Ok(entry) => Ok(Some(entry)),
        Err(RemoteError {
            kind: RemoteErrorType::NoSuchFileOrDirectory,
            ..
        }) => Ok(None),
        Err(error) => Err(format!(
            "failed to inspect remote path {}: {error}",
            path.display()
        )),
    }
}

fn local_path_entry(path: &Path) -> Result<Option<fs::Metadata>, String> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "failed to inspect local path {}: {error}",
            path.display()
        )),
    }
}

fn next_available_remote_path(
    remote: &mut dyn RemoteFs,
    desired_path: &Path,
    is_directory: bool,
) -> Result<PathBuf, String> {
    for index in 1.. {
        let candidate = renamed_path_candidate(desired_path, is_directory, index);
        if remote_path_entry(remote, candidate.as_path())?.is_none() {
            return Ok(candidate);
        }
    }

    unreachable!()
}

fn next_available_local_path(desired_path: &Path, is_directory: bool) -> Result<PathBuf, String> {
    for index in 1.. {
        let candidate = renamed_path_candidate(desired_path, is_directory, index);
        if local_path_entry(candidate.as_path())?.is_none() {
            return Ok(candidate);
        }
    }

    unreachable!()
}

fn renamed_path_candidate(path: &Path, is_directory: bool, index: usize) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("item");

    let suffix = if index == 1 {
        "copy".to_string()
    } else {
        format!("copy-{index}")
    };

    let candidate_name = if is_directory {
        format!("{file_name}-{suffix}")
    } else {
        let stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or(file_name);
        match path.extension().and_then(|value| value.to_str()) {
            Some(extension) if !extension.is_empty() => {
                format!("{stem}-{suffix}.{extension}")
            }
            _ => format!("{stem}-{suffix}"),
        }
    };

    parent.join(candidate_name)
}

fn count_local_transfer_items(path: &Path) -> Result<usize, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("failed to stat local path {}: {error}", path.display()))?;

    if metadata.is_dir() {
        let mut count = 0usize;

        for entry in fs::read_dir(path).map_err(|error| {
            format!("failed to scan local directory {}: {error}", path.display())
        })? {
            let entry = entry.map_err(|error| {
                format!("failed to read local directory {}: {error}", path.display())
            })?;
            count += count_local_transfer_items(entry.path().as_path())?;
        }

        Ok(count.max(1))
    } else if metadata.is_file() {
        Ok(1)
    } else {
        Ok(0)
    }
}

fn count_remote_transfer_items(remote: &mut dyn RemoteFs, path: &Path) -> Result<usize, String> {
    let entry = remote
        .stat(path)
        .map_err(|error| format!("failed to stat remote path {}: {error}", path.display()))?;

    if entry.is_dir() {
        let entries = remote.list_dir(path).map_err(|error| {
            format!(
                "failed to scan remote directory {}: {error}",
                path.display()
            )
        })?;
        let mut count = 0usize;

        for entry in entries
            .into_iter()
            .filter(|entry| !is_self_reference(path, entry))
        {
            count += count_remote_transfer_items(remote, entry.path())?;
        }

        Ok(count.max(1))
    } else if entry.is_file() {
        Ok(1)
    } else {
        Ok(0)
    }
}

fn is_self_reference(parent: &Path, entry: &RemoteFile) -> bool {
    let last = entry.path().components().next_back();
    matches!(last, Some(Component::CurDir | Component::ParentDir)) || entry.path() == parent
}

#[cfg(test)]
mod tests {
    use std::fs::{self, File};
    use std::path::{Path, PathBuf};

    use tempfile::tempdir;

    use super::{count_local_transfer_items, renamed_path_candidate};

    #[test]
    fn renames_file_candidates_preserve_extension() {
        let candidate = renamed_path_candidate(Path::new("/tmp/release.tar.gz"), false, 2);
        assert_eq!(candidate, PathBuf::from("/tmp/release.tar-copy-2.gz"));
    }

    #[test]
    fn renames_directory_candidates_without_extension_rules() {
        let candidate = renamed_path_candidate(Path::new("/tmp/releases"), true, 1);
        assert_eq!(candidate, PathBuf::from("/tmp/releases-copy"));
    }

    #[test]
    fn counts_nested_local_transfer_items() {
        let dir = tempdir().expect("creates tempdir");
        let nested = dir.path().join("nested");
        fs::create_dir_all(nested.as_path()).expect("creates nested dir");
        File::create(dir.path().join("root.txt")).expect("creates root file");
        File::create(nested.join("child.txt")).expect("creates child file");

        let count = count_local_transfer_items(dir.path()).expect("counts files");
        assert_eq!(count, 2);
    }
}
