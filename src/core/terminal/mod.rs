use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

use crate::core::host::HostBridge;

const PWD_MARKER: &str = "__RTERM_PWD__";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCommandResult {
    pub command: String,
    pub current_directory: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

pub fn run_local_command(
    command: impl AsRef<str>,
    working_directory: Option<PathBuf>,
) -> Result<TerminalCommandResult, String> {
    let command = command.as_ref().trim();
    if command.is_empty() {
        return Err(String::from("命令不能为空"));
    }

    let working_directory = resolve_working_directory(working_directory)?;
    let output = build_shell_command(command, working_directory.as_path())
        .output()
        .map_err(|error| format!("无法启动终端命令: {error}"))?;
    let exit_code = output.status.code().unwrap_or(-1);
    let stderr = String::from_utf8_lossy(&output.stderr)
        .trim_end()
        .to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let (stdout, current_directory) =
        extract_working_directory(stdout, working_directory.as_path());

    Ok(TerminalCommandResult {
        command: command.to_string(),
        current_directory,
        stdout,
        stderr,
        exit_code,
    })
}

pub fn run_remote_command(
    host: &mut impl HostBridge,
    command: impl AsRef<str>,
    working_directory: Option<PathBuf>,
) -> Result<TerminalCommandResult, String> {
    let command = command.as_ref().trim();
    if command.is_empty() {
        return Err(String::from("命令不能为空"));
    }

    if let Some(directory) = working_directory.filter(|path| !path.as_os_str().is_empty()) {
        host.change_wrkdir(directory.as_path())
            .map_err(|error| error.to_string())?;
    }

    match parse_remote_terminal_command(command) {
        RemoteTerminalCommand::Cd(path) => {
            let next_directory = host
                .change_wrkdir(Path::new(path.as_str()))
                .map_err(|error| error.to_string())?;
            let rendered = next_directory.display().to_string();

            Ok(TerminalCommandResult {
                command: command.to_string(),
                current_directory: rendered.clone(),
                stdout: rendered,
                stderr: String::new(),
                exit_code: 0,
            })
        }
        RemoteTerminalCommand::Pwd => {
            let current_directory = host.pwd().map_err(|error| error.to_string())?;
            let rendered = current_directory.display().to_string();

            Ok(TerminalCommandResult {
                command: command.to_string(),
                current_directory: rendered.clone(),
                stdout: rendered,
                stderr: String::new(),
                exit_code: 0,
            })
        }
        RemoteTerminalCommand::Exit => {
            let current_directory = host.pwd().map_err(|error| error.to_string())?;
            Ok(TerminalCommandResult {
                command: command.to_string(),
                current_directory: current_directory.display().to_string(),
                stdout: String::new(),
                stderr: String::new(),
                exit_code: 0,
            })
        }
        RemoteTerminalCommand::Exec(executable) => {
            let stdout = host
                .exec_command(executable.as_str())
                .map_err(|error| error.to_string())?;
            let current_directory = host.pwd().map_err(|error| error.to_string())?;

            Ok(TerminalCommandResult {
                command: command.to_string(),
                current_directory: current_directory.display().to_string(),
                stdout,
                stderr: String::new(),
                exit_code: 0,
            })
        }
    }
}

enum RemoteTerminalCommand {
    Cd(String),
    Pwd,
    Exit,
    Exec(String),
}

fn parse_remote_terminal_command(command: &str) -> RemoteTerminalCommand {
    let mut parts = command.split_whitespace();

    match parts.next() {
        Some("cd") => match parts.next() {
            Some(path) => RemoteTerminalCommand::Cd(path.to_string()),
            None => RemoteTerminalCommand::Exec(command.to_string()),
        },
        Some("pwd") => RemoteTerminalCommand::Pwd,
        Some("exit" | "logout") => RemoteTerminalCommand::Exit,
        _ => RemoteTerminalCommand::Exec(command.to_string()),
    }
}

fn resolve_working_directory(working_directory: Option<PathBuf>) -> Result<PathBuf, String> {
    let candidate = working_directory
        .map(expand_home_path)
        .filter(|path| !path.as_os_str().is_empty())
        .or_else(|| std::env::current_dir().ok())
        .or_else(dirs::home_dir)
        .ok_or_else(|| String::from("无法确定终端工作目录"))?;

    if !candidate.exists() {
        return Err(format!("工作目录不存在: {}", candidate.display()));
    }

    if !candidate.is_dir() {
        return Err(format!("工作目录不是文件夹: {}", candidate.display()));
    }

    Ok(candidate)
}

fn expand_home_path(path: PathBuf) -> PathBuf {
    let Some(raw) = path.to_str() else {
        return path;
    };

    if raw == "~" {
        return dirs::home_dir().unwrap_or(path);
    }

    if let Some(rest) = raw.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }

    path
}

fn extract_working_directory(stdout: String, fallback: &Path) -> (String, String) {
    let normalized = stdout.replace("\r\n", "\n");

    if let Some(index) = normalized.rfind(PWD_MARKER) {
        let content = normalized[..index].trim_end_matches('\n').to_string();
        let marker_payload = &normalized[index + PWD_MARKER.len()..];
        let directory = marker_payload
            .lines()
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| fallback.display().to_string());

        return (content, directory);
    }

    (
        normalized.trim_end_matches('\n').to_string(),
        fallback.display().to_string(),
    )
}

#[cfg(target_family = "unix")]
fn build_shell_command(command: &str, working_directory: &Path) -> Command {
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| String::from("/bin/zsh"));
    let script = format!(
        "{command}\n__rterm_exit=$?\nprintf '\\n{PWD_MARKER}%s\\n' \"$PWD\"\nexit $__rterm_exit"
    );
    let mut process = Command::new(shell);
    process
        .arg("-lc")
        .arg(script)
        .current_dir(working_directory)
        .env("TERM", "dumb");
    process
}

#[cfg(target_family = "windows")]
fn build_shell_command(command: &str, working_directory: &Path) -> Command {
    let script = format!(
        "& {{\n{command}\n$rtermExit = $LASTEXITCODE\nif ($null -eq $rtermExit) {{ if ($?) {{ $rtermExit = 0 }} else {{ $rtermExit = 1 }} }}\nWrite-Output \"`n{PWD_MARKER}$((Get-Location).Path)\"\nexit $rtermExit\n}}"
    );
    let mut process = Command::new("powershell.exe");
    process
        .arg("-NoLogo")
        .arg("-NoProfile")
        .arg("-Command")
        .arg(script)
        .current_dir(working_directory);
    process
}

#[cfg(test)]
mod tests {
    use super::extract_working_directory;

    #[test]
    fn extracts_marker_and_cleans_stdout() {
        let fallback = std::path::Path::new("/tmp");
        let stdout = String::from("hello\n__RTERM_PWD__/home/demo/work\n");
        let (cleaned, directory) = extract_working_directory(stdout, fallback);

        assert_eq!(cleaned, "hello");
        assert_eq!(directory, "/home/demo/work");
    }

    #[test]
    fn falls_back_when_marker_is_missing() {
        let fallback = std::path::Path::new("/tmp");
        let stdout = String::from("plain output\n");
        let (cleaned, directory) = extract_working_directory(stdout, fallback);

        assert_eq!(cleaned, "plain output");
        assert_eq!(directory, "/tmp");
    }
}
