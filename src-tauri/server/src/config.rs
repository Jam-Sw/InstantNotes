use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use crate::people::Template;

pub const LISTEN: &str = "INSTANTNOTES_LISTEN";
pub const DATA_DIR: &str = "INSTANTNOTES_DATA_DIR";
pub const PUBLIC_URL: &str = "INSTANTNOTES_PUBLIC_URL";
pub const OIDC_ISSUER: &str = "INSTANTNOTES_OIDC_ISSUER";
pub const OIDC_CLIENT_ID: &str = "INSTANTNOTES_OIDC_CLIENT_ID";
pub const OIDC_CLIENT_SECRET: &str = "INSTANTNOTES_OIDC_CLIENT_SECRET";
pub const UI_DIR: &str = "INSTANTNOTES_UI_DIR";
pub const VAULT_ROOT: &str = "INSTANTNOTES_VAULT_ROOT";
pub const TRUST_PROXY: &str = "INSTANTNOTES_TRUST_PROXY";
pub const MAX_OBJECT_MB: &str = "INSTANTNOTES_MAX_OBJECT_MB";
pub const PEOPLE_DIR: &str = "INSTANTNOTES_PEOPLE_DIR";
pub const SIGN_IN_STYLESHEET: &str = "INSTANTNOTES_SIGN_IN_STYLESHEET";

const DEFAULT_UI_DIR: &str = "/app/ui";
const DEFAULT_MAX_OBJECT_MB: u64 = 64;
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
    pub idle_close: Duration,
    pub session_ttl: Duration,
    pub trust_proxy: bool,
    pub max_object_bytes: u64,
    pub people_dir: Option<Template>,
    pub sign_in_stylesheet: Option<String>,
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

fn optional(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

pub fn data_dir() -> Result<PathBuf, String> {
    required(DATA_DIR).map(PathBuf::from)
}

pub fn people_dir() -> Result<Option<Template>, String> {
    optional(PEOPLE_DIR)
        .map(|raw| Template::parse(&raw).map_err(|e| format!("{PEOPLE_DIR} {e}")))
        .transpose()
}

pub fn stylesheet(raw: &str) -> Result<String, String> {
    let same_origin = raw.starts_with('/') && !raw.starts_with("//");
    let remote = raw.starts_with("https://") || is_local_http(raw);
    let plain = !raw
        .chars()
        .any(|c| c.is_whitespace() || c.is_control() || "\"'<>;,\\`".contains(c));
    if (same_origin || remote) && plain && raw.len() > 1 {
        Ok(raw.to_string())
    } else {
        Err(format!(
            "{SIGN_IN_STYLESHEET} must be an https:// address or a path starting with /: {raw}"
        ))
    }
}

fn check_https(setting: &str, url: &str) -> Result<(), String> {
    if url.starts_with("https://") || is_local_http(url) {
        Ok(())
    } else {
        Err(format!(
            "{setting} must start with https:// (plain http is allowed only for localhost): {url}"
        ))
    }
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let listen = required(LISTEN)?
            .parse()
            .map_err(|e| format!("{LISTEN}: {e}"))?;
        let public_url = required(PUBLIC_URL)?.trim_end_matches('/').to_string();
        check_https(PUBLIC_URL, &public_url)?;
        let oidc_issuer = required(OIDC_ISSUER)?.trim_end_matches('/').to_string();
        check_https(OIDC_ISSUER, &oidc_issuer)?;
        if std::env::var(VAULT_ROOT).is_ok_and(|v| !v.trim().is_empty()) {
            crate::log("config.ignored", &[("setting", VAULT_ROOT)]);
        }
        let sign_in_stylesheet = optional(SIGN_IN_STYLESHEET)
            .map(|raw| stylesheet(&raw))
            .transpose()?;
        Ok(Config {
            listen,
            people_dir: people_dir()?,
            sign_in_stylesheet,
            data_dir: data_dir()?,
            public_url,
            oidc_issuer,
            oidc_client_id: required(OIDC_CLIENT_ID)?,
            oidc_client_secret: required(OIDC_CLIENT_SECRET)?,
            ui_dir: std::env::var(UI_DIR)
                .ok()
                .filter(|v| !v.trim().is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(DEFAULT_UI_DIR)),
            idle_close: IDLE_CLOSE,
            session_ttl: SESSION_TTL,
            trust_proxy: std::env::var(TRUST_PROXY).is_ok_and(|v| v.trim() == "true"),
            max_object_bytes: match std::env::var(MAX_OBJECT_MB) {
                Ok(v) if !v.trim().is_empty() => v
                    .trim()
                    .parse::<u64>()
                    .ok()
                    .filter(|mb| *mb > 0)
                    .ok_or_else(|| {
                        format!("{MAX_OBJECT_MB} must be a whole number of megabytes")
                    })?,
                _ => DEFAULT_MAX_OBJECT_MB,
            } * 1024
                * 1024,
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
    fn the_public_address_and_issuer_must_be_https_unless_on_this_computer() {
        for ok in [
            "https://notes.example.org",
            "http://localhost:8080",
            "http://127.0.0.1",
            "http://[::1]:8080/",
        ] {
            assert!(check_https(PUBLIC_URL, ok).is_ok(), "{ok}");
        }
        for refused in [
            "http://notes.example.org",
            "http://192.168.1.4:8080",
            "http://localhost.example.org",
            "ftp://localhost",
        ] {
            let error = check_https(OIDC_ISSUER, refused).unwrap_err();
            assert!(error.starts_with(OIDC_ISSUER), "{refused}");
        }
    }

    #[test]
    fn a_sign_in_stylesheet_is_an_https_address_or_a_same_origin_path() {
        for ok in [
            "https://cdn.example.org/theme.css",
            "/theme/sign-in.css",
            "http://localhost:9000/t.css",
        ] {
            assert_eq!(stylesheet(ok).as_deref(), Ok(ok));
        }
        for refused in [
            "http://cdn.example.org/t.css",
            "//cdn.example.org/t.css",
            "theme.css",
            "/",
            "/a b.css",
            "/a\".css",
            "https://x.org/a.css;script-src *",
            "javascript:alert(1)",
        ] {
            assert!(stylesheet(refused).is_err(), "{refused}");
        }
    }
}
