use std::path::{Path, PathBuf};

#[cfg(feature = "protocol-ssh")]
use remotefs_ssh::SshKeyStorage;

const DEFAULT_PRIVATE_KEY_FILES: &[&str] = &[
    "id_ed25519",
    "id_ecdsa",
    "id_ecdsa_sk",
    "id_rsa",
    "id_dsa",
    "identity",
];

pub fn default_ssh_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".ssh"))
}

pub fn default_ssh_config_path() -> Option<PathBuf> {
    ssh_config_path(default_ssh_dir()?.as_path())
}

fn ssh_config_path(ssh_dir: &Path) -> Option<PathBuf> {
    let config_path = ssh_dir.join("config");
    config_path.is_file().then_some(config_path)
}

fn resolve_default_private_key(ssh_dir: &Path) -> Option<PathBuf> {
    DEFAULT_PRIVATE_KEY_FILES
        .iter()
        .map(|name| ssh_dir.join(name))
        .find(|path| path.is_file())
}

#[derive(Debug, Clone)]
pub struct DefaultSshKeyStorage {
    ssh_dir: Option<PathBuf>,
}

impl Default for DefaultSshKeyStorage {
    fn default() -> Self {
        Self {
            ssh_dir: default_ssh_dir(),
        }
    }
}

impl DefaultSshKeyStorage {
    #[cfg(test)]
    fn from_ssh_dir(ssh_dir: PathBuf) -> Self {
        Self {
            ssh_dir: Some(ssh_dir),
        }
    }

    fn resolve_key_path(&self) -> Option<PathBuf> {
        resolve_default_private_key(self.ssh_dir.as_deref()?)
    }
}

#[cfg(feature = "protocol-ssh")]
impl SshKeyStorage for DefaultSshKeyStorage {
    fn resolve(&self, _host: &str, _username: &str) -> Option<PathBuf> {
        self.resolve_key_path()
    }
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::{DefaultSshKeyStorage, resolve_default_private_key, ssh_config_path};

    #[test]
    fn finds_ssh_config_when_present() {
        let temp_dir = tempdir().expect("temp dir");
        let config_path = temp_dir.path().join("config");
        std::fs::write(&config_path, "Host test\n  User demo\n").expect("config file");

        assert_eq!(ssh_config_path(temp_dir.path()), Some(config_path));
    }

    #[test]
    fn prefers_modern_default_private_keys() {
        let temp_dir = tempdir().expect("temp dir");
        let rsa_path = temp_dir.path().join("id_rsa");
        let ed25519_path = temp_dir.path().join("id_ed25519");
        std::fs::write(&rsa_path, "rsa").expect("rsa");
        std::fs::write(&ed25519_path, "ed25519").expect("ed25519");

        assert_eq!(
            resolve_default_private_key(temp_dir.path()),
            Some(ed25519_path)
        );
    }

    #[test]
    fn storage_resolves_first_available_default_key() {
        let temp_dir = tempdir().expect("temp dir");
        let rsa_path = temp_dir.path().join("id_rsa");
        std::fs::write(&rsa_path, "rsa").expect("rsa");

        let storage = DefaultSshKeyStorage::from_ssh_dir(temp_dir.path().to_path_buf());
        assert_eq!(storage.resolve_key_path(), Some(rsa_path));
    }
}
