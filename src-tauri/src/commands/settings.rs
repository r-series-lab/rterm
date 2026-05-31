use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use serde_json::{Value, json};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionConfigFile {
    pub path: String,
    pub config: Value,
}

#[tauri::command]
pub fn load_terminal_completion_config() -> Result<CompletionConfigFile, String> {
    ensure_completion_config()
}

fn ensure_completion_config() -> Result<CompletionConfigFile, String> {
    let path = completion_config_path();
    if !path.exists() {
        let config = default_completion_config();
        write_completion_config(&path, &config)?;
        return Ok(CompletionConfigFile {
            path: path.display().to_string(),
            config,
        });
    }

    let content =
        fs::read_to_string(&path).map_err(|error| format!("读取补全配置失败：{}", error))?;
    let config = serde_json::from_str::<Value>(&content)
        .map_err(|error| format!("解析补全配置失败：{}", error))?;

    Ok(CompletionConfigFile {
        path: path.display().to_string(),
        config,
    })
}

fn write_completion_config(path: &PathBuf, config: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建配置目录失败：{}", error))?;
    }

    let content = serde_json::to_string_pretty(config)
        .map_err(|error| format!("序列化补全配置失败：{}", error))?;
    fs::write(path, format!("{}\n", content))
        .map_err(|error| format!("写入补全配置失败：{}", error))
}

fn completion_config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("rterm")
        .join("completion.json")
}

