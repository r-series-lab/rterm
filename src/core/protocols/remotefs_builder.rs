use std::sync::Arc;

use anyhow::{Result, anyhow};
use remotefs::RemoteFs;
#[cfg(feature = "protocol-s3")]
use remotefs_aws_s3::AwsS3Fs;
#[cfg(all(
    feature = "protocol-ftp",
    any(target_family = "unix", target_family = "windows")
))]
use remotefs_ftp::FtpFs;
#[cfg(feature = "protocol-kube")]
use remotefs_kube::{Config as KubeConfig, KubeMultiPodFs as KubeFs};
#[cfg(feature = "protocol-ssh")]
use remotefs_ssh::{
    KeyMethod, MethodType, NoCheckServerKey, RusshSession as SshSession, ScpFs, SftpFs,
    SshAgentIdentity, SshConfigParseRule, SshOpts,
};
#[cfg(feature = "protocol-webdav")]
use remotefs_webdav::WebDAVFs;
use tokio::runtime::Runtime;

#[cfg(feature = "protocol-kube")]
use crate::core::protocols::KubeProtocolParams;
use crate::core::protocols::{FileTransferParams, FileTransferProtocol, ProtocolParams};
#[cfg(feature = "protocol-ssh")]
use crate::platform::keychain::ssh_keys::{DefaultSshKeyStorage, default_ssh_config_path};

pub struct RemoteFsBuilder;

