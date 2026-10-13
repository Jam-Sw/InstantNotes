use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteChange {
    pub name: String,
    pub sha: Option<String>,
    pub seq: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteChanges {
    pub library_id: String,
    pub epoch: i64,
    pub head: i64,
    pub changes: Vec<RemoteChange>,
    pub more: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteKeys {
    pub mode: Option<String>,
    pub recipient: Option<String>,
    pub epoch: i64,
    pub head: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RemoteOp {
    pub name: String,
    pub base: Option<String>,
    pub sha: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoteError {
    Unreachable(String),
    SignedOut,
    Gone,
    Conflict(Vec<String>),
    WrongEpoch,
    Refused(String),
}

impl std::fmt::Display for RemoteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RemoteError::Unreachable(why) => write!(f, "server unreachable: {why}"),
            RemoteError::SignedOut => write!(f, "signed out"),
            RemoteError::Gone => write!(f, "the server's library was reset"),
            RemoteError::Conflict(names) => {
                write!(f, "{} objects changed on the server meanwhile", names.len())
            }
            RemoteError::WrongEpoch => write!(f, "the library changed form on the server"),
            RemoteError::Refused(why) => write!(f, "server refused: {why}"),
        }
    }
}

pub trait Remote {
    fn changes(&mut self, since: i64) -> Result<RemoteChanges, RemoteError>;
    fn missing(&mut self, shas: &[String]) -> Result<Vec<String>, RemoteError>;
    fn upload(&mut self, sha: &str, bytes: &[u8]) -> Result<(), RemoteError>;
    fn download(&mut self, sha: &str) -> Result<Vec<u8>, RemoteError>;
    fn commit(&mut self, epoch: i64, ops: &[RemoteOp]) -> Result<i64, RemoteError>;
    fn keys(&mut self) -> Result<RemoteKeys, RemoteError>;
    fn set_keys(&mut self, mode: &str, recipient: Option<&str>) -> Result<(), RemoteError>;
    fn switch(
        &mut self,
        from_epoch: i64,
        built_at: i64,
        mode: &str,
        recipient: Option<&str>,
    ) -> Result<i64, RemoteError>;
}
