use std::path::PathBuf;
use std::str::FromStr;
use std::sync::LazyLock;

use regex::{Captures, Regex};
use serde::Serialize;

use crate::core::host::{HostBridge, RemoteHost};
use crate::core::protocols::{
    AwsS3Params, FileTransferParams, FileTransferProtocol, GenericProtocolParams,
    KubeProtocolParams, ProtocolParams, SmbParams, WebDavProtocolParams,
};

static GENERIC_REMOTE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:(.+[^@])@)?([^:]+)(?::(\d+))?(?::(.+))?$").expect("valid generic remote regex")
});
static KUBE_REMOTE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:([^@]+))(@(?:([^$]+)))?(?:\$(.+))?$").expect("valid kube remote regex")
});
static S3_REMOTE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:(.+[^@])@)(?:([^:]+))(?::([a-zA-Z0-9][^:]+))?(?::([^:]+))?$")
        .expect("valid s3 remote regex")
});
static SMB_UNIX_REMOTE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:(.+[^@])@)?([^/:]+)(?::(\d+))?(?:/([^/]+))?(?:(/.+))?$")
        .expect("valid smb unix regex")
});
static SMB_WINDOWS_REMOTE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:(.+[^@])@)?([^:\\]+)(?:\\([^\\]+))?(?:(\\.+))?$")
        .expect("valid smb windows regex")
});

#[derive(Debug, Clone, Copy, Default)]
struct RemoteSpecOptions {
    legacy_ssh_host_key_algorithms: bool,
}

pub fn parse_remote_spec(input: &str) -> Result<FileTransferParams, String> {
    parse_remote_spec_with_default(input, FileTransferProtocol::Sftp)
}

pub fn parse_remote_spec_with_default(
    input: &str,
    default_protocol: FileTransferProtocol,
) -> Result<FileTransferParams, String> {
    let (input, options) = split_rterm_options(input);
    let (protocol, remote) = split_protocol(input, default_protocol)?;

    match protocol {
        FileTransferProtocol::AwsS3 => parse_s3_remote(remote.as_str()),
        FileTransferProtocol::Kube => parse_kube_remote(remote.as_str()),
        FileTransferProtocol::Smb if input.starts_with("\\\\") => {
            parse_smb_windows_remote(remote.as_str())
        }
        FileTransferProtocol::Smb => parse_smb_unix_remote(remote.as_str()),
        FileTransferProtocol::WebDav => parse_webdav_remote(remote.as_str(), input),
        protocol => parse_generic_remote(remote.as_str(), protocol, options),
    }
}

fn split_rterm_options(input: &str) -> (&str, RemoteSpecOptions) {
    let Some((remote, fragment)) = input.rsplit_once('#') else {
        return (input, RemoteSpecOptions::default());
    };

    let legacy_ssh_host_key_algorithms = fragment
        .split('&')
        .any(|part| part == "rterm-ssh-legacy-host-key=1");

    if legacy_ssh_host_key_algorithms {
        (
            remote,
            RemoteSpecOptions {
                legacy_ssh_host_key_algorithms,
            },
        )
    } else {
        (input, RemoteSpecOptions::default())
    }
}

fn split_protocol(
    input: &str,
    default_protocol: FileTransferProtocol,
) -> Result<(FileTransferProtocol, String), String> {
    if let Some(remote) = input.strip_prefix("\\\\") {
        return Ok((FileTransferProtocol::Smb, remote.to_string()));
    }

    if let Some((protocol, remote)) = input.split_once("://") {
        return Ok((
            FileTransferProtocol::from_str(protocol)?,
            remote.to_string(),
        ));
    }

    Ok((default_protocol, input.to_string()))
}

