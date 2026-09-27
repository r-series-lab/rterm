# rTerm

`rTerm` 是一个中文友好的远程目录工作台，用来管理 SFTP、SCP、FTP、FTPS 和 WebDAV 连接，浏览本地与远端文件，执行常见文件操作，并提供稳定 CLI 给脚本和 AI Agent 使用。它不是完整终端模拟器或云端同步平台，而是面向日常远程目录管理的本地桌面工具。

技术栈：`Tauri 2 + Rust + React + Vite + TypeScript + Material UI`

## 功能

- 连接 SFTP、SCP、FTP、FTPS、WebDAV 远端目录
- 管理最近连接和收藏连接
- 收藏同一主机下的多个常用目录
- 双栏浏览本地与远端文件
- 新建目录、重命名、复制、移动、删除和修改权限
- 预览和保存文本文件
- 计算本地或远端文件 MD5
- 上传、下载和冲突检查
- 本地命令执行和基础远端命令入口
- 轻量终端补全建议，支持历史、当前目录、收藏目录、Git 常用命令、自定义命令、片段和目标终端 profile
- SQLite 保存本地状态，密码加密后写入本机存储
- 原生 CLI 支持 `info`、`capabilities`、`browse list`、`connections test`
- `--json` 输出稳定，适合自动化工具解析

## 适合做什么

- 快速进入常用服务器目录
- 在一个桌面窗口里对照本地目录和远端目录
- 处理简单部署、上传、下载和文件检查工作
- 给 AI Agent 提供可验证的远程目录能力边界
- 在本机保存连接历史和收藏目录

当前版本不会替代专业终端、SSH 客户端、rsync、SFTP 批处理工具或云盘同步服务。复杂批量任务仍建议使用专门命令行工具。

## 快速开始

安装前端依赖：

```bash
npm run web:install
```

启动桌面开发版：

```bash
npm run dev
```

检查 Rust 和前端构建：

```bash
npm run rust-check
npm run web:build
```

构建 CLI：

```bash
cargo build
./target/debug/rterm info --json
```

## CLI 用法

开发期直接运行：

```bash
cargo run -- info --json
cargo run -- capabilities --json
cargo run -- browse list --json --path .
```

构建后使用：

```bash
./target/debug/rterm info --json
./target/debug/rterm capabilities --json
./target/debug/rterm browse list --json --path .
```

### CLI 命令

| 命令 | 用途 | JSON |
| --- | --- | --- |
| `info` | 输出 app 名称、版本、架构、运行 profile 和本机数据路径 | 是 |
| `capabilities` | 输出支持协议、桌面页面、CLI 命令和存储能力 | 是 |
| `browse list` | 列出本地目录或远端目录 | 是 |
| `connections test` | 测试远端连接并返回工作目录 | 是 |

### 本地目录浏览

```bash
cargo run -- browse list --json --path .
cargo run -- browse list --json --path ./src --hidden
```

### 远端连接示例

SFTP：

```bash
cargo run -- browse list --json \
  --remote 'sftp://user@example.com:/var/www'
```

SCP：

```bash
cargo run -- connections test --json \
  --remote 'scp://user@example.com:/var/www'
```

FTP / FTPS：

```bash
cargo run -- browse list --json \
  --remote 'ftp://user:password@example.com:/incoming'

cargo run -- browse list --json \
  --remote 'ftps://user:password@example.com:/incoming'
```

WebDAV：

```bash
cargo run -- browse list --json \
  --remote 'https://user:password@example.com/webdav/path'
```

旧 SSH 主机需要兼容 host key 算法时，可以在 remote spec 后追加：

```bash
cargo run -- connections test --json \
  --remote 'sftp://user@example.com:/var/www#rterm-ssh-legacy-host-key=1'
```

## 可选协议

默认构建包含 `sftp`、`scp`、`ftp`、`ftps`、`webdav`。`s3` 和 `kube` 属于较重协议，按需启用：

```bash
cargo run --features protocol-s3,protocol-kube -- capabilities --json
cargo check --features protocol-s3,protocol-kube
```

## JSON 输出约定

成功：

```json
{
  "ok": true,
  "command": "capabilities",
  "data": {
    "protocols": ["sftp", "scp", "ftp", "ftps", "webdav"]
  }
}
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "connection_test_failed",
    "message": "connection failed"
  }
}
```

启用 `--json` 时，CLI 不会混入解释性 prose。

## 给 AI / 自动化工具的建议

- 先调用 `rterm capabilities --json`，确认当前构建支持哪些协议。
- 需要了解运行环境时调用 `rterm info --json`，但不要把本机路径展示给最终用户。
- 需要列目录时优先使用 `browse list --json --path ...` 或 `browse list --json --remote ...`。
- 需要真实连接前先调用 `connections test --json --remote ...`。
- 不要把密码、token、私钥或生产主机写入 README、测试、issue 或脚本。
- 自动化脚本应只解析 `ok`、`command`、`data`、`error` 字段。

## 数据与安全边界

