use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use rterm::core::connections;
use rterm::core::protocols::{
    FileTransferParams, FileTransferProtocol, GenericProtocolParams, ProtocolParams,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::commands::remote_pool::RemoteSessionRegistry;

type SharedWriter = Arc<Mutex<Box<dyn Write + Send>>>;

struct PtyTerminalSession {
    _master: Box<dyn MasterPty + Send>,
    writer: SharedWriter,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Clone, Default)]
pub struct TerminalRegistry {
    sessions: Arc<Mutex<HashMap<String, PtyTerminalSession>>>,
}

impl TerminalRegistry {
    fn insert(&self, session_id: String, session: PtyTerminalSession) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| String::from("终端会话状态不可用"))?;
        sessions.insert(session_id, session);
        Ok(())
    }

    fn remove(&self, session_id: &str) -> Option<PtyTerminalSession> {
        self.sessions
            .lock()
            .ok()
            .and_then(|mut sessions| sessions.remove(session_id))
    }

    fn write(&self, session_id: &str, input: &str) -> Result<(), String> {
        let writer = {
            let sessions = self
                .sessions
                .lock()
                .map_err(|_| String::from("终端会话状态不可用"))?;
            sessions
                .get(session_id)
                .map(|session| session.writer.clone())
                .ok_or_else(|| String::from("终端会话不存在或已关闭"))?
        };

        write_shared_writer(&writer, input)
    }

    fn resize(&self, session_id: &str, size: PtySize) -> Result<(), String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| String::from("终端会话状态不可用"))?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| String::from("终端会话不存在或已关闭"))?;

        session
            ._master
            .resize(size)
            .map_err(|error| format!("调整终端尺寸失败: {error}"))
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalSessionScope {
    Local,
    Remote,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionInfo {
    session_id: String,
    pid: Option<u32>,
    current_directory: String,
    scope: TerminalSessionScope,
    label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputEvent {
    session_id: String,
    chunk: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExitEvent {
    session_id: String,
    exit_code: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalDebugEvent {
    session_id: String,
    stage: String,
    message: String,
}

struct TerminalLaunchPlan {
    command: CommandBuilder,
    current_directory: String,
    label: Option<String>,
    startup_password: Option<String>,
    suppress_startup_password_prompt: bool,
}

#[tauri::command]
pub async fn run_local_terminal_command(
    command: String,
    working_directory: Option<String>,
) -> Result<rterm::core::terminal::TerminalCommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let working_directory = working_directory
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);

        rterm::core::terminal::run_local_command(command, working_directory)
    })
    .await
    .map_err(|error| format!("终端任务执行失败: {error}"))?
}

#[tauri::command]
pub async fn run_remote_terminal_command(
    remote_registry: State<'_, RemoteSessionRegistry>,
    remote: String,
    command: String,
    working_directory: Option<String>,
) -> Result<rterm::core::terminal::TerminalCommandResult, String> {
    let registry = remote_registry.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let working_directory = working_directory
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);

        registry.with_remote_host(remote.as_str(), |host, _params| {
            rterm::core::terminal::run_remote_command(host, command.as_str(), working_directory)
        })
    })
    .await
    .map_err(|error| format!("远端终端任务执行失败: {error}"))?
}

#[tauri::command]
pub fn start_local_terminal_session(
    app: AppHandle,
    registry: State<'_, TerminalRegistry>,
    working_directory: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
) -> Result<TerminalSessionInfo, String> {
    let working_directory = resolve_terminal_working_directory(working_directory)?;
    let mut command = CommandBuilder::new(default_shell());
    command.cwd(working_directory.as_os_str());
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");

    spawn_terminal_session(
        app,
        registry,
        TerminalSessionScope::Local,
        TerminalLaunchPlan {
            command,
            current_directory: working_directory.display().to_string(),
            label: Some(String::from("本地 Shell")),
            startup_password: None,
            suppress_startup_password_prompt: false,
        },
        rows,
        cols,
    )
}

#[tauri::command]
pub fn start_remote_terminal_session(
    app: AppHandle,
    registry: State<'_, TerminalRegistry>,
    remote: String,
    working_directory: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
) -> Result<TerminalSessionInfo, String> {
    let params = connections::parse_remote_spec(&remote)?;
    let launch_plan = build_remote_terminal_plan(&params, working_directory)?;

    spawn_terminal_session(
        app,
        registry,
        TerminalSessionScope::Remote,
        launch_plan,
        rows,
        cols,
    )
}