fn parse_generic_remote(
    input: &str,
    protocol: FileTransferProtocol,
    options: RemoteSpecOptions,
) -> Result<FileTransferParams, String> {
    let groups = GENERIC_REMOTE_REGEX
        .captures(input)
        .ok_or_else(|| String::from("Bad remote host syntax"))?;

    let (username, password) = parse_optional_credentials(optional_capture(&groups, 1));
    let address = required_capture(&groups, 2, "address")?;
    let port = parse_port(groups.get(3), protocol.default_port())?;
    let remote_path = groups.get(4).map(|value| PathBuf::from(value.as_str()));
    let params = ProtocolParams::Generic(
        GenericProtocolParams::default()
            .address(address)
            .port(port)
            .username(username)
            .password(password)
            .legacy_ssh_host_key_algorithms(options.legacy_ssh_host_key_algorithms),
    );

    Ok(FileTransferParams::new(protocol, params).remote_path(remote_path))
}

fn parse_webdav_remote(input: &str, original: &str) -> Result<FileTransferParams, String> {
    let (credentials, rest) = input
        .rsplit_once('@')
        .ok_or_else(|| String::from("Bad remote host syntax"))?;
    let (username, password) = credentials
        .split_once(':')
        .ok_or_else(|| String::from("Missing username or password"))?;
    if username.is_empty() || password.is_empty() {
        return Err(String::from("Missing username or password"));
    }
    let (server, remote_path) = if let Some((host, path)) = rest.split_once('/') {
        (host, Some(PathBuf::from(format!("/{path}"))))
    } else {
        (rest, None)
    };
    let prefix = if original.starts_with("https://") {
        "https"
    } else {
        "http"
    };
    let params = ProtocolParams::WebDav(WebDavProtocolParams {
        uri: format!("{prefix}://{server}"),
        username: username.to_string(),
        password: password.to_string(),
    });

    Ok(FileTransferParams::new(FileTransferProtocol::WebDav, params).remote_path(remote_path))
}

fn parse_s3_remote(input: &str) -> Result<FileTransferParams, String> {
    let groups = S3_REMOTE_REGEX
        .captures(input)
        .ok_or_else(|| String::from("Bad remote host syntax"))?;

    let bucket = required_capture(&groups, 1, "bucket")?;
    let region = required_capture(&groups, 2, "region")?;
    let profile = optional_capture(&groups, 3);
    let remote_path = groups.get(4).map(|value| PathBuf::from(value.as_str()));
    let params = ProtocolParams::AwsS3(AwsS3Params::new(bucket, Some(region), profile));

    Ok(FileTransferParams::new(FileTransferProtocol::AwsS3, params).remote_path(remote_path))
}

fn parse_kube_remote(input: &str) -> Result<FileTransferParams, String> {
    let groups = KUBE_REMOTE_REGEX
        .captures(input)
        .ok_or_else(|| String::from("Bad remote host syntax"))?;

    let namespace = optional_capture(&groups, 1);
    let cluster_url = optional_capture(&groups, 3);
    let remote_path = groups.get(4).map(|value| PathBuf::from(value.as_str()));
    let params = ProtocolParams::Kube(KubeProtocolParams {
        namespace,
        cluster_url,
        username: None,
        client_cert: None,
        client_key: None,
    });

    Ok(FileTransferParams::new(FileTransferProtocol::Kube, params).remote_path(remote_path))
}

fn parse_smb_unix_remote(input: &str) -> Result<FileTransferParams, String> {
    let groups = SMB_UNIX_REMOTE_REGEX
        .captures(input)
        .ok_or_else(|| String::from("Bad remote host syntax"))?;

    let username = optional_capture(&groups, 1);
    let address = required_capture(&groups, 2, "address")?;
    let port = parse_port(groups.get(3), FileTransferProtocol::Smb.default_port())?;
    let share = required_capture(&groups, 4, "share")?;
    let remote_path = groups.get(5).map(|value| PathBuf::from(value.as_str()));
    let params = ProtocolParams::Smb(SmbParams::new(address, share).port(port).username(username));

    Ok(FileTransferParams::new(FileTransferProtocol::Smb, params).remote_path(remote_path))
}

