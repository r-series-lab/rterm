pub mod remotefs_builder;

use std::fmt;
use std::path::{Path, PathBuf};
use std::str::FromStr;

use serde::Serialize;

pub fn supported_protocols() -> Vec<&'static str> {
    let mut protocols = Vec::new();

    #[cfg(feature = "protocol-ssh")]
    {
        protocols.extend(["sftp", "scp"]);
    }

    #[cfg(feature = "protocol-ftp")]
    {
        protocols.extend(["ftp", "ftps"]);
    }

    #[cfg(feature = "protocol-webdav")]
    {
        protocols.push("webdav");
    }

    #[cfg(feature = "protocol-s3")]
    {
        protocols.push("s3");
    }

    #[cfg(feature = "protocol-kube")]
    {
        protocols.push("kube");
    }

    protocols
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileTransferProtocol {
    AwsS3,
    Ftp(bool),
    Kube,
    Scp,
    Sftp,
    Smb,
    WebDav,
}

impl FileTransferProtocol {
    pub fn default_port(self) -> u16 {
        match self {
            Self::Ftp(_) => 21,
            Self::Scp | Self::Sftp => 22,
            Self::Smb => 445,
            _ => 22,
        }
    }
}

impl fmt::Display for FileTransferProtocol {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let value = match self {
            Self::AwsS3 => "s3",
            Self::Ftp(true) => "ftps",
            Self::Ftp(false) => "ftp",
            Self::Kube => "kube",
            Self::Scp => "scp",
            Self::Sftp => "sftp",
            Self::Smb => "smb",
            Self::WebDav => "webdav",
        };

        write!(f, "{value}")
    }
}

impl FromStr for FileTransferProtocol {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.to_ascii_lowercase().as_str() {
            "ftp" => Ok(Self::Ftp(false)),
            "ftps" => Ok(Self::Ftp(true)),
            "http" | "https" | "webdav" => Ok(Self::WebDav),
            "kube" => Ok(Self::Kube),
            "s3" => Ok(Self::AwsS3),
            "scp" => Ok(Self::Scp),
            "sftp" => Ok(Self::Sftp),
            "smb" => Ok(Self::Smb),
            _ => Err(format!("Unknown protocol \"{value}\"")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTransferParams {
    pub protocol: FileTransferProtocol,
    pub params: ProtocolParams,
    pub remote_path: Option<PathBuf>,
    pub local_path: Option<PathBuf>,
}

impl FileTransferParams {
    pub fn new(protocol: FileTransferProtocol, params: ProtocolParams) -> Self {
        Self {
            protocol,
            params,
            remote_path: None,
            local_path: None,
        }
    }

    pub fn remote_path<P: AsRef<Path>>(mut self, path: Option<P>) -> Self {
        self.remote_path = path.map(|value| value.as_ref().to_path_buf());
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "type", content = "value")]
pub enum ProtocolParams {
    Generic(GenericProtocolParams),
    AwsS3(AwsS3Params),
    Kube(KubeProtocolParams),
    Smb(SmbParams),
    WebDav(WebDavProtocolParams),
}

impl ProtocolParams {
    pub fn endpoint_label(&self) -> String {
        match self {
            Self::Generic(params) => params.address.clone(),
            Self::AwsS3(params) => params.bucket_name.clone(),
            Self::Kube(params) => params
                .namespace
                .clone()
                .unwrap_or_else(|| String::from("default")),
            Self::Smb(params) => format!("{}/{}", params.address, params.share),
            Self::WebDav(params) => params.uri.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenericProtocolParams {
    pub address: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    #[serde(default)]
    pub legacy_ssh_host_key_algorithms: bool,
}

impl Default for GenericProtocolParams {
    fn default() -> Self {
        Self {
            address: "localhost".to_string(),
            port: 22,
            username: None,
            password: None,
            legacy_ssh_host_key_algorithms: false,
        }
    }
}

impl GenericProtocolParams {
    pub fn address(mut self, address: impl Into<String>) -> Self {
        self.address = address.into();
        self
    }

    pub fn port(mut self, port: u16) -> Self {
        self.port = port;
        self
    }

    pub fn username(mut self, username: Option<impl Into<String>>) -> Self {
        self.username = username.map(Into::into);
        self
    }

    pub fn password(mut self, password: Option<impl Into<String>>) -> Self {
        self.password = password.map(Into::into);
        self
    }

    pub fn legacy_ssh_host_key_algorithms(mut self, enabled: bool) -> Self {
        self.legacy_ssh_host_key_algorithms = enabled;
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AwsS3Params {
    pub bucket_name: String,
    pub region: Option<String>,
    pub endpoint: Option<String>,
    pub profile: Option<String>,
    pub access_key: Option<String>,
    pub secret_access_key: Option<String>,
    pub security_token: Option<String>,
    pub session_token: Option<String>,
    pub new_path_style: bool,
}

impl AwsS3Params {
    pub fn new(
        bucket_name: impl Into<String>,
        region: Option<impl Into<String>>,
        profile: Option<impl Into<String>>,
    ) -> Self {
        Self {
            bucket_name: bucket_name.into(),
            region: region.map(Into::into),
            endpoint: None,
            profile: profile.map(Into::into),
            access_key: None,
            secret_access_key: None,
            security_token: None,
            session_token: None,
            new_path_style: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubeProtocolParams {
    pub namespace: Option<String>,
    pub cluster_url: Option<String>,
    pub username: Option<String>,
    pub client_cert: Option<String>,
    pub client_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmbParams {
    pub address: String,
    pub port: u16,
    pub share: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub workgroup: Option<String>,
}

impl SmbParams {
    pub fn new(address: impl Into<String>, share: impl Into<String>) -> Self {
        Self {
            address: address.into(),
            port: 445,
            share: share.into(),
            username: None,
            password: None,
            workgroup: None,
        }
    }

    pub fn port(mut self, port: u16) -> Self {
        self.port = port;
        self
    }

    pub fn username(mut self, username: Option<impl Into<String>>) -> Self {
        self.username = username.map(Into::into);
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDavProtocolParams {
    pub uri: String,
    pub username: String,
    pub password: String,
}
