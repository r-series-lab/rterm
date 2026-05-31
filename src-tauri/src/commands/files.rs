use std::path::{Path, PathBuf};

use rterm::core::host::{HostBridge, LocalHost, RemoteHost};
use serde::Serialize;
use tauri::State;

use super::remote_pool::RemoteSessionRegistry;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMutationResult {
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDigestResult {
    pub path: String,
    pub size: u64,
    pub md5: String,
}

fn validate_entry_name(name: &str) -> Result<&str, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(String::from("名称不能为空"));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(String::from("名称不能为 . 或 .."));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(String::from("名称不能包含路径分隔符"));
    }
    Ok(trimmed)
}

fn child_path(directory: &Path, name: &str) -> PathBuf {
    directory.join(name)
}

fn renamed_path(path: &Path, name: &str) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("无法重命名根路径 {}", path.display()))?;
    Ok(parent.join(name))
}

fn validate_destination_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(String::from("目标路径不能为空"));
    }
    Ok(PathBuf::from(trimmed))
}

fn validate_permission_mode(mode: &str) -> Result<u32, String> {
    let trimmed = mode.trim();
    if trimmed.is_empty() {
        return Err(String::from("权限不能为空"));
    }

    let normalized = trimmed
        .strip_prefix("0o")
        .or_else(|| trimmed.strip_prefix("0O"))
        .unwrap_or(trimmed);

    if normalized.len() < 3 || normalized.len() > 4 {
        return Err(String::from(
            "权限格式应为 3 到 4 位八进制，例如 755 或 0644",
        ));
    }

    if !normalized.chars().all(|value| ('0'..='7').contains(&value)) {
        return Err(String::from("权限只能包含 0-7，例如 755"));
    }

    let value = u32::from_str_radix(normalized, 8)
        .map_err(|_| String::from("无法解析权限，请使用八进制格式，例如 755"))?;
    if value > 0o7777 {
        return Err(String::from(
            "权限值超出支持范围，请使用不超过 7777 的八进制值",
        ));
    }

    Ok(value)
}

fn with_remote_host<T>(
    registry: &RemoteSessionRegistry,
    remote: &str,
    run: impl FnOnce(&mut RemoteHost) -> Result<T, String>,
) -> Result<T, String> {
    registry.with_remote_host(remote, |host, _| run(host))
}

