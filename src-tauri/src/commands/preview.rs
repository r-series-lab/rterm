use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use std::path::{Path, PathBuf};

use rterm::core::host::{FilePreviewData, HostBridge, LocalHost, RemoteHost};
use serde::Serialize;
use tauri::State;

use super::remote_pool::RemoteSessionRegistry;

const MAX_TEXT_PREVIEW_BYTES: usize = 128 * 1024;
const MAX_EMBEDDED_PREVIEW_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FilePreviewKind {
    Text,
    Image,
    Pdf,
    Binary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePreviewResult {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub kind: FilePreviewKind,
    pub content: Option<String>,
    pub data_url: Option<String>,
    pub mime_type: Option<String>,
    pub truncated: bool,
    pub is_binary: bool,
}

fn embedded_preview_info(path: &Path) -> Option<(FilePreviewKind, &'static str)> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());

    match extension.as_deref() {
        Some("png") => Some((FilePreviewKind::Image, "image/png")),
        Some("jpg") | Some("jpeg") => Some((FilePreviewKind::Image, "image/jpeg")),
        Some("gif") => Some((FilePreviewKind::Image, "image/gif")),
        Some("webp") => Some((FilePreviewKind::Image, "image/webp")),
        Some("bmp") => Some((FilePreviewKind::Image, "image/bmp")),
        Some("svg") => Some((FilePreviewKind::Image, "image/svg+xml")),
        Some("pdf") => Some((FilePreviewKind::Pdf, "application/pdf")),
        _ => None,
    }
}

fn preview_limit_for_path(path: &Path) -> usize {
    if embedded_preview_info(path).is_some() {
        MAX_EMBEDDED_PREVIEW_BYTES
    } else {
        MAX_TEXT_PREVIEW_BYTES
    }
}

fn to_preview_result(preview: FilePreviewData) -> FilePreviewResult {
    let FilePreviewData {
        path,
        size,
        bytes,
        truncated,
    } = preview;

    if let Some((kind, mime_type)) = embedded_preview_info(path.as_path()) {
        let data_url = if truncated {
            None
        } else {
            Some(format!(
                "data:{mime_type};base64,{}",
                BASE64_STANDARD.encode(&bytes)
            ))
        };

        return FilePreviewResult {
            name: path
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| path.display().to_string()),
            path: path.display().to_string(),
            size,
            kind,
            content: None,
            data_url,
            mime_type: Some(mime_type.to_string()),
            truncated,
            is_binary: true,
        };
    }

    let is_binary = looks_like_binary(&bytes) || std::str::from_utf8(&bytes).is_err();
    let content = if is_binary {
        None
    } else {
        Some(String::from_utf8_lossy(&bytes).to_string())
    };

    FilePreviewResult {
        name: path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| path.display().to_string()),
        path: path.display().to_string(),
        size,
        kind: if is_binary {
            FilePreviewKind::Binary
        } else {
            FilePreviewKind::Text
        },
        content,
        data_url: None,
        mime_type: if is_binary {
            None
        } else {
            Some(String::from("text/plain"))
        },
        truncated,
        is_binary,
    }
}

fn looks_like_binary(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return false;
    }

    if bytes.contains(&0) {
        return true;
    }

    let control_bytes = bytes
        .iter()
        .filter(|byte| matches!(**byte, 0x01..=0x08 | 0x0B | 0x0C | 0x0E..=0x1F))
        .count();

    control_bytes.saturating_mul(8) > bytes.len()
}

fn with_remote_host<T>(
    registry: &RemoteSessionRegistry,
    remote: &str,
    run: impl FnOnce(&mut RemoteHost) -> Result<T, String>,
) -> Result<T, String> {
    registry.with_remote_host(remote, |host, _| run(host))
}

#[tauri::command]
pub fn preview_local_file(path: String) -> Result<FilePreviewResult, String> {
    let file_path = PathBuf::from(&path);
    let base_dir = file_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("/"));
    let mut host = LocalHost::new(base_dir).map_err(|error| error.to_string())?;
    let preview = host
        .read_file_preview(
            file_path.as_path(),
            preview_limit_for_path(file_path.as_path()),
        )
        .map_err(|error| error.to_string())?;

    Ok(to_preview_result(preview))
}

#[tauri::command]
pub async fn preview_remote_file(
    registry: State<'_, RemoteSessionRegistry>,
    remote: String,
    path: String,
) -> Result<FilePreviewResult, String> {
    let registry = registry.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        with_remote_host(&registry, &remote, |host| {
            let preview = host
                .read_file_preview(Path::new(&path), preview_limit_for_path(Path::new(&path)))
                .map_err(|error| error.to_string())?;
            Ok(to_preview_result(preview))
        })
    })
    .await
    .map_err(|error| format!("failed to join preview_remote_file task: {error}"))?
}