impl RemoteFsBuilder {
    pub fn build(params: &FileTransferParams) -> Result<Box<dyn RemoteFs + Send>> {
        match (&params.protocol, &params.params) {
            #[cfg(feature = "protocol-s3")]
            (FileTransferProtocol::AwsS3, ProtocolParams::AwsS3(params)) => {
                Ok(Box::new(Self::aws_s3_client(params.clone())?))
            }
            #[cfg(not(feature = "protocol-s3"))]
            (FileTransferProtocol::AwsS3, ProtocolParams::AwsS3(_)) => {
                Err(anyhow!("S3 support is disabled in the current build"))
            }
            #[cfg(all(
                feature = "protocol-ftp",
                any(target_family = "unix", target_family = "windows")
            ))]
            (FileTransferProtocol::Ftp(secure), ProtocolParams::Generic(params)) => {
                Ok(Box::new(Self::ftp_client(params.clone(), *secure)))
            }
            #[cfg(not(feature = "protocol-ftp"))]
            (FileTransferProtocol::Ftp(_), ProtocolParams::Generic(_)) => {
                Err(anyhow!("FTP support is disabled in the current build"))
            }
            #[cfg(feature = "protocol-kube")]
            (FileTransferProtocol::Kube, ProtocolParams::Kube(params)) => {
                Ok(Box::new(Self::kube_client(params.clone())?))
            }
            #[cfg(not(feature = "protocol-kube"))]
            (FileTransferProtocol::Kube, ProtocolParams::Kube(_)) => Err(anyhow!(
                "Kubernetes support is disabled in the current build"
            )),
            #[cfg(feature = "protocol-ssh")]
            (FileTransferProtocol::Scp, ProtocolParams::Generic(protocol_params)) => {
                if Self::should_use_sftp_for_scp(protocol_params, &params.remote_path) {
                    Ok(Box::new(Self::sftp_client(protocol_params.clone())?))
                } else {
                    Ok(Box::new(Self::scp_client(protocol_params.clone())?))
                }
            }
            #[cfg(not(feature = "protocol-ssh"))]
            (FileTransferProtocol::Scp, ProtocolParams::Generic(_)) => {
                Err(anyhow!("SCP support is disabled in the current build"))
            }
            #[cfg(feature = "protocol-ssh")]
            (FileTransferProtocol::Sftp, ProtocolParams::Generic(params)) => {
                Ok(Box::new(Self::sftp_client(params.clone())?))
            }
            #[cfg(not(feature = "protocol-ssh"))]
            (FileTransferProtocol::Sftp, ProtocolParams::Generic(_)) => {
                Err(anyhow!("SFTP support is disabled in the current build"))
            }
            #[cfg(feature = "protocol-webdav")]
            (FileTransferProtocol::WebDav, ProtocolParams::WebDav(params)) => {
                Ok(Box::new(Self::webdav_client(params)))
            }
            #[cfg(not(feature = "protocol-webdav"))]
            (FileTransferProtocol::WebDav, ProtocolParams::WebDav(_)) => {
                Err(anyhow!("WebDAV support is disabled in the current build"))
            }
            (FileTransferProtocol::Smb, _) => Err(anyhow!(
                "SMB remote builder is not enabled in the current scaffold yet"
            )),
            (protocol, protocol_params) => Err(anyhow!(
                "Invalid protocol/parameter combination: {protocol:?} with {protocol_params:?}"
            )),
        }
    }

    #[cfg(feature = "protocol-s3")]
    fn aws_s3_client(params: crate::core::protocols::AwsS3Params) -> Result<AwsS3Fs> {
        let rt = Arc::new(Self::tokio_runtime()?);
        let mut client =
            AwsS3Fs::new(params.bucket_name, &rt).new_path_style(params.new_path_style);
        if let Some(region) = params.region {
            client = client.region(region);
        }
        if let Some(profile) = params.profile {
            client = client.profile(profile);
        }
        if let Some(endpoint) = params.endpoint {
            client = client.endpoint(endpoint);
        }
        if let Some(access_key) = params.access_key {
            client = client.access_key(access_key);
        }
        if let Some(secret_access_key) = params.secret_access_key {
            client = client.secret_access_key(secret_access_key);
        }
        if let Some(security_token) = params.security_token {
            client = client.security_token(security_token);
        }
        if let Some(session_token) = params.session_token {
            client = client.session_token(session_token);
        }
        Ok(client)
    }

    #[cfg(all(
        feature = "protocol-ftp",
        any(target_family = "unix", target_family = "windows")
    ))]
    fn ftp_client(params: crate::core::protocols::GenericProtocolParams, secure: bool) -> FtpFs {
        let mut client = FtpFs::new(params.address, params.port).passive_mode();
        if let Some(username) = params.username {
            client = client.username(username);
        }
        if let Some(password) = params.password {
            client = client.password(password);
        }
        if secure {
            client = client.secure(true, true);
        }
        client
    }

    #[cfg(feature = "protocol-kube")]
    fn kube_client(params: KubeProtocolParams) -> Result<KubeFs> {
        let rt = Arc::new(Self::tokio_runtime()?);
        let kube_fs = KubeFs::new(&rt);
        if let Some(config) = Self::kube_config(params) {
            Ok(kube_fs.config(config))
        } else {
            Ok(kube_fs)
        }
    }

    #[cfg(feature = "protocol-ssh")]
    fn scp_client(
        params: crate::core::protocols::GenericProtocolParams,
    ) -> Result<ScpFs<SshSession<NoCheckServerKey>>> {
        let rt = Arc::new(Self::tokio_runtime()?);
        Ok(ScpFs::russh(Self::ssh_opts(params), rt))
    }

    #[cfg(feature = "protocol-ssh")]
    fn sftp_client(
        params: crate::core::protocols::GenericProtocolParams,
    ) -> Result<SftpFs<SshSession<NoCheckServerKey>>> {
        let rt = Arc::new(Self::tokio_runtime()?);
        Ok(SftpFs::russh(Self::ssh_opts(params), rt))
    }

    #[cfg(feature = "protocol-webdav")]
    fn webdav_client(params: &crate::core::protocols::WebDavProtocolParams) -> WebDAVFs {
        WebDAVFs::new(&params.username, &params.password, &params.uri)
    }

    #[cfg(feature = "protocol-ssh")]
    fn ssh_opts(params: crate::core::protocols::GenericProtocolParams) -> SshOpts {
        let has_password = params
            .password
            .as_ref()
            .is_some_and(|password| !password.is_empty());
        let mut opts = SshOpts::new(params.address).port(params.port);

        if let Some(config_path) = default_ssh_config_path() {
            opts = opts.config_file(
                config_path,
                SshConfigParseRule::ALLOW_UNKNOWN_FIELDS
                    | SshConfigParseRule::ALLOW_UNSUPPORTED_FIELDS,
            );
        }

        if !has_password {
            opts = opts
                .ssh_agent_identity(Some(SshAgentIdentity::All))
                .key_storage(Box::new(DefaultSshKeyStorage::default()));
        }

        if let Some(username) = params.username {
            opts = opts.username(username);
        } else if let Ok(username) = whoami::username() {
            opts = opts.username(username);
        }

        if let Some(password) = params.password
            && !password.is_empty()
        {
            opts = opts.password(password);
        }

        if params.legacy_ssh_host_key_algorithms {
            opts = opts.method(KeyMethod::new(
                MethodType::HostKey,
                Self::legacy_ssh_host_key_algorithms().as_slice(),
            ));
        }

        opts
    }

    #[cfg(feature = "protocol-ssh")]
    fn legacy_ssh_host_key_algorithms() -> Vec<String> {
        [
            "ssh-ed25519-cert-v01@openssh.com",
            "ecdsa-sha2-nistp256-cert-v01@openssh.com",
            "ecdsa-sha2-nistp384-cert-v01@openssh.com",
            "ecdsa-sha2-nistp521-cert-v01@openssh.com",
            "sk-ssh-ed25519-cert-v01@openssh.com",
            "sk-ecdsa-sha2-nistp256-cert-v01@openssh.com",
            "rsa-sha2-512-cert-v01@openssh.com",
            "rsa-sha2-256-cert-v01@openssh.com",
            "ssh-ed25519",
            "ecdsa-sha2-nistp256",
            "ecdsa-sha2-nistp384",
            "ecdsa-sha2-nistp521",
            "sk-ssh-ed25519@openssh.com",
            "sk-ecdsa-sha2-nistp256@openssh.com",
            "rsa-sha2-512",
            "rsa-sha2-256",
            "ssh-rsa",
            "ssh-dss",
        ]
        .into_iter()
        .map(String::from)
        .collect()
    }

    #[cfg(feature = "protocol-ssh")]
    fn should_use_sftp_for_scp(
        _params: &crate::core::protocols::GenericProtocolParams,
        remote_path: &Option<std::path::PathBuf>,
    ) -> bool {
        remote_path
            .as_ref()
            .is_some_and(|path| Self::is_windows_drive_path(path))
    }

    #[cfg(feature = "protocol-ssh")]
    fn is_windows_drive_path(path: &std::path::Path) -> bool {
        let value = path.to_string_lossy();
        let trimmed = value.trim();
        let trimmed = trimmed.strip_prefix('/').unwrap_or(trimmed);
        let bytes = trimmed.as_bytes();

        bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'/' || bytes[2] == b'\\')
    }

    #[cfg(feature = "protocol-kube")]
    fn kube_config(params: KubeProtocolParams) -> Option<KubeConfig> {
        if let Some(cluster_url) = params.cluster_url {
            let mut config = KubeConfig::new(cluster_url.parse().unwrap_or_default());
            config.auth_info.username = params.username;
            config.auth_info.client_certificate = params.client_cert;
            config.auth_info.client_key = params.client_key;
            if let Some(namespace) = params.namespace {
                config.default_namespace = namespace;
            }
            Some(config)
        } else {
            None
        }
    }

    fn tokio_runtime() -> Result<Runtime> {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| anyhow!("Unable to create tokio runtime: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::RemoteFsBuilder;

    #[test]
    fn detects_windows_drive_paths() {
        assert!(RemoteFsBuilder::is_windows_drive_path(Path::new(
            "/C:/Work/demo"
        )));
        assert!(RemoteFsBuilder::is_windows_drive_path(Path::new(
            "C:/Work/demo"
        )));
        assert!(RemoteFsBuilder::is_windows_drive_path(Path::new(
            "D:\\Downloads"
        )));
        assert!(!RemoteFsBuilder::is_windows_drive_path(Path::new(
            "/home/demo"
        )));
        assert!(!RemoteFsBuilder::is_windows_drive_path(Path::new("/")));
    }
}