async fn run_remote_operation<T, F>(
    registry: State<'_, RemoteSessionRegistry>,
    remote: String,
    run: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(RemoteSessionRegistry, String) -> Result<T, String> + Send + 'static,
{
    let registry = registry.inner().clone();
    tauri::async_runtime::spawn_blocking(move || run(registry, remote))
        .await
        .map_err(|error| format!("failed to join remote file task: {error}"))?
}

#[tauri::command]
pub fn create_local_directory(
    directory: String,
    name: String,
) -> Result<FileMutationResult, String> {
    let validated_name = validate_entry_name(&name)?;
    let base_dir = PathBuf::from(&directory);
    let mut host = LocalHost::new(base_dir.clone()).map_err(|error| error.to_string())?;
    let path = host
        .create_dir(child_path(base_dir.as_path(), validated_name).as_path())
        .map_err(|error| error.to_string())?;
    Ok(FileMutationResult {
        path: path.display().to_string(),
    })
}

#[tauri::command]
pub async fn create_remote_directory(
    registry: State<'_, RemoteSessionRegistry>,
    remote: String,
    directory: String,
    name: String,
) -> Result<FileMutationResult, String> {
    let validated_name = validate_entry_name(&name)?.to_string();
    run_remote_operation(registry, remote, move |registry, remote| {
        with_remote_host(&registry, &remote, |host| {
            let path = host
                .create_dir(child_path(Path::new(&directory), &validated_name).as_path())
                .map_err(|error| error.to_string())?;
            Ok(FileMutationResult {
                path: path.display().to_string(),
            })
        })
    })
    .await
}

#[tauri::command]
pub fn rename_local_entry(path: String, name: String) -> Result<FileMutationResult, String> {
    let validated_name = validate_entry_name(&name)?;
    let current_path = PathBuf::from(&path);
    let current_directory = current_path
        .parent()
        .ok_or_else(|| format!("无法读取父目录 {}", current_path.display()))?
        .to_path_buf();
    let destination = renamed_path(current_path.as_path(), validated_name)?;
    let mut host = LocalHost::new(current_directory).map_err(|error| error.to_string())?;
    let path = host
        .move_path(current_path.as_path(), destination.as_path())
        .map_err(|error| error.to_string())?;
    Ok(FileMutationResult {
        path: path.display().to_string(),
    })
}

#[tauri::command]
pub async fn rename_remote_entry(
    registry: State<'_, RemoteSessionRegistry>,
    remote: String,
    path: String,
    name: String,
) -> Result<FileMutationResult, String> {
    let validated_name = validate_entry_name(&name)?.to_string();
    run_remote_operation(registry, remote, move |registry, remote| {
        with_remote_host(&registry, &remote, |host| {
            let current_path = PathBuf::from(&path);
            let destination = renamed_path(current_path.as_path(), &validated_name)?;
            let path = host
                .move_path(current_path.as_path(), destination.as_path())
                .map_err(|error| error.to_string())?;
            Ok(FileMutationResult {
                path: path.display().to_string(),
            })
        })
    })
    .await
}

#[tauri::command]
pub fn copy_local_entry(path: String, destination: String) -> Result<FileMutationResult, String> {
    let current_path = PathBuf::from(&path);
    let current_directory = current_path
        .parent()
        .ok_or_else(|| format!("无法读取父目录 {}", current_path.display()))?
        .to_path_buf();
    let destination = validate_destination_path(&destination)?;
    let mut host = LocalHost::new(current_directory).map_err(|error| error.to_string())?;
    let path = host
        .copy_path(current_path.as_path(), destination.as_path())
        .map_err(|error| error.to_string())?;
    Ok(FileMutationResult {
        path: path.display().to_string(),
    })
}

#[tauri::command]
pub async fn copy_remote_entry(
    registry: State<'_, RemoteSessionRegistry>,
    remote: String,
    path: String,
    destination: String,
) -> Result<FileMutationResult, String> {
    let destination = validate_destination_path(&destination)?;
    run_remote_operation(registry, remote, move |registry, remote| {
        with_remote_host(&registry, &remote, |host| {
            let current_path = PathBuf::from(&path);
            let path = host
                .copy_path(current_path.as_path(), destination.as_path())
                .map_err(|error| error.to_string())?;
            Ok(FileMutationResult {
                path: path.display().to_string(),
            })
        })
    })
    .await
}

#[tauri::command]
pub fn move_local_entry(path: String, destination: String) -> Result<FileMutationResult, String> {
    let current_path = PathBuf::from(&path);
    let current_directory = current_path
        .parent()
        .ok_or_else(|| format!("无法读取父目录 {}", current_path.display()))?
        .to_path_buf();
    let destination = validate_destination_path(&destination)?;
    let mut host = LocalHost::new(current_directory).map_err(|error| error.to_string())?;
    let path = host
        .move_path(current_path.as_path(), destination.as_path())
        .map_err(|error| error.to_string())?;
    Ok(FileMutationResult {
        path: path.display().to_string(),
    })
}

#[tauri::command]
pub async fn move_remote_entry(
    registry: State<'_, RemoteSessionRegistry>,
    remote: String,
    path: String,
    destination: String,
) -> Result<FileMutationResult, String> {
    let destination = validate_destination_path(&destination)?;
    run_remote_operation(registry, remote, move |registry, remote| {
        with_remote_host(&registry, &remote, |host| {
            let current_path = PathBuf::from(&path);
            let path = host
                .move_path(current_path.as_path(), destination.as_path())
                .map_err(|error| error.to_string())?;
            Ok(FileMutationResult {
                path: path.display().to_string(),
            })
        })
    })
    .await
}

#[tauri::command]
pub fn delete_local_entry(path: String) -> Result<FileMutationResult, String> {
    let current_path = PathBuf::from(&path);
    let current_directory = current_path
        .parent()
        .ok_or_else(|| format!("无法读取父目录 {}", current_path.display()))?
        .to_path_buf();
    let mut host = LocalHost::new(current_directory).map_err(|error| error.to_string())?;
    host.delete_path(current_path.as_path())
        .map_err(|error| error.to_string())?;
    Ok(FileMutationResult { path })
}

#[tauri::command]
pub async fn delete_remote_entry(
    registry: State<'_, RemoteSessionRegistry>,
    remote: String,
    path: String,
) -> Result<FileMutationResult, String> {
    run_remote_operation(registry, remote, move |registry, remote| {
        with_remote_host(&registry, &remote, |host| {
            host.delete_path(Path::new(&path))
                .map_err(|error| error.to_string())?;
            Ok(FileMutationResult { path })
        })
    })
    .await
}

#[tauri::command]
pub fn chmod_local_entry(path: String, mode: String) -> Result<FileMutationResult, String> {
    let current_path = PathBuf::from(&path);
    let current_directory = current_path
        .parent()
        .ok_or_else(|| format!("无法读取父目录 {}", current_path.display()))?
        .to_path_buf();
    let parsed_mode = validate_permission_mode(&mode)?;
    let mut host = LocalHost::new(current_directory).map_err(|error| error.to_string())?;
    let path = host
        .set_permissions(current_path.as_path(), parsed_mode)
        .map_err(|error| error.to_string())?;
    Ok(FileMutationResult {
        path: path.display().to_string(),
    })
}

#[tauri::command]
pub async fn chmod_remote_entry(
    registry: State<'_, RemoteSessionRegistry>,
    remote: String,
    path: String,
    mode: String,
) -> Result<FileMutationResult, String> {
    let parsed_mode = validate_permission_mode(&mode)?;
    run_remote_operation(registry, remote, move |registry, remote| {
        with_remote_host(&registry, &remote, |host| {
            let path = host
                .set_permissions(Path::new(&path), parsed_mode)
                .map_err(|error| error.to_string())?;
            Ok(FileMutationResult {
                path: path.display().to_string(),
            })
        })
    })
    .await
}

#[tauri::command]
pub async fn md5_local_file(path: String) -> Result<FileDigestResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let current_path = PathBuf::from(&path);
        let current_directory = current_path
            .parent()
            .ok_or_else(|| format!("无法读取父目录 {}", current_path.display()))?
            .to_path_buf();
        let mut host = LocalHost::new(current_directory).map_err(|error| error.to_string())?;
        let digest = host
            .compute_md5(current_path.as_path())
            .map_err(|error| error.to_string())?;
        Ok(FileDigestResult {
            path: digest.path.display().to_string(),
            size: digest.size,
            md5: digest.md5,
        })
    })
    .await
    .map_err(|error| format!("failed to join local md5 task: {error}"))?
}