#[tauri::command]
pub fn write_terminal_input(
    app: AppHandle,
    registry: State<'_, TerminalRegistry>,
    session_id: String,
    input: String,
) -> Result<(), String> {
    eprintln!(
        "[terminal-debug][{}][backend.write.request] {} bytes",
        session_id,
        input.len()
    );
    emit_terminal_debug(
        &app,
        session_id.as_str(),
        "backend.write.request",
        format!("收到前端输入，{} bytes", input.len()),
    );
    let result = registry.write(session_id.as_str(), input.as_str());
    match &result {
        Ok(()) => {
            eprintln!(
                "[terminal-debug][{}][backend.write.success] {} bytes",
                session_id,
                input.len()
            );
            emit_terminal_debug(
                &app,
                session_id.as_str(),
                "backend.write.success",
                format!("已写入 PTY，{} bytes", input.len()),
            );
        }
        Err(error) => {
            eprintln!(
                "[terminal-debug][{}][backend.write.error] {}",
                session_id, error
            );
            emit_terminal_debug(
                &app,
                session_id.as_str(),
                "backend.write.error",
                error.clone(),
            );
        }
    }
    result
}

#[tauri::command]
pub fn resize_terminal_session(
    registry: State<'_, TerminalRegistry>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    registry.resize(
        session_id.as_str(),
        PtySize {
            rows: rows.max(8),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        },
    )
}

#[tauri::command]
pub fn close_terminal_session(
    app: AppHandle,
    registry: State<'_, TerminalRegistry>,
    session_id: String,
) -> Result<(), String> {
    if let Some(mut session) = registry.remove(session_id.as_str()) {
        let _ = session.child.kill();
        let _ = app.emit(
            "terminal-exit",
            TerminalExitEvent {
                session_id,
                exit_code: None,
            },
        );
    }

    Ok(())
}

fn spawn_terminal_session(
    app: AppHandle,
    registry: State<'_, TerminalRegistry>,
    scope: TerminalSessionScope,
    launch_plan: TerminalLaunchPlan,
    rows: Option<u16>,
    cols: Option<u16>,
) -> Result<TerminalSessionInfo, String> {
    let TerminalLaunchPlan {
        command,
        current_directory,
        label,
        startup_password,
        suppress_startup_password_prompt,
    } = launch_plan;
    let size = PtySize {
        rows: rows.unwrap_or(24).max(8),
        cols: cols.unwrap_or(100).max(20),
        pixel_width: 0,
        pixel_height: 0,
    };
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(size)
        .map_err(|error| format!("无法创建 PTY: {error}"))?;
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("无法启动终端会话: {error}"))?;
    let pid = child.process_id();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("无法读取终端输出: {error}"))?;
    let writer = Arc::new(Mutex::new(
        pair.master
            .take_writer()
            .map_err(|error| format!("无法写入终端输入: {error}"))?,
    ));
    let session_id = create_terminal_session_id();

    registry.insert(
        session_id.clone(),
        PtyTerminalSession {
            _master: pair.master,
            writer: writer.clone(),
            child,
        },
    )?;

    let cleanup_registry = registry.inner().clone();
    let output_app = app.clone();
    let output_session_id = session_id.clone();
    let output_writer = writer.clone();
    emit_terminal_debug(
        &app,
        session_id.as_str(),
        "backend.spawn",
        format!("PTY 已启动，scope={scope:?}, pid={pid:?}"),
    );
    eprintln!(
        "[terminal-debug][{}][backend.spawn] scope={:?} pid={:?}",
        session_id, scope, pid
    );
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        let mut pending_startup_password = startup_password;
        let mut hide_startup_password_prompt = suppress_startup_password_prompt;
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let chunk = String::from_utf8_lossy(&buffer[..size]).to_string();
                    let chunk_lowercase = chunk.to_ascii_lowercase();
                    if let Some(password) = pending_startup_password.as_deref()
                        && chunk_lowercase.contains("password:")
                    {
                        let _ =
                            write_shared_writer(&output_writer, format!("{password}\r").as_str());
                        eprintln!(
                            "[terminal-debug][{}][backend.auto-password] replied once to password prompt",
                            output_session_id
                        );
                        emit_terminal_debug(
                            &output_app,
                            output_session_id.as_str(),
                            "backend.auto-password",
                            "检测到 password 提示，已自动回填一次保存的密码",
                        );
                        pending_startup_password = None;
                    }

                    let visible_chunk =
                        if hide_startup_password_prompt && chunk_lowercase.contains("password:") {
                            strip_startup_password_prompt(chunk.as_str())
                        } else {
                            chunk
                        };

                    if hide_startup_password_prompt
                        && !visible_chunk.trim().is_empty()
                        && !visible_chunk.to_ascii_lowercase().contains("password:")
                    {
                        hide_startup_password_prompt = false;
                    }

                    if visible_chunk.is_empty() {
                        continue;
                    }
                    let _ = output_app.emit(
                        "terminal-output",
                        TerminalOutputEvent {
                            session_id: output_session_id.clone(),
                            chunk: visible_chunk,
                        },
                    );
                }
                Err(error) => {
                    eprintln!(
                        "[terminal-debug][{}][backend.read.error] {}",
                        output_session_id, error
                    );
                    emit_terminal_debug(
                        &output_app,
                        output_session_id.as_str(),
                        "backend.read.error",
                        format!("读取终端输出失败: {error}"),
                    );
                    let _ = output_app.emit(
                        "terminal-output",
                        TerminalOutputEvent {
                            session_id: output_session_id.clone(),
                            chunk: format!("\r\n[读取终端输出失败: {error}]\r\n"),
                        },
                    );
                    break;
                }
            }
        }

        let exit_code = cleanup_registry
            .remove(output_session_id.as_str())
            .and_then(|mut session| session.child.wait().ok())
            .map(|status| status.exit_code());
        emit_terminal_debug(
            &output_app,
            output_session_id.as_str(),
            "backend.exit",
            format!("终端会话结束，exit_code={exit_code:?}"),
        );
        eprintln!(
            "[terminal-debug][{}][backend.exit] {:?}",
            output_session_id, exit_code
        );
        let _ = output_app.emit(
            "terminal-exit",
            TerminalExitEvent {
                session_id: output_session_id,
                exit_code,
            },
        );
    });

    Ok(TerminalSessionInfo {
        session_id,
        pid,
        current_directory,
        scope,
        label,
    })
}

