pub mod commands;
pub mod json;

use clap::{Args, Parser, Subcommand};
use std::fmt;

#[derive(Debug)]
pub struct CliError {
    message: String,
    already_rendered: bool,
}

impl CliError {
    pub fn plain(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            already_rendered: false,
        }
    }

    pub fn rendered(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            already_rendered: true,
        }
    }

    pub fn already_rendered(&self) -> bool {
        self.already_rendered
    }
}

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for CliError {}

impl From<anyhow::Error> for CliError {
    fn from(error: anyhow::Error) -> Self {
        Self::plain(error.to_string())
    }
}

pub type CliResult<T> = std::result::Result<T, CliError>;

#[derive(Debug, Parser)]
#[command(
    name = "rterm",
    version,
    about = "rTerm shared CLI for diagnostics and future automation"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Browse {
        #[command(subcommand)]
        command: BrowseCommand,
    },
    Connections {
        #[command(subcommand)]
        command: ConnectionsCommand,
    },
    Info(JsonFlag),
    Capabilities(JsonFlag),
}

#[derive(Debug, Subcommand)]
enum BrowseCommand {
    List(BrowseListArgs),
}

#[derive(Debug, Subcommand)]
enum ConnectionsCommand {
    Test(ConnectionTestArgs),
}

#[derive(Debug, Args, Clone, Copy, Default)]
struct JsonFlag {
    #[arg(long, help = "Print JSON only")]
    json: bool,
}

#[derive(Debug, Args, Clone)]
struct BrowseListArgs {
    #[arg(
        long,
        help = "Directory to inspect. For remote sessions this overrides any path encoded in --remote."
    )]
    path: Option<std::path::PathBuf>,
    #[arg(long, help = "Remote spec such as sftp://user@example.com:/var/www")]
    remote: Option<String>,
    #[arg(long, help = "Include dotfiles in the result set")]
    hidden: bool,
    #[arg(long, help = "Print JSON only")]
    json: bool,
}

#[derive(Debug, Args, Clone)]
struct ConnectionTestArgs {
    #[arg(long, help = "Remote spec such as sftp://user@example.com:/var/www")]
    remote: String,
    #[arg(long, help = "Print JSON only")]
    json: bool,
}

pub fn run() -> CliResult<()> {
    let cli = Cli::parse();

    match cli.command {
        Command::Browse {
            command: BrowseCommand::List(args),
        } => commands::browse::list(args.path, args.remote, args.hidden, args.json),
        Command::Connections {
            command: ConnectionsCommand::Test(args),
        } => commands::connections::test(args.remote, args.json),
        Command::Info(flags) => commands::info::run(flags.json).map_err(CliError::from),
        Command::Capabilities(flags) => {
            commands::capabilities::run(flags.json).map_err(CliError::from)
        }
    }
}