#[tauri::command]
pub async fn md5_remote_file(
    registry: State<'_, RemoteSessionRegistry>,
    remote: String,
    path: String,
) -> Result<FileDigestResult, String> {
    run_remote_operation(registry, remote, move |registry, remote| {
        with_remote_host(&registry, &remote, |host| {
            let digest = host
                .compute_md5(Path::new(&path))
                .map_err(|error| error.to_string())?;
            Ok(FileDigestResult {
                path: digest.path.display().to_string(),
                size: digest.size,
                md5: digest.md5,
            })
        })
    })
    .await
}

#[tauri::command]
pub fn save_local_text_file(path: String, content: String) -> Result<FileMutationResult, String> {
    let file_path = PathBuf::from(&path);
    let base_dir = file_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("/"));
    let mut host = LocalHost::new(base_dir).map_err(|error| error.to_string())?;
    let path = host
        .write_file_text(file_path.as_path(), &content)
        .map_err(|error| error.to_string())?;
    Ok(FileMutationResult {
        path: path.display().to_string(),
    })
}

#[tauri::command]
pub async fn save_remote_text_file(
    registry: State<'_, RemoteSessionRegistry>,
    remote: String,
    path: String,
    content: String,
) -> Result<FileMutationResult, String> {
    run_remote_operation(registry, remote, move |registry, remote| {
        with_remote_host(&registry, &remote, |host| {
            let path = host
                .write_file_text(Path::new(&path), &content)
                .map_err(|error| error.to_string())?;
            Ok(FileMutationResult {
                path: path.display().to_string(),
            })
        })
    })
    .await
}