fn build_remote_terminal_plan(
    params: &FileTransferParams,
    working_directory: Option<String>,
) -> Result<TerminalLaunchPlan, String> {
    let ProtocolParams::Generic(protocol_params) = &params.params else {
        return Err(String::from("当前连接不支持远端终端"));
    };

    if !matches!(
        params.protocol,
        FileTransferProtocol::Sftp | FileTransferProtocol::Scp
    ) {
        return Err(String::from("仅 SFTP / SCP 连接支持远端终端"));
    }

    let auto_password = protocol_params
        .password
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let command = build_remote_terminal_command(protocol_params, auto_password.as_deref())?;
    let startup_password = if should_use_expect_password_wrapper(auto_password.as_deref()) {
        None
    } else {
        auto_password.clone()
    };

    let current_directory = working_directory
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            params
                .remote_path
                .as_ref()
                .map(|path| path.display().to_string())
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_else(|| String::from("~"));

    let label = Some(
        match protocol_params
            .username
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            Some(username) => format!(
                "{username}@{}:{}",
                protocol_params.address, protocol_params.port
            ),
            None => format!("{}:{}", protocol_params.address, protocol_params.port),
        },
    );

    Ok(TerminalLaunchPlan {
        command,
        current_directory,
        label,
        startup_password,
        suppress_startup_password_prompt: auto_password.is_some(),
    })
}

fn should_use_expect_password_wrapper(password: Option<&str>) -> bool {
    #[cfg(target_family = "unix")]
    {
        password.is_some() && Path::new("/usr/bin/expect").exists()
    }

    #[cfg(not(target_family = "unix"))]
    {
        let _ = password;
        false
    }
}

