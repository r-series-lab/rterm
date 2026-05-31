use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use anyhow::Result as AnyResult;
use remotefs::RemoteFs;
use remotefs::fs::{Metadata as RemoteMetadata, UnixPex};
use thiserror::Error;

use crate::core::protocols::{FileTransferParams, remotefs_builder::RemoteFsBuilder};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt as _;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostEntry {
    pub path: PathBuf,
    pub metadata: HostMetadata,
}

impl HostEntry {
    pub fn name(&self) -> String {
        self.path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| self.path.display().to_string())
    }

    pub fn is_dir(&self) -> bool {
        self.metadata.is_dir
    }

    pub fn is_hidden(&self) -> bool {
        self.name().starts_with('.')
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct HostMetadata {
    pub is_dir: bool,
    pub is_symlink: bool,
    pub readonly: bool,
    pub size: u64,
    pub mode: Option<u32>,
    pub created: Option<SystemTime>,
    pub modified: Option<SystemTime>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FilePreviewData {
    pub path: PathBuf,
    pub size: u64,
    pub bytes: Vec<u8>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileDigestData {
    pub path: PathBuf,
    pub size: u64,
    pub md5: String,
}

#[derive(Debug, Error)]
pub enum HostError {
    #[error("path does not exist: {path}")]
    NotFound { path: String },
    #[error("path is not a directory: {path}")]
    NotDirectory { path: String },
    #[error("path is not a file: {path}")]
    NotFile { path: String },
    #[error("host io error at {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
}

pub type HostResult<T> = Result<T, HostError>;

pub trait HostBridge {
    fn connect(&mut self) -> HostResult<()>;
    fn disconnect(&mut self) -> HostResult<()>;
    fn is_connected(&mut self) -> bool;
    fn is_localhost(&self) -> bool;
    fn pwd(&mut self) -> HostResult<PathBuf>;
    fn exec_command(&mut self, command: &str) -> HostResult<String>;
    fn change_wrkdir(&mut self, new_dir: &Path) -> HostResult<PathBuf>;
    fn exists(&mut self, path: &Path) -> HostResult<bool>;
    fn stat(&mut self, path: &Path) -> HostResult<HostEntry>;
    fn list_dir(&mut self, path: &Path) -> HostResult<Vec<HostEntry>>;
    fn create_dir(&mut self, path: &Path) -> HostResult<PathBuf>;
    fn copy_path(&mut self, src: &Path, dest: &Path) -> HostResult<PathBuf>;
    fn move_path(&mut self, src: &Path, dest: &Path) -> HostResult<PathBuf>;
    fn delete_path(&mut self, path: &Path) -> HostResult<()>;
    fn set_permissions(&mut self, path: &Path, mode: u32) -> HostResult<PathBuf>;
    fn read_file_preview(&mut self, path: &Path, max_bytes: usize) -> HostResult<FilePreviewData>;
    fn write_file_text(&mut self, path: &Path, content: &str) -> HostResult<PathBuf>;
    fn compute_md5(&mut self, path: &Path) -> HostResult<FileDigestData>;
}

const PREVIEW_LIMIT_SENTINEL: &str = "rterm-preview-limit-reached";

#[derive(Debug, Default)]
struct PreviewCaptureState {
    bytes: Vec<u8>,
    truncated: bool,
}

struct PreviewCaptureWriter {
    state: Arc<Mutex<PreviewCaptureState>>,
    limit: usize,
}

impl Write for PreviewCaptureWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let mut state = self.state.lock().expect("preview capture state");
        let remaining = self.limit.saturating_sub(state.bytes.len());

        if remaining == 0 {
            state.truncated = true;
            return Err(std::io::Error::other(PREVIEW_LIMIT_SENTINEL));
        }

        let bytes_to_take = remaining.min(buf.len());
        state.bytes.extend_from_slice(&buf[..bytes_to_take]);

        if bytes_to_take < buf.len() {
            state.truncated = true;
            return Err(std::io::Error::other(PREVIEW_LIMIT_SENTINEL));
        }

        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn is_preview_limit_error(message: &str) -> bool {
    message.contains(PREVIEW_LIMIT_SENTINEL)
}

fn normalized_mode(mode: u32) -> u32 {
    mode & 0o7777
}

pub struct RemoteHost {
    remote: Box<dyn RemoteFs + Send>,
}

impl RemoteHost {
    pub fn from_params(params: &FileTransferParams) -> AnyResult<Self> {
        Ok(Self {
            remote: RemoteFsBuilder::build(params)?,
        })
    }

    pub fn remote_fs(&mut self) -> &mut dyn RemoteFs {
        &mut *self.remote
    }

    fn map_remote_entry(entry: &remotefs::File) -> HostEntry {
        let metadata = entry.metadata();
        HostEntry {
            path: entry.path().to_path_buf(),
            metadata: HostMetadata {
                is_dir: entry.is_dir(),
                is_symlink: metadata.symlink.is_some(),
                readonly: false,
                size: metadata.size,
                mode: metadata.mode.map(|value| normalized_mode(value.into())),
                created: metadata.created,
                modified: metadata.modified,
            },
        }
    }
}

impl HostBridge for RemoteHost {
    fn connect(&mut self) -> HostResult<()> {
        self.remote.connect().map_err(|source| HostError::Io {
            path: String::from("<remote>"),
            source: std::io::Error::other(source.to_string()),
        })?;
        Ok(())
    }

    fn disconnect(&mut self) -> HostResult<()> {
        self.remote.disconnect().map_err(|source| HostError::Io {
            path: String::from("<remote>"),
            source: std::io::Error::other(source.to_string()),
        })?;
        Ok(())
    }

    fn is_connected(&mut self) -> bool {
        self.remote.is_connected()
    }

    fn is_localhost(&self) -> bool {
        false
    }

    fn pwd(&mut self) -> HostResult<PathBuf> {
        self.remote.pwd().map_err(|source| HostError::Io {
            path: String::from("<remote>"),
            source: std::io::Error::other(source.to_string()),
        })
    }

    fn exec_command(&mut self, command: &str) -> HostResult<String> {
        self.remote
            .exec(command)
            .map(|(_, stdout)| stdout)
            .map_err(|source| HostError::Io {
                path: String::from("<remote>"),
                source: std::io::Error::other(source.to_string()),
            })
    }

    fn change_wrkdir(&mut self, new_dir: &Path) -> HostResult<PathBuf> {
        self.remote
            .change_dir(new_dir)
            .map_err(|source| HostError::Io {
                path: new_dir.display().to_string(),
                source: std::io::Error::other(source.to_string()),
            })
    }

    fn exists(&mut self, path: &Path) -> HostResult<bool> {
        self.remote.exists(path).map_err(|source| HostError::Io {
            path: path.display().to_string(),
            source: std::io::Error::other(source.to_string()),
        })
    }

    fn stat(&mut self, path: &Path) -> HostResult<HostEntry> {
        let entry = self.remote.stat(path).map_err(|source| HostError::Io {
            path: path.display().to_string(),
            source: std::io::Error::other(source.to_string()),
        })?;
        Ok(Self::map_remote_entry(&entry))
    }

    fn list_dir(&mut self, path: &Path) -> HostResult<Vec<HostEntry>> {
        let entries = self.remote.list_dir(path).map_err(|source| HostError::Io {
            path: path.display().to_string(),
            source: std::io::Error::other(source.to_string()),
        })?;
        Ok(entries.iter().map(Self::map_remote_entry).collect())
    }

    fn create_dir(&mut self, path: &Path) -> HostResult<PathBuf> {
        self.remote
            .create_dir(path, UnixPex::from(0o755))
            .map_err(|source| HostError::Io {
                path: path.display().to_string(),
                source: std::io::Error::other(source.to_string()),
            })?;
        Ok(path.to_path_buf())
    }

    fn copy_path(&mut self, src: &Path, dest: &Path) -> HostResult<PathBuf> {
        let entry = self.stat(src)?;

        if entry.metadata.is_dir {
            self.remote
                .create_dir(dest, UnixPex::from(0o755))
                .map_err(|source| HostError::Io {
                    path: dest.display().to_string(),
                    source: std::io::Error::other(source.to_string()),
                })?;

            let children = self.remote.list_dir(src).map_err(|source| HostError::Io {
                path: src.display().to_string(),
                source: std::io::Error::other(source.to_string()),
            })?;

            for child in children {
                let child_dest = dest.join(child.name());
                self.copy_path(child.path(), child_dest.as_path())?;
            }

            return Ok(dest.to_path_buf());
        }

        if let Err(source) = self.remote.copy(src, dest) {
            let mut reader = self.remote.open(src).map_err(|open_error| HostError::Io {
                path: src.display().to_string(),
                source: std::io::Error::other(open_error.to_string()),
            })?;
            let mut writer = self
                .remote
                .create(dest, &RemoteMetadata::default().size(entry.metadata.size))
                .map_err(|create_error| HostError::Io {
                    path: dest.display().to_string(),
                    source: std::io::Error::other(create_error.to_string()),
                })?;

            std::io::copy(&mut reader, &mut writer).map_err(|copy_error| HostError::Io {
                path: src.display().to_string(),
                source: copy_error,
            })?;

            self.remote
                .on_written(writer)
                .map_err(|finalize_error| HostError::Io {
                    path: dest.display().to_string(),
                    source: std::io::Error::other(finalize_error.to_string()),
                })?;
            self.remote
                .on_read(reader)
                .map_err(|finalize_error| HostError::Io {
                    path: src.display().to_string(),
                    source: std::io::Error::other(finalize_error.to_string()),
                })?;

            if !self.exists(dest)? {
                return Err(HostError::Io {
                    path: dest.display().to_string(),
                    source: std::io::Error::other(source.to_string()),
                });
            }
        }

        Ok(dest.to_path_buf())
    }

    fn move_path(&mut self, src: &Path, dest: &Path) -> HostResult<PathBuf> {
        match self.remote.mov(src, dest) {
            Ok(()) => Ok(dest.to_path_buf()),
            Err(source) => {
                self.copy_path(src, dest)?;
                self.delete_path(src)?;
                if self.exists(dest)? {
                    Ok(dest.to_path_buf())
                } else {
                    Err(HostError::Io {
                        path: src.display().to_string(),
                        source: std::io::Error::other(source.to_string()),
                    })
                }
            }
        }
    }

    fn delete_path(&mut self, path: &Path) -> HostResult<()> {
        let entry = self.stat(path)?;
        if entry.metadata.is_dir {
            self.remote
                .remove_dir_all(path)
                .map_err(|source| HostError::Io {
                    path: path.display().to_string(),
                    source: std::io::Error::other(source.to_string()),
                })?;
        } else {
            self.remote
                .remove_file(path)
                .map_err(|source| HostError::Io {
                    path: path.display().to_string(),
                    source: std::io::Error::other(source.to_string()),
                })?;
        }
        Ok(())
    }

    fn set_permissions(&mut self, path: &Path, mode: u32) -> HostResult<PathBuf> {
        let stat = self.remote.stat(path).map_err(|source| HostError::Io {
            path: path.display().to_string(),
            source: std::io::Error::other(source.to_string()),
        })?;
        let mut metadata = stat.metadata().clone();
        metadata.mode = Some(UnixPex::from(normalized_mode(mode)));

        self.remote
            .setstat(path, metadata)
            .map_err(|source| HostError::Io {
                path: path.display().to_string(),
                source: std::io::Error::other(source.to_string()),
            })?;
        Ok(path.to_path_buf())
    }

    fn read_file_preview(&mut self, path: &Path, max_bytes: usize) -> HostResult<FilePreviewData> {
        let entry = self.stat(path)?;
        if entry.metadata.is_dir {
            return Err(HostError::NotFile {
                path: entry.path.display().to_string(),
            });
        }

        let state = Arc::new(Mutex::new(PreviewCaptureState::default()));
        let writer = PreviewCaptureWriter {
            state: Arc::clone(&state),
            limit: max_bytes,
        };

        if let Err(source) = self.remote.open_file(path, Box::new(writer)) {
            let message = source.to_string();
            if !is_preview_limit_error(&message) {
                return Err(HostError::Io {
                    path: entry.path.display().to_string(),
                    source: std::io::Error::other(message),
                });
            }
        }

        let state = state.lock().expect("preview capture state");
        let size = entry.metadata.size;
        let path = entry.path;
        Ok(FilePreviewData {
            path,
            size,
            bytes: state.bytes.clone(),
            truncated: state.truncated,
        })
    }

    fn write_file_text(&mut self, path: &Path, content: &str) -> HostResult<PathBuf> {
        if self.exists(path)? {
            let entry = self.stat(path)?;
            if entry.metadata.is_dir {
                return Err(HostError::NotFile {
                    path: entry.path.display().to_string(),
                });
            }
        }

        let bytes = content.as_bytes().to_vec();
        self.remote
            .create_file(
                path,
                &RemoteMetadata::default().size(bytes.len() as u64),
                Box::new(Cursor::new(bytes)),
            )
            .map_err(|source| HostError::Io {
                path: path.display().to_string(),
                source: std::io::Error::other(source.to_string()),
            })?;
        Ok(path.to_path_buf())
    }

    fn compute_md5(&mut self, path: &Path) -> HostResult<FileDigestData> {
        let entry = self.stat(path)?;
        if entry.metadata.is_dir {
            return Err(HostError::NotFile {
                path: entry.path.display().to_string(),
            });
        }

        let mut reader = self.remote.open(path).map_err(|source| HostError::Io {
            path: entry.path.display().to_string(),
            source: std::io::Error::other(source.to_string()),
        })?;
        let mut context = md5::Context::new();
        let mut buffer = [0_u8; 64 * 1024];

        loop {
            let bytes_read = reader.read(&mut buffer).map_err(|source| HostError::Io {
                path: entry.path.display().to_string(),
                source,
            })?;
            if bytes_read == 0 {
                break;
            }
            context.consume(&buffer[..bytes_read]);
        }

        self.remote
            .on_read(reader)
            .map_err(|source| HostError::Io {
                path: entry.path.display().to_string(),
                source: std::io::Error::other(source.to_string()),
            })?;

        Ok(FileDigestData {
            path: entry.path,
            size: entry.metadata.size,
            md5: format!("{:x}", context.compute()),
        })
    }
}

#[derive(Debug, Clone)]
pub struct LocalHost {
    wrkdir: PathBuf,
    connected: bool,
}

impl LocalHost {
    pub fn new(wrkdir: PathBuf) -> HostResult<Self> {
        if !wrkdir.exists() {
            return Err(HostError::NotFound {
                path: wrkdir.display().to_string(),
            });
        }

        if !wrkdir.is_dir() {
            return Err(HostError::NotDirectory {
                path: wrkdir.display().to_string(),
            });
        }

        Ok(Self {
            wrkdir,
            connected: true,
        })
    }

    fn absolutize(&self, path: &Path) -> PathBuf {
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.wrkdir.join(path)
        }
    }

    fn build_entry(&self, path: PathBuf) -> HostResult<HostEntry> {
        let metadata = fs::symlink_metadata(&path).map_err(|source| HostError::Io {
            path: path.display().to_string(),
            source,
        })?;

        Ok(HostEntry {
            path,
            metadata: HostMetadata {
                is_dir: metadata.is_dir(),
                is_symlink: metadata.file_type().is_symlink(),
                readonly: metadata.permissions().readonly(),
                size: metadata.len(),
                mode: local_entry_mode(&metadata),
                created: metadata.created().ok(),
                modified: metadata.modified().ok(),
            },
        })
    }
}

#[cfg(unix)]
fn local_entry_mode(metadata: &fs::Metadata) -> Option<u32> {
    Some(normalized_mode(metadata.permissions().mode()))
}

#[cfg(not(unix))]
fn local_entry_mode(_metadata: &fs::Metadata) -> Option<u32> {
    None
}

impl HostBridge for LocalHost {
    fn connect(&mut self) -> HostResult<()> {
        self.connected = true;
        Ok(())
    }

    fn disconnect(&mut self) -> HostResult<()> {
        self.connected = false;
        Ok(())
    }

    fn is_connected(&mut self) -> bool {
        self.connected
    }

    fn is_localhost(&self) -> bool {
        true
    }

    fn pwd(&mut self) -> HostResult<PathBuf> {
        Ok(self.wrkdir.clone())
    }

    fn exec_command(&mut self, command: &str) -> HostResult<String> {
        let trimmed = command.trim();
        if trimmed.is_empty() {
            return Err(HostError::Io {
                path: self.wrkdir.display().to_string(),
                source: std::io::Error::other("empty command"),
            });
        }

        let args: Vec<&str> = trimmed.split_whitespace().collect();
        let executable = args.first().copied().ok_or_else(|| HostError::Io {
            path: self.wrkdir.display().to_string(),
            source: std::io::Error::other("empty command"),
        })?;
        let argv = &args[1..];

        Command::new(executable)
            .args(argv)
            .current_dir(&self.wrkdir)
            .output()
            .map(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .trim_end()
                    .to_string()
            })
            .map_err(|source| HostError::Io {
                path: self.wrkdir.display().to_string(),
                source,
            })
    }

    fn change_wrkdir(&mut self, new_dir: &Path) -> HostResult<PathBuf> {
        let next_dir = self.absolutize(new_dir);

        if !next_dir.exists() {
            return Err(HostError::NotFound {
                path: next_dir.display().to_string(),
            });
        }

        if !next_dir.is_dir() {
            return Err(HostError::NotDirectory {
                path: next_dir.display().to_string(),
            });
        }

        self.wrkdir = next_dir;
        Ok(self.wrkdir.clone())
    }

    fn exists(&mut self, path: &Path) -> HostResult<bool> {
        Ok(self.absolutize(path).exists())
    }

    fn stat(&mut self, path: &Path) -> HostResult<HostEntry> {
        self.build_entry(self.absolutize(path))
    }

    fn list_dir(&mut self, path: &Path) -> HostResult<Vec<HostEntry>> {
        let directory = self.absolutize(path);
        if !directory.exists() {
            return Err(HostError::NotFound {
                path: directory.display().to_string(),
            });
        }
        if !directory.is_dir() {
            return Err(HostError::NotDirectory {
                path: directory.display().to_string(),
            });
        }

        let mut entries = Vec::new();
        let read_dir = fs::read_dir(&directory).map_err(|source| HostError::Io {
            path: directory.display().to_string(),
            source,
        })?;

        for result in read_dir {
            let dir_entry = result.map_err(|source| HostError::Io {
                path: directory.display().to_string(),
                source,
            })?;
            entries.push(self.build_entry(dir_entry.path())?);
        }

        Ok(entries)
    }

    fn create_dir(&mut self, path: &Path) -> HostResult<PathBuf> {
        let directory = self.absolutize(path);
        fs::create_dir(&directory).map_err(|source| HostError::Io {
            path: directory.display().to_string(),
            source,
        })?;
        Ok(directory)
    }

    fn copy_path(&mut self, src: &Path, dest: &Path) -> HostResult<PathBuf> {
        let source_path = self.absolutize(src);
        let destination = self.absolutize(dest);
        let entry = self.build_entry(source_path.clone())?;

        if entry.metadata.is_dir {
            fs::create_dir(&destination).map_err(|source| HostError::Io {
                path: destination.display().to_string(),
                source,
            })?;

            for child in fs::read_dir(&source_path).map_err(|error| HostError::Io {
                path: source_path.display().to_string(),
                source: error,
            })? {
                let child = child.map_err(|error| HostError::Io {
                    path: source_path.display().to_string(),
                    source: error,
                })?;
                let child_name = child.file_name();
                let child_source = child.path();
                let child_dest = destination.join(child_name);
                self.copy_path(child_source.as_path(), child_dest.as_path())?;
            }

            return Ok(destination);
        }

        fs::copy(&source_path, &destination).map_err(|source_error| HostError::Io {
            path: source_path.display().to_string(),
            source: source_error,
        })?;
        Ok(destination)
    }

    fn move_path(&mut self, src: &Path, dest: &Path) -> HostResult<PathBuf> {
        let source = self.absolutize(src);
        let destination = self.absolutize(dest);
        match fs::rename(&source, &destination) {
            Ok(()) => Ok(destination),
            Err(source_error) => Err(HostError::Io {
                path: source.display().to_string(),
                source: source_error,
            }),
        }
    }

    fn delete_path(&mut self, path: &Path) -> HostResult<()> {
        let entry = self.build_entry(self.absolutize(path))?;
        if entry.metadata.is_dir {
            fs::remove_dir_all(&entry.path).map_err(|source| HostError::Io {
                path: entry.path.display().to_string(),
                source,
            })?;
        } else {
            fs::remove_file(&entry.path).map_err(|source| HostError::Io {
                path: entry.path.display().to_string(),
                source,
            })?;
        }
        Ok(())
    }

    fn set_permissions(&mut self, path: &Path, mode: u32) -> HostResult<PathBuf> {
        let target = self.absolutize(path);

        #[cfg(unix)]
        {
            let metadata = fs::metadata(&target).map_err(|source| HostError::Io {
                path: target.display().to_string(),
                source,
            })?;
            let mut permissions = metadata.permissions();
            permissions.set_mode(normalized_mode(mode));
            fs::set_permissions(&target, permissions).map_err(|source| HostError::Io {
                path: target.display().to_string(),
                source,
            })?;
            Ok(target)
        }

        #[cfg(not(unix))]
        {
            Err(HostError::Io {
                path: target.display().to_string(),
                source: std::io::Error::other("当前平台暂不支持本地修改权限"),
            })
        }
    }

    fn read_file_preview(&mut self, path: &Path, max_bytes: usize) -> HostResult<FilePreviewData> {
        let entry = self.build_entry(self.absolutize(path))?;
        if entry.metadata.is_dir {
            return Err(HostError::NotFile {
                path: entry.path.display().to_string(),
            });
        }

        let mut file = fs::File::open(&entry.path).map_err(|source| HostError::Io {
            path: entry.path.display().to_string(),
            source,
        })?;
        let mut bytes = Vec::new();
        let take_limit = (max_bytes as u64).saturating_add(1);
        Read::by_ref(&mut file)
            .take(take_limit)
            .read_to_end(&mut bytes)
            .map_err(|source| HostError::Io {
                path: entry.path.display().to_string(),
                source,
            })?;

        let truncated = bytes.len() > max_bytes;
        if truncated {
            bytes.truncate(max_bytes);
        }

        let size = entry.metadata.size;
        let path = entry.path;
        Ok(FilePreviewData {
            path,
            size,
            bytes,
            truncated,
        })
    }

    fn write_file_text(&mut self, path: &Path, content: &str) -> HostResult<PathBuf> {
        let file_path = self.absolutize(path);
        if file_path.is_dir() {
            return Err(HostError::NotFile {
                path: file_path.display().to_string(),
            });
        }

        let mut file = fs::File::create(&file_path).map_err(|source| HostError::Io {
            path: file_path.display().to_string(),
            source,
        })?;
        file.write_all(content.as_bytes())
            .map_err(|source| HostError::Io {
                path: file_path.display().to_string(),
                source,
            })?;
        Ok(file_path)
    }

    fn compute_md5(&mut self, path: &Path) -> HostResult<FileDigestData> {
        let entry = self.build_entry(self.absolutize(path))?;
        if entry.metadata.is_dir {
            return Err(HostError::NotFile {
                path: entry.path.display().to_string(),
            });
        }

        let mut file = fs::File::open(&entry.path).map_err(|source| HostError::Io {
            path: entry.path.display().to_string(),
            source,
        })?;
        let mut context = md5::Context::new();
        let mut buffer = [0_u8; 64 * 1024];

        loop {
            let bytes_read = file.read(&mut buffer).map_err(|source| HostError::Io {
                path: entry.path.display().to_string(),
                source,
            })?;
            if bytes_read == 0 {
                break;
            }
            context.consume(&buffer[..bytes_read]);
        }

        Ok(FileDigestData {
            path: entry.path,
            size: entry.metadata.size,
            md5: format!("{:x}", context.compute()),
        })
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn lists_directory_entries() {
        let temp_dir = tempdir().expect("tempdir");
        fs::create_dir(temp_dir.path().join("folder")).expect("folder");
        fs::write(temp_dir.path().join("notes.txt"), "hello").expect("file");

        let mut host = LocalHost::new(temp_dir.path().to_path_buf()).expect("host");
        let mut names: Vec<String> = host
            .list_dir(temp_dir.path())
            .expect("entries")
            .into_iter()
            .map(|entry| entry.name())
            .collect();
        names.sort();

        assert_eq!(names, vec!["folder".to_string(), "notes.txt".to_string()]);
    }

    #[test]
    fn changes_working_directory() {
        let temp_dir = tempdir().expect("tempdir");
        fs::create_dir(temp_dir.path().join("nested")).expect("dir");
        let mut host = LocalHost::new(temp_dir.path().to_path_buf()).expect("host");

        let next = host.change_wrkdir(Path::new("nested")).expect("change dir");
        assert_eq!(next, temp_dir.path().join("nested"));
        assert_eq!(host.pwd().expect("pwd"), temp_dir.path().join("nested"));
    }

    #[test]
    fn creates_moves_and_deletes_entries() {
        let temp_dir = tempdir().expect("tempdir");
        let mut host = LocalHost::new(temp_dir.path().to_path_buf()).expect("host");

        let created = host.create_dir(Path::new("drafts")).expect("create dir");
        assert!(created.exists());

        let source = temp_dir.path().join("notes.txt");
        fs::write(&source, "hello").expect("write file");

        let renamed = host
            .move_path(Path::new("notes.txt"), Path::new("renamed.txt"))
            .expect("rename file");
        assert_eq!(renamed, temp_dir.path().join("renamed.txt"));
        assert!(!source.exists());
        assert!(renamed.exists());

        host.delete_path(Path::new("drafts")).expect("delete dir");
        host.delete_path(Path::new("renamed.txt"))
            .expect("delete file");

        assert!(!temp_dir.path().join("drafts").exists());
        assert!(!renamed.exists());
    }

    #[test]
    fn reads_file_preview_and_truncates() {
        let temp_dir = tempdir().expect("tempdir");
        fs::write(temp_dir.path().join("notes.txt"), "hello world").expect("write file");

        let mut host = LocalHost::new(temp_dir.path().to_path_buf()).expect("host");
        let preview = host
            .read_file_preview(Path::new("notes.txt"), 5)
            .expect("preview");

        assert_eq!(preview.path, temp_dir.path().join("notes.txt"));
        assert_eq!(preview.size, 11);
        assert_eq!(preview.bytes, b"hello");
        assert!(preview.truncated);
    }

    #[test]
    fn writes_text_file_content() {
        let temp_dir = tempdir().expect("tempdir");
        let mut host = LocalHost::new(temp_dir.path().to_path_buf()).expect("host");

        let path = host
            .write_file_text(Path::new("notes.txt"), "hello from rterm")
            .expect("write text");

        assert_eq!(path, temp_dir.path().join("notes.txt"));
        assert_eq!(
            fs::read_to_string(temp_dir.path().join("notes.txt")).expect("read"),
            "hello from rterm"
        );
    }

    #[test]
    fn computes_local_file_md5() {
        let temp_dir = tempdir().expect("tempdir");
        fs::write(temp_dir.path().join("notes.txt"), "hello").expect("write file");
        let mut host = LocalHost::new(temp_dir.path().to_path_buf()).expect("host");

        let digest = host.compute_md5(Path::new("notes.txt")).expect("md5");

        assert_eq!(digest.path, temp_dir.path().join("notes.txt"));
        assert_eq!(digest.size, 5);
        assert_eq!(digest.md5, "5d41402abc4b2a76b9719d911017c592");
    }

    #[cfg(unix)]
    #[test]
    fn changes_local_permissions() {
        let temp_dir = tempdir().expect("tempdir");
        let file_path = temp_dir.path().join("notes.txt");
        fs::write(&file_path, "hello").expect("write file");
        let mut host = LocalHost::new(temp_dir.path().to_path_buf()).expect("host");

        let updated = host
            .set_permissions(Path::new("notes.txt"), 0o640)
            .expect("chmod file");

        assert_eq!(updated, file_path);
        let permissions = fs::metadata(&updated).expect("metadata").permissions();
        assert_eq!(permissions.mode() & 0o7777, 0o640);
    }

    #[test]
    fn copies_file_and_directory_entries() {
        let temp_dir = tempdir().expect("tempdir");
        fs::create_dir(temp_dir.path().join("assets")).expect("assets");
        fs::write(temp_dir.path().join("notes.txt"), "hello").expect("file");
        fs::write(temp_dir.path().join("assets/icon.txt"), "icon").expect("nested");

        let mut host = LocalHost::new(temp_dir.path().to_path_buf()).expect("host");
        let copied_file = host
            .copy_path(Path::new("notes.txt"), Path::new("notes-copy.txt"))
            .expect("copy file");
        let copied_dir = host
            .copy_path(Path::new("assets"), Path::new("assets-copy"))
            .expect("copy dir");

        assert_eq!(copied_file, temp_dir.path().join("notes-copy.txt"));
        assert_eq!(fs::read_to_string(copied_file).expect("read file"), "hello");
        assert_eq!(copied_dir, temp_dir.path().join("assets-copy"));
        assert_eq!(
            fs::read_to_string(temp_dir.path().join("assets-copy/icon.txt")).expect("read nested"),
            "icon"
        );
    }
}
