use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rterm::core::connections::{self, ConnectionTestResult};
use rterm::core::host::{HostBridge, RemoteHost};
use rterm::core::protocols::FileTransferParams;
use serde::Serialize;

type SharedRemoteSession = Arc<Mutex<CachedRemoteSession>>;
const REMOTE_SESSION_IDLE_TTL_MS: u64 = 15 * 60 * 1000;

struct CachedRemoteSession {
    host: RemoteHost,
    params: FileTransferParams,
    created_at: u64,
    last_used_at: u64,
    last_error: Option<String>,
}

impl CachedRemoteSession {
    fn connect(remote: &str) -> Result<Self, String> {
        let params = connections::parse_remote_spec(remote)?;
        let mut host = RemoteHost::from_params(&params).map_err(|error| error.to_string())?;
        host.connect().map_err(|error| error.to_string())?;
        let now = now_millis();
        Ok(Self {
            host,
            params,
            created_at: now,
            last_used_at: now,
            last_error: None,
        })
    }

    fn ensure_connected(&mut self) -> Result<(), String> {
        if self.host.is_connected() {
            return Ok(());
        }

        self.host.connect().map_err(|error| error.to_string())
    }

    fn disconnect(&mut self) {
        let _ = self.host.disconnect();
    }

    fn state(&mut self, key: &str) -> RemoteSessionState {
        RemoteSessionState {
            key: key.to_string(),
            protocol: self.params.protocol.to_string(),
            endpoint: self.params.params.endpoint_label(),
            remote_path: self
                .params
                .remote_path
                .as_ref()
                .map(|path| path.display().to_string()),
            connected: self.host.is_connected(),
            created_at: self.created_at,
            last_used_at: self.last_used_at,
            last_error: self.last_error.clone(),
        }
    }
}

#[derive(Clone, Default)]
pub struct RemoteSessionRegistry {
    sessions: Arc<Mutex<HashMap<String, SharedRemoteSession>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSessionState {
    pub key: String,
    pub protocol: String,
    pub endpoint: String,
    pub remote_path: Option<String>,
    pub connected: bool,
    pub created_at: u64,
    pub last_used_at: u64,
    pub last_error: Option<String>,
}

impl RemoteSessionRegistry {
    pub fn with_remote_host<T>(
        &self,
        remote: &str,
        run: impl FnOnce(&mut RemoteHost, &FileTransferParams) -> Result<T, String>,
    ) -> Result<T, String> {
        let key = remote.to_string();
        let session = self.get_or_create_session(&key)?;
        let (result, should_invalidate) = {
            let mut guard = session
                .lock()
                .map_err(|_| String::from("远端会话已损坏，请重试"))?;

            if let Err(error) = guard.ensure_connected() {
                guard.last_error = Some(error.clone());
                guard.disconnect();
                drop(guard);
                self.invalidate(&key);
                return Err(error);
            }

            let params = guard.params.clone();
            guard.last_used_at = now_millis();
            let result = run(&mut guard.host, &params);
            match result.as_ref() {
                Ok(_) => {
                    guard.last_error = None;
                    guard.last_used_at = now_millis();
                }
                Err(error) => {
                    guard.last_error = Some(error.clone());
                }
            }
            let disconnected = !guard.host.is_connected();
            let should_invalidate = disconnected
                || result
                    .as_ref()
                    .err()
                    .is_some_and(|error| Self::is_connection_error(error));
            (result, should_invalidate)
        };

        if should_invalidate {
            self.invalidate(&key);
        }

        result
    }

    pub fn test_connection(&self, remote: &str) -> Result<ConnectionTestResult, String> {
        self.with_remote_host(remote, |host, params| {
            let endpoint = params.params.endpoint_label();
            let remote_path = params
                .remote_path
                .as_ref()
                .map(|path| path.display().to_string());
            let working_directory = if let Some(path) = params.remote_path.as_ref() {
                host.change_wrkdir(path.as_path())
                    .map_err(|error| error.to_string())?
            } else {
                host.pwd().map_err(|error| error.to_string())?
            };

            Ok(ConnectionTestResult {
                protocol: params.protocol.to_string(),
                endpoint,
                connected: true,
                working_directory: working_directory.display().to_string(),
                remote_path,
            })
        })
    }

    pub fn list_states(&self) -> Vec<RemoteSessionState> {
        self.prune_idle_sessions();

        let sessions = match self.sessions.lock() {
            Ok(sessions) => sessions.clone(),
            Err(_) => return Vec::new(),
        };

        let mut states: Vec<RemoteSessionState> = sessions
            .into_iter()
            .filter_map(|(key, session)| {
                session
                    .lock()
                    .ok()
                    .map(|mut guard| guard.state(key.as_str()))
            })
            .collect();
        states.sort_by_key(|state| std::cmp::Reverse(state.last_used_at));
        states
    }

    pub fn disconnect_session(&self, remote: &str) {
        self.invalidate(remote);
    }

    fn get_or_create_session(&self, key: &str) -> Result<SharedRemoteSession, String> {
        self.prune_idle_sessions();

        if let Some(session) = self
            .sessions
            .lock()
            .map_err(|_| String::from("远端会话缓存不可用，请重试"))?
            .get(key)
            .cloned()
        {
            return Ok(session);
        }

        let created = Arc::new(Mutex::new(CachedRemoteSession::connect(key)?));
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| String::from("远端会话缓存不可用，请重试"))?;

        Ok(sessions
            .entry(key.to_string())
            .or_insert_with(|| created.clone())
            .clone())
    }

    fn invalidate(&self, key: &str) {
        let removed = self
            .sessions
            .lock()
            .ok()
            .and_then(|mut sessions| sessions.remove(key));
        if let Some(session) = removed
            && let Ok(mut guard) = session.lock()
        {
            guard.disconnect();
        }
    }

    fn prune_idle_sessions(&self) {
        let now = now_millis();
        let stale_keys: Vec<String> = match self.sessions.lock() {
            Ok(sessions) => sessions
                .iter()
                .filter_map(|(key, session)| {
                    session.lock().ok().and_then(|guard| {
                        (now.saturating_sub(guard.last_used_at) > REMOTE_SESSION_IDLE_TTL_MS)
                            .then(|| key.clone())
                    })
                })
                .collect(),
            Err(_) => Vec::new(),
        };

        for key in stale_keys {
            self.invalidate(key.as_str());
        }
    }

    fn is_connection_error(error: &str) -> bool {
        let normalized = error.to_ascii_lowercase();
        [
            "connection",
            "disconnect",
            "broken pipe",
            "timed out",
            "timeout",
            "reset by peer",
            "ssh",
            "transport",
            "eof",
        ]
        .iter()
        .any(|needle| normalized.contains(needle))
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}