fn strip_startup_password_prompt(chunk: &str) -> String {
    let chunk_lowercase = chunk.to_ascii_lowercase();
    let Some(prompt_index) = chunk_lowercase.find("password:") else {
        return chunk.to_string();
    };

    let prompt_line_start = chunk[..prompt_index]
        .rfind(['\r', '\n'])
        .map(|index| index + 1)
        .unwrap_or(0);
    let suffix_start = chunk[prompt_index..]
        .find(['\r', '\n'])
        .map(|offset| {
            let line_break_index = prompt_index + offset;
            let remainder = &chunk[line_break_index..];
            let skipped = remainder
                .char_indices()
                .find(|(_, value)| *value != '\r' && *value != '\n')
                .map(|(index, _)| index)
                .unwrap_or(remainder.len());
            line_break_index + skipped
        })
        .unwrap_or(chunk.len());

    if prompt_line_start == 0 && suffix_start >= chunk.len() {
        return String::new();
    }

    let mut visible_chunk = String::with_capacity(chunk.len());
    visible_chunk.push_str(&chunk[..prompt_line_start]);
    visible_chunk.push_str(&chunk[suffix_start..]);
    visible_chunk
}

fn emit_terminal_debug(app: &AppHandle, session_id: &str, stage: &str, message: impl Into<String>) {
    let _ = app.emit(
        "terminal-debug",
        TerminalDebugEvent {
            session_id: session_id.to_string(),
            stage: stage.to_string(),
            message: message.into(),
        },
    );
}

fn build_remote_terminal_command(
    protocol_params: &GenericProtocolParams,
    password: Option<&str>,
) -> Result<CommandBuilder, String> {
    let ssh_args = build_ssh_argument_list(protocol_params, password.is_some());

    #[cfg(target_family = "unix")]
    if let Some(password) = password
        && Path::new("/usr/bin/expect").exists()
    {
        return Ok(build_expect_wrapped_ssh_command(&ssh_args, password));
    }

    Ok(build_direct_ssh_command(&ssh_args))
}

fn build_ssh_argument_list(
    protocol_params: &GenericProtocolParams,
    prefer_password: bool,
) -> Vec<String> {
    let mut args = vec![
        String::from("-tt"),
        String::from("-o"),
        String::from("StrictHostKeyChecking=accept-new"),
        String::from("-p"),
        protocol_params.port.to_string(),
    ];

    if protocol_params.legacy_ssh_host_key_algorithms {
        args.push(String::from("-o"));
        args.push(String::from("HostKeyAlgorithms=+ssh-rsa,ssh-dss"));
        args.push(String::from("-o"));
        args.push(String::from("PubkeyAcceptedAlgorithms=+ssh-rsa,ssh-dss"));
    }

    if prefer_password {
        args.push(String::from("-o"));
        args.push(String::from(
            "PreferredAuthentications=password,keyboard-interactive",
        ));
        args.push(String::from("-o"));
        args.push(String::from("PubkeyAuthentication=no"));
    }

    if let Some(username) = protocol_params
        .username
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        args.push(String::from("-l"));
        args.push(username.to_string());
    }

    args.push(protocol_params.address.trim().to_string());
    args
}

fn build_direct_ssh_command(args: &[String]) -> CommandBuilder {
    let mut command = CommandBuilder::new(default_ssh_binary());
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    for arg in args {
        command.arg(arg);
    }
    command
}

#[cfg(target_family = "unix")]
fn build_expect_wrapped_ssh_command(args: &[String], password: &str) -> CommandBuilder {
    let mut command = CommandBuilder::new("/usr/bin/expect");
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.arg("-c");
    command.arg(build_expect_remote_ssh_script(args, password));
    command
}

