use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

pub const LISTEN: &str = "INSTANTNOTES_LISTEN";
pub const DATA_DIR: &str = "INSTANTNOTES_DATA_DIR";
pub const PUBLIC_URL: &str = "INSTANTNOTES_PUBLIC_URL";
pub const OIDC_ISSUER: &str = "INSTANTNOTES_OIDC_ISSUER";
pub const OIDC_CLIENT_ID: &str = "INSTANTNOTES_OIDC_CLIENT_ID";
pub const OIDC_CLIENT_SECRET: &str = "INSTANTNOTES_OIDC_CLIENT_SECRET";
pub const UI_DIR: &str = "INSTANTNOTES_UI_DIR";
pub const VAULT_ROOT: &str = "INSTANTNOTES_VAULT_ROOT";
pub const TRUST_PROXY: &str = "INSTANTNOTES_TRUST_PROXY";

const DEFAULT_UI_DIR: &str = "/app/ui";
const IDLE_CLOSE: Duration = Duration::from_secs(10 * 60);
const SESSION_TTL: Duration = Duration::from_secs(14 * 24 * 60 * 60);

#[derive(Clone, Debug)]
pub struct Config {
    pub listen: SocketAddr,
    pub data_dir: PathBuf,
    pub public_url: String,
    pub oidc_issuer: String,
    pub oidc_client_id: String,
    pub oidc_client_secret: String,
    pub ui_dir: PathBuf,
    pub vault_root: Option<PathBuf>,
    pub idle_close: Duration,
    pub session_ttl: Duration,
    pub trust_proxy: bool,
}

fn required(name: &str) -> Result<String, String> {
    match std::env::var(name) {
        Ok(v) if !v.trim().is_empty() => Ok(v.trim().to_string()),
        _ => Err(format!("{name} is not set")),
    }
}

pub fn is_local_http(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("http://") else {
        return false;
    };
    let authority = rest.split('/').next().unwrap_or_default();
    let host = match authority.strip_prefix('[') {
        Some(v6) => v6.split(']').next().unwrap_or_default(),
        None => authority.split(':').next().unwrap_or_default(),
    };
    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

fn check_public_url(url: &str) -> Result<(), String> {
    if url.starts_with("https://") || is_local_http(url) {
        Ok(())
    } else {
        Err(format!(
            "{PUBLIC_URL} must start with https:// (plain http is allowed only for localhost): {url}"
        ))
    }
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let listen = required(LISTEN)?
            .parse()
            .map_err(|e| format!("{LISTEN}: {e}"))?;
        let public_url = required(PUBLIC_URL)?.trim_end_matches('/').to_string();
        check_public_url(&public_url)?;
        let oidc_issuer = required(OIDC_ISSUER)?.trim_end_matches('/').to_string();
        let vault_root = std::env::var(VAULT_ROOT)
            .ok()
            .filter(|v| !v.trim().is_empty())
            .map(|v| PathBuf::from(v.trim()));
        if vault_root.as_ref().is_some_and(|root| !root.is_absolute()) {
            return Err(format!("{VAULT_ROOT} must be an absolute path"));
        }
        Ok(Config {
            listen,
            data_dir: PathBuf::from(required(DATA_DIR)?),
            public_url,
            oidc_issuer,
            oidc_client_id: required(OIDC_CLIENT_ID)?,
            oidc_client_secret: required(OIDC_CLIENT_SECRET)?,
            ui_dir: std::env::var(UI_DIR)
                .ok()
                .filter(|v| !v.trim().is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(DEFAULT_UI_DIR)),
            vault_root,
            idle_close: IDLE_CLOSE,
            session_ttl: SESSION_TTL,
            trust_proxy: std::env::var(TRUST_PROXY).is_ok_and(|v| v.trim() == "true"),
        })
    }

    pub fn secure_cookies(&self) -> bool {
        self.public_url.starts_with("https://")
    }

    pub fn redirect_uri(&self) -> String {
        format!("{}/auth/callback", self.public_url)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_public_address_must_be_https_unless_it_is_this_computer() {
        for ok in [
            "https://notes.example.org",
            "http://localhost:8080",
            "http://127.0.0.1",
            "http://[::1]:8080/",
        ] {
            assert!(check_public_url(ok).is_ok(), "{ok}");
        }
        for refused in [
            "http://notes.example.org",
            "http://192.168.1.4:8080",
            "http://localhost.example.org",
            "ftp://localhost",
        ] {
            assert!(check_public_url(refused).is_err(), "{refused}");
        }
    }
}