- 本地状态保存到系统数据目录下的 SQLite。
- 收藏连接可以保存用户名和目录。
- 收藏密码会加密存储，主密钥优先使用系统 keychain。
- 终端补全配置保存为本机 JSON 文件，只保存规则和静态命令，不持久化实时终端输入。
- 仓库不包含真实服务器地址、账号、密码、私钥或业务配置。
- 远端文件操作会真实修改目标目录，自动化调用前应先展示计划并获得确认。

## 终端补全配置

rTerm 的补全建议是非侵入式的：前端只根据当前输入行生成建议，接受建议时向 PTY 发送补齐文本，让当前 shell 自己回显。它不会自动改写 `.zshrc`，也不会替代 zsh/bash 自带补全。

连接配置里的“终端补全”表示目标终端类型，而不是运行 rTerm 的客户端系统。默认 `auto` 使用 POSIX 命令集；也可以手动选择 `posix`、`bash`、`zsh`、`fish`、`powershell` 或 `cmd`。rTerm 暂不做远端 shell 探测，这样更轻、更稳定，也不会额外执行探测命令。

桌面版首次启动会生成：

```text
~/.config/rterm/completion.json                 # Linux
~/Library/Application Support/rterm/completion.json  # macOS
%APPDATA%\rterm\completion.json                 # Windows
```

配置示例：

```json
{
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
  "customCommands": [
    {
      "name": "project logs",
      "description": "全局自定义命令，所有目标终端都可提示",
      "insert": "tail -f ./logs/app.log"
    }
  ],
  "snippets": [],
  "profiles": {
    "auto": {
      "extends": "posix"
    },
    "posix": {
      "customCommands": [
        {
          "name": "cp",
          "description": "复制文件或目录",
          "insert": "cp "
        },
        {
          "name": "scp",
          "description": "通过 SSH 复制文件",
          "insert": "scp "
        },
        {
          "name": "dir",
          "description": "列出目录内容",
          "insert": "dir"
        }
      ],
      "snippets": [
        {
          "trigger": "untar",
          "description": "解压 .tar.gz 文件",
          "insert": "tar -xzf "
        }
      ]
    },
    "powershell": {
      "customCommands": [
        {
          "name": "dir",
          "description": "列出目录内容",
          "insert": "dir"
        },
        {
          "name": "cp",
          "description": "复制项目（PowerShell alias）",
          "insert": "cp "
        },
        {
          "name": "scp",
          "description": "通过 OpenSSH 复制文件",
          "insert": "scp "
        }
      ],
      "snippets": [
        {
          "trigger": "grep",
          "description": "搜索文本",
          "insert": "Select-String "
        }
      ]
    },
    "cmd": {
      "customCommands": [
        {
          "name": "dir",
          "description": "列出目录内容",
          "insert": "dir"
        },
        {
          "name": "copy",
          "description": "复制文件",
          "insert": "copy "
        },
        {
          "name": "scp",
          "description": "通过 OpenSSH 复制文件",
          "insert": "scp "
        }
      ]
    }
  },
  "privacy": {
    "ignorePatterns": ["*token*", "*password*", "*secret*"]
  }
}
```

顶层 `customCommands` 和 `snippets` 是全局补全；`profiles.*.customCommands` 和 `profiles.*.snippets` 只在对应目标终端 profile 下生效。`extends` 可复用另一个 profile，例如 `bash`、`zsh`、`fish` 默认继承 `posix`。

内置默认命令覆盖 Linux / POSIX 常用的 `ls`、`dir`、`cp`、`scp`、`rsync`、`grep`、`tail` 等，也覆盖 Windows PowerShell / CMD 常用的 `dir`、`cd`、`copy`、`cp`、`scp`、`findstr`、`Select-String` 等。`acceptKey` 可选 `tab`、`arrowRight`、`ctrlSpace`。如果你更依赖 shell 原生 Tab 补全，可以把它改成 `arrowRight` 或 `ctrlSpace`。补全配置在 rTerm 启动时读取，修改后重启应用生效。

## 开发命令

```bash
npm run web:install    # 安装 web 依赖
npm run dev            # 启动桌面开发版
npm run web:build      # 前端生产构建
npm run rust-check     # Rust 类型检查
npm run size           # 查看构建缓存和产物体积
npm run clean          # 清理构建产物
npm run clean:all      # 清理构建产物和 web/node_modules
```

## 项目结构

```text
src/               Rust core、CLI、协议适配、SQLite storage
src-tauri/         Tauri 桌面壳和 native commands
web/               React + Vite 前端
web/src/pages/     连接、工作台、设置页面
web/src/lib/       运行时调用、类型和预览数据
```

## 许可证

MIT，见 [LICENSE](LICENSE)。

公开仓库边界、贡献约定与安全报告方式见 [PUBLIC_REPOSITORY.md](PUBLIC_REPOSITORY.md)、[CONTRIBUTING.md](CONTRIBUTING.md) 和 [SECURITY.md](SECURITY.md)。