fn parse_smb_windows_remote(input: &str) -> Result<FileTransferParams, String> {
    let groups = SMB_WINDOWS_REMOTE_REGEX
        .captures(input)
        .ok_or_else(|| String::from("Bad remote host syntax"))?;

    let username = optional_capture(&groups, 1);
    let address = required_capture(&groups, 2, "address")?;
    let share = required_capture(&groups, 3, "share")?;
    let remote_path = groups.get(4).map(|value| {
        let normalized = value.as_str().replace('\\', "/");
        PathBuf::from(normalized)
    });
    let params = ProtocolParams::Smb(SmbParams::new(address, share).username(username));

    Ok(FileTransferParams::new(FileTransferProtocol::Smb, params).remote_path(remote_path))
}

fn optional_capture(groups: &Captures<'_>, index: usize) -> Option<String> {
    groups.get(index).map(|group| group.as_str().to_string())
}

fn parse_optional_credentials(value: Option<String>) -> (Option<String>, Option<String>) {
    match value {
        Some(raw) => match raw.split_once(':') {
            Some((username, password)) => (
                (!username.is_empty()).then(|| username.to_string()),
                (!password.is_empty()).then(|| password.to_string()),
            ),
            None => (Some(raw), None),
        },
        None => (None, None),
    }
}

fn required_capture(groups: &Captures<'_>, index: usize, field: &str) -> Result<String, String> {
    optional_capture(groups, index).ok_or_else(|| format!("Missing {field}"))
}