fn write_shared_writer(writer: &SharedWriter, input: &str) -> Result<(), String> {
    let mut writer = writer
        .lock()
        .map_err(|_| String::from("终端输入通道不可用"))?;
    writer
        .write_all(input.as_bytes())
        .map_err(|error| format!("写入终端失败: {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("刷新终端输入失败: {error}"))
}

fn resolve_terminal_working_directory(
    working_directory: Option<String>,
) -> Result<PathBuf, String> {
    let directory = working_directory
        .map(|value| expand_home_path(PathBuf::from(value.trim())))
        .filter(|value| !value.as_os_str().is_empty())
        .or_else(dirs::home_dir)
        .or_else(|| std::env::current_dir().ok())
        .ok_or_else(|| String::from("无法确定终端目录"))?;

    if !directory.exists() {
        return Err(format!("终端目录不存在: {}", directory.display()));
    }

    if !directory.is_dir() {
        return Err(format!("终端目录不是文件夹: {}", directory.display()));
    }

    Ok(directory)
}

fn expand_home_path(path: PathBuf) -> PathBuf {
    let Some(raw) = path.to_str() else {
        return path;
    };

    if raw == "~" {
        return dirs::home_dir().unwrap_or(path);
    }

    if let Some(rest) = raw.strip_prefix("~/")
        && let Some(home) = dirs::home_dir()
    {
        return home.join(rest);
    }

    path
}

fn create_terminal_session_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default();

    format!("terminal-{millis}")
}

#[cfg(target_family = "unix")]
fn build_expect_remote_ssh_script(args: &[String], password: &str) -> String {
    let ssh_binary = default_ssh_binary();
    let mut script = String::from(
        "set timeout 8\n\
         log_user 0\n\
         set sent_password 0\n\
         spawn -noecho",
    );

    for arg in std::iter::once(ssh_binary.as_str()).chain(args.iter().map(String::as_str)) {
        script.push(' ');
        script.push_str(&escape_expect_list_arg(arg));
    }

    script.push_str(
        "\n\
         expect {\n\
           -nocase \"*continue connecting*\" {\n\
             send -- \"yes\\r\"\n\
             exp_continue\n\
           }\n\
           -nocase \"*password:*\" {\n\
             if {$sent_password == 0} {\n\
               set sent_password 1\n\
               set timeout 1\n\
               send -- \"",
    );
    script.push_str(&escape_expect_double_quoted(password));
    script.push_str(
        "\\r\"\n\
               log_user 1\n\
               exp_continue\n\
             }\n\
           }\n\
           eof {\n\
             exit\n\
           }\n\
           timeout {}\n\
         }\n\
         log_user 1\n\
         interact\n",
    );

    script
}

#[cfg(target_family = "unix")]
fn escape_expect_list_arg(value: &str) -> String {
    format!("{{{}}}", value.replace('}', "\\}"))
}

#[cfg(target_family = "unix")]
fn escape_expect_double_quoted(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('$', "\\$")
        .replace('[', "\\[")
        .replace(']', "\\]")
}

#[cfg(target_family = "unix")]
fn default_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| String::from("/bin/zsh"))
}

#[cfg(target_family = "windows")]
fn default_shell() -> String {
    std::env::var("COMSPEC")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| String::from("powershell.exe"))
}

#[cfg(target_family = "unix")]
fn default_ssh_binary() -> String {
    String::from("ssh")
}

#[cfg(target_family = "windows")]
fn default_ssh_binary() -> String {
    String::from("ssh.exe")
}

#[cfg(test)]
mod tests {
    #[cfg(target_family = "unix")]
    use super::{
        build_expect_remote_ssh_script, escape_expect_double_quoted, escape_expect_list_arg,
        strip_startup_password_prompt,
    };

    #[cfg(target_family = "unix")]
    #[test]
    fn escapes_expect_list_args() {
        assert_eq!(escape_expect_list_arg("plain"), "{plain}");
        assert_eq!(escape_expect_list_arg("with}brace"), "{with\\}brace}");
    }

    #[cfg(target_family = "unix")]
    #[test]
    fn escapes_expect_double_quoted_strings() {
        assert_eq!(
            escape_expect_double_quoted("pa$$wo\"rd[1]\\"),
            "pa\\$\\$wo\\\"rd\\[1\\]\\\\"
        );
    }

    #[cfg(target_family = "unix")]
    #[test]
    fn builds_expect_remote_ssh_script() {
        let script = build_expect_remote_ssh_script(
            &[
                String::from("-tt"),
                String::from("-p"),
                String::from("22"),
                String::from("example.com"),
            ],
            "secret",
        );

        assert!(script.contains("spawn -noecho {ssh} {-tt} {-p} {22} {example.com}"));
        assert!(script.contains("log_user 0"));
        assert!(script.contains("log_user 1"));
        assert!(script.contains("send -- \"secret\\r\""));
        assert!(script.contains("interact"));
    }

    #[test]
    fn strips_startup_password_prompt_from_terminal_output() {
        assert_eq!(strip_startup_password_prompt("host's password: "), "");
        assert_eq!(
            strip_startup_password_prompt("host's password: \r\nWelcome\r\n"),
            "Welcome\r\n"
        );
        assert_eq!(
            strip_startup_password_prompt("before\r\nhost's password: \r\nWelcome\r\n"),
            "before\r\nWelcome\r\n"
        );
    }
}