fn default_completion_config() -> Value {
    json!({
        "enabled": true,
        "acceptKey": "tab",
        "maxSuggestions": 5,
        "minInputLength": 1,
        "sources": {
            "history": true,
            "filesystem": true,
            "connections": true,
            "git": true,
            "snippets": true,
            "customCommands": true
        },
        "customCommands": [],
        "snippets": [],
        "profiles": {
            "auto": {
                "extends": "posix"
            },
            "posix": {
                "customCommands": [
                    { "name": "ls -la", "description": "列出当前目录的详细文件信息", "insert": "ls -la" },
                    { "name": "dir", "description": "列出目录内容", "insert": "dir" },
                    { "name": "pwd", "description": "显示当前目录", "insert": "pwd" },
                    { "name": "cp", "description": "复制文件或目录", "insert": "cp " },
                    { "name": "scp", "description": "通过 SSH 复制文件", "insert": "scp " },
                    { "name": "rsync -av", "description": "同步文件或目录", "insert": "rsync -av " },
                    { "name": "mv", "description": "移动或重命名文件", "insert": "mv " },
                    { "name": "rm -i", "description": "交互式删除文件", "insert": "rm -i " },
                    { "name": "mkdir -p", "description": "创建目录", "insert": "mkdir -p " },
                    { "name": "cat", "description": "输出文件内容", "insert": "cat " },
                    { "name": "grep -R", "description": "递归搜索文本", "insert": "grep -R " },
                    { "name": "du -sh *", "description": "查看当前目录下各项目体积", "insert": "du -sh *" },
                    { "name": "df -h", "description": "查看磁盘空间", "insert": "df -h" },
                    { "name": "find . -maxdepth 2 -type f", "description": "快速列出两层以内的文件", "insert": "find . -maxdepth 2 -type f" },
                    { "name": "tar -xzf", "description": "解压 .tar.gz 文件", "insert": "tar -xzf " },
                    { "name": "chmod", "description": "修改文件权限", "insert": "chmod " },
                    { "name": "ssh", "description": "启动 SSH 连接", "insert": "ssh " },
                    { "name": "tail -f", "description": "持续查看日志文件", "insert": "tail -f " }
                ],
                "snippets": [
                    { "trigger": "untar", "description": "解压 .tar.gz 文件", "insert": "tar -xzf " },
                    { "trigger": "mkcd", "description": "创建目录并进入", "insert": "mkdir -p  && cd " },
                    { "trigger": "ports", "description": "查看监听端口", "insert": "lsof -i -P -n | grep LISTEN" }
                ]
            },
            "bash": {
                "extends": "posix",
                "customCommands": [
                    { "name": "history | tail -20", "description": "查看最近 shell 历史", "insert": "history | tail -20" },
                    { "name": "alias", "description": "列出 Bash alias", "insert": "alias" }
                ]
            },
            "zsh": {
                "extends": "posix",
                "customCommands": [
                    { "name": "history -20", "description": "查看最近 zsh 历史", "insert": "history -20" },
                    { "name": "whence", "description": "查看命令来源", "insert": "whence " }
                ]
            },
            "fish": {
                "extends": "posix",
                "customCommands": [
                    { "name": "history | head -20", "description": "查看最近 fish 历史", "insert": "history | head -20" },
                    { "name": "functions", "description": "列出 fish 函数", "insert": "functions" }
                ]
            },
            "powershell": {
                "customCommands": [
                    { "name": "dir", "description": "列出当前目录", "insert": "dir" },
                    { "name": "Get-ChildItem", "description": "列出目录内容", "insert": "Get-ChildItem" },
                    { "name": "pwd", "description": "显示当前目录", "insert": "pwd" },
                    { "name": "Get-Location", "description": "显示当前目录", "insert": "Get-Location" },
                    { "name": "cd", "description": "切换目录", "insert": "cd " },
                    { "name": "ls", "description": "列出目录内容（PowerShell alias）", "insert": "ls" },
                    { "name": "cp", "description": "复制项目（PowerShell alias）", "insert": "cp " },
                    { "name": "Copy-Item", "description": "复制文件或目录", "insert": "Copy-Item " },
                    { "name": "scp", "description": "通过 OpenSSH 复制文件", "insert": "scp " },
                    { "name": "Move-Item", "description": "移动或重命名项目", "insert": "Move-Item " },
                    { "name": "mv", "description": "移动或重命名项目（PowerShell alias）", "insert": "mv " },
                    { "name": "Remove-Item", "description": "删除项目", "insert": "Remove-Item " },
                    { "name": "rm", "description": "删除项目（PowerShell alias）", "insert": "rm " },
                    { "name": "New-Item -ItemType Directory", "description": "创建目录", "insert": "New-Item -ItemType Directory " },
                    { "name": "mkdir", "description": "创建目录（PowerShell alias）", "insert": "mkdir " },
                    { "name": "Get-Content -Tail 100", "description": "查看文件尾部", "insert": "Get-Content -Tail 100 " },
                    { "name": "cat", "description": "输出文件内容（PowerShell alias）", "insert": "cat " },
                    { "name": "type", "description": "输出文件内容（PowerShell alias）", "insert": "type " },
                    { "name": "Select-String", "description": "搜索文本", "insert": "Select-String " },
                    { "name": "Get-Process", "description": "查看进程", "insert": "Get-Process" },
                    { "name": "Test-Path", "description": "检查路径是否存在", "insert": "Test-Path " },
                    { "name": "ssh", "description": "启动 SSH 连接", "insert": "ssh " }
                ],
                "snippets": [
                    { "trigger": "tail", "description": "查看文件尾部", "insert": "Get-Content -Tail 100 " },
                    { "trigger": "grep", "description": "搜索文本", "insert": "Select-String " }
                ]
            },
            "cmd": {
                "customCommands": [
                    { "name": "dir", "description": "列出目录内容", "insert": "dir" },
                    { "name": "cd", "description": "切换目录", "insert": "cd " },
                    { "name": "copy", "description": "复制文件", "insert": "copy " },
                    { "name": "xcopy", "description": "复制目录树", "insert": "xcopy " },
                    { "name": "robocopy", "description": "稳健复制目录", "insert": "robocopy " },
                    { "name": "del", "description": "删除文件", "insert": "del " },
                    { "name": "type", "description": "输出文件内容", "insert": "type " },
                    { "name": "findstr", "description": "搜索文本", "insert": "findstr " },
                    { "name": "mkdir", "description": "创建目录", "insert": "mkdir " },
                    { "name": "move", "description": "移动或重命名项目", "insert": "move " },
                    { "name": "where", "description": "查找命令路径", "insert": "where " },
                    { "name": "ipconfig", "description": "查看网络配置", "insert": "ipconfig" },
                    { "name": "tasklist", "description": "查看进程", "insert": "tasklist" },
                    { "name": "scp", "description": "通过 OpenSSH 复制文件", "insert": "scp " },
                    { "name": "ssh", "description": "启动 SSH 连接", "insert": "ssh " }
                ],
                "snippets": [
                    { "trigger": "grep", "description": "搜索文本", "insert": "findstr " }
                ]
            }
        },
        "privacy": {
            "ignorePatterns": ["*token*", "*password*", "*secret*", "*passwd*", "*private_key*"]
        }
    })
}