fn parse_port(port: Option<regex::Match<'_>>, default: u16) -> Result<u16, String> {
    match port {
        Some(value) => value
            .as_str()
            .parse::<u16>()
            .map_err(|error| format!("Bad port \"{}\": {error}", value.as_str())),
        None => Ok(default),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResult {
    pub protocol: String,
    pub endpoint: String,
    pub connected: bool,
    pub working_directory: String,
    pub remote_path: Option<String>,
}

pub fn test_connection(spec: &str) -> Result<ConnectionTestResult, String> {
    let params = parse_remote_spec(spec)?;
    let endpoint = params.params.endpoint_label();
    let remote_path = params
        .remote_path
        .as_ref()
        .map(|path| path.display().to_string());

    let mut host = RemoteHost::from_params(&params).map_err(|error| error.to_string())?;
    host.connect().map_err(|error| error.to_string())?;
    let working_directory = host
        .pwd()
        .map_err(|error| error.to_string())?
        .display()
        .to_string();
    host.disconnect().map_err(|error| error.to_string())?;

    Ok(ConnectionTestResult {
        protocol: params.protocol.to_string(),
        endpoint,
        connected: true,
        working_directory,
        remote_path,
    })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::core::protocols::ProtocolParams;

    #[test]
    fn parses_generic_sftp_with_defaults() {
        let result = parse_remote_spec("172.26.104.1").expect("parses");

        assert_eq!(result.protocol, FileTransferProtocol::Sftp);
        match result.params {
            ProtocolParams::Generic(params) => {
                assert_eq!(params.address, "172.26.104.1");
                assert_eq!(params.port, 22);
                assert_eq!(params.username, None);
            }
            other => panic!("unexpected params: {other:?}"),
        }
    }

    #[test]
    fn parses_generic_with_username_port_and_path() {
        let result = parse_remote_spec("ftp://anon@172.26.104.1:8021:/tmp").expect("parses");

        assert_eq!(result.protocol, FileTransferProtocol::Ftp(false));
        match result.params {
            ProtocolParams::Generic(params) => {
                assert_eq!(params.address, "172.26.104.1");
                assert_eq!(params.port, 8021);
                assert_eq!(params.username.as_deref(), Some("anon"));
                assert_eq!(params.password, None);
            }
            other => panic!("unexpected params: {other:?}"),
        }
        assert_eq!(result.remote_path, Some(PathBuf::from("/tmp")));
    }

    #[test]
    fn parses_generic_with_password() {
        let result = parse_remote_spec("sftp://demo:secret@example.com:/var/www").expect("parses");

        assert_eq!(result.protocol, FileTransferProtocol::Sftp);
        match result.params {
            ProtocolParams::Generic(params) => {
                assert_eq!(params.address, "example.com");
                assert_eq!(params.username.as_deref(), Some("demo"));
                assert_eq!(params.password.as_deref(), Some("secret"));
            }
            other => panic!("unexpected params: {other:?}"),
        }
        assert_eq!(result.remote_path, Some(PathBuf::from("/var/www")));
    }

    #[test]
    fn parses_legacy_ssh_host_key_option() {
        let result =
            parse_remote_spec("sftp://demo@example.com:/var/www#rterm-ssh-legacy-host-key=1")
                .expect("parses");

        match result.params {
            ProtocolParams::Generic(params) => {
                assert!(params.legacy_ssh_host_key_algorithms);
            }
            other => panic!("unexpected params: {other:?}"),
        }
        assert_eq!(result.remote_path, Some(PathBuf::from("/var/www")));
    }

    #[test]
    fn parses_s3_remote() {
        let result = parse_remote_spec("s3://assets@us-east-1:prod:/backups").expect("parses");

        assert_eq!(result.protocol, FileTransferProtocol::AwsS3);
        match result.params {
            ProtocolParams::AwsS3(params) => {
                assert_eq!(params.bucket_name, "assets");
                assert_eq!(params.region.as_deref(), Some("us-east-1"));
                assert_eq!(params.profile.as_deref(), Some("prod"));
            }
            other => panic!("unexpected params: {other:?}"),
        }
        assert_eq!(result.remote_path, Some(PathBuf::from("/backups")));
    }

    #[test]
    fn parses_webdav_remote() {
        let result = parse_remote_spec("https://demo:secret@example.com/files").expect("parses");

        assert_eq!(result.protocol, FileTransferProtocol::WebDav);
        match result.params {
            ProtocolParams::WebDav(params) => {
                assert_eq!(params.uri, "https://example.com");
                assert_eq!(params.username, "demo");
                assert_eq!(params.password, "secret");
            }
            other => panic!("unexpected params: {other:?}"),
        }
        assert_eq!(result.remote_path, Some(PathBuf::from("/files")));
    }

    #[test]
    fn parses_webdav_with_at_in_credentials() {
        let result =
            parse_remote_spec("https://demo@example.com:p@ss@example.org/files").expect("parses");

        assert_eq!(result.protocol, FileTransferProtocol::WebDav);
        match result.params {
            ProtocolParams::WebDav(params) => {
                assert_eq!(params.uri, "https://example.org");
                assert_eq!(params.username, "demo@example.com");
                assert_eq!(params.password, "p@ss");
            }
            other => panic!("unexpected params: {other:?}"),
        }
    }

    #[test]
    fn parses_kube_remote() {
        let result =
            parse_remote_spec("kube://production@https://kube.example.com$/etc").expect("parses");

        assert_eq!(result.protocol, FileTransferProtocol::Kube);
        match result.params {
            ProtocolParams::Kube(params) => {
                assert_eq!(params.namespace.as_deref(), Some("production"));
                assert_eq!(
                    params.cluster_url.as_deref(),
                    Some("https://kube.example.com")
                );
            }
            other => panic!("unexpected params: {other:?}"),
        }
        assert_eq!(result.remote_path, Some(PathBuf::from("/etc")));
    }

    #[test]
    fn parses_smb_unix_remote() {
        let result = parse_remote_spec("smb://backup@fileserver:1445/share/path").expect("parses");

        assert_eq!(result.protocol, FileTransferProtocol::Smb);
        match result.params {
            ProtocolParams::Smb(params) => {
                assert_eq!(params.address, "fileserver");
                assert_eq!(params.port, 1445);
                assert_eq!(params.share, "share");
                assert_eq!(params.username.as_deref(), Some("backup"));
            }
            other => panic!("unexpected params: {other:?}"),
        }
        assert_eq!(result.remote_path, Some(PathBuf::from("/path")));
    }

    #[test]
    fn honors_override_default_protocol() {
        let result = parse_remote_spec_with_default("storage.internal", FileTransferProtocol::Scp)
            .expect("parses");

        assert_eq!(result.protocol, FileTransferProtocol::Scp);
        match result.params {
            ProtocolParams::Generic(params) => {
                assert_eq!(params.port, 22);
                assert_eq!(params.address, "storage.internal");
            }
            other => panic!("unexpected params: {other:?}"),
        }
    }
}
