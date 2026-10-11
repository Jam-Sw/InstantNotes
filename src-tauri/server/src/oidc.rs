use crate::sessions::{Logins, Person};
use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::sync::OnceCell;

#[derive(Clone, Debug, Deserialize)]
pub struct Discovery {
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub end_session_endpoint: Option<String>,
}

pub struct Oidc {
    issuer: String,
    client_id: String,
    client_secret: String,
    redirect_uri: String,
    public_url: String,
    http: reqwest::Client,
    discovery: OnceCell<Discovery>,
}

#[derive(Deserialize)]
struct TokenResponse {
    id_token: String,
}

#[derive(Deserialize)]
struct Claims {
    iss: String,
    #[serde(default)]
    aud: Audience,
    exp: i64,
    sub: String,
    nonce: Option<String>,
    name: Option<String>,
    email: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(untagged)]
enum Audience {
    One(String),
    Many(Vec<String>),
    #[default]
    None,
}

impl Audience {
    fn contains(&self, id: &str) -> bool {
        match self {
            Audience::One(a) => a == id,
            Audience::Many(all) => all.iter().any(|a| a == id),
            Audience::None => false,
        }
    }
}

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for b in value.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn same_issuer(a: &str, b: &str) -> bool {
    a.trim_end_matches('/') == b.trim_end_matches('/')
}

pub fn parse_claims(id_token: &str) -> Result<serde_json::Value, String> {
    let payload = id_token
        .split('.')
        .nth(1)
        .ok_or_else(|| "id_token is not a JWT".to_string())?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| "id_token payload is not base64url".to_string())?;
    serde_json::from_slice(&bytes).map_err(|_| "id_token payload is not JSON".to_string())
}

impl Oidc {
    pub fn new(
        issuer: &str,
        client_id: &str,
        client_secret: &str,
        public_url: &str,
        redirect_uri: &str,
    ) -> Self {
        Oidc {
            issuer: issuer.to_string(),
            client_id: client_id.to_string(),
            client_secret: client_secret.to_string(),
            redirect_uri: redirect_uri.to_string(),
            public_url: public_url.to_string(),
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("http client"),
            discovery: OnceCell::new(),
        }
    }

    async fn discover(&self) -> Result<&Discovery, String> {
        self.discovery
            .get_or_try_init(|| async {
                let url = format!("{}/.well-known/openid-configuration", self.issuer);
                let found: Discovery = self
                    .http
                    .get(&url)
                    .send()
                    .await
                    .map_err(|e| format!("sign-in server unreachable: {e}"))?
                    .error_for_status()
                    .map_err(|e| format!("sign-in server discovery failed: {e}"))?
                    .json()
                    .await
                    .map_err(|e| format!("sign-in server discovery unreadable: {e}"))?;
                Ok(found)
            })
            .await
    }

    pub async fn begin(&self, logins: &Logins) -> Result<String, String> {
        let discovery = self.discover().await?;
        let (state, verifier, nonce) = logins.begin();
        let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
        Ok(format!(
            "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&nonce={}&code_challenge={}&code_challenge_method=S256",
            discovery.authorization_endpoint,
            encode(&self.client_id),
            encode(&self.redirect_uri),
            encode("openid profile email"),
            encode(&state),
            encode(&nonce),
            encode(&challenge),
        ))
    }

    pub async fn finish(&self, logins: &Logins, code: &str, state: &str) -> Result<Person, String> {
        let pending = logins
            .take(state)
            .ok_or_else(|| "sign-in expired or unknown; start again".to_string())?;
        let discovery = self.discover().await?;
        let response = self
            .http
            .post(&discovery.token_endpoint)
            .form(&[
                ("grant_type", "authorization_code"),
                ("code", code),
                ("redirect_uri", &self.redirect_uri),
                ("client_id", &self.client_id),
                ("client_secret", &self.client_secret),
                ("code_verifier", &pending.verifier),
            ])
            .send()
            .await
            .map_err(|e| format!("token request failed: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("token request refused: {}", response.status()));
        }
        let token: TokenResponse = response
            .json()
            .await
            .map_err(|_| "token response unreadable".to_string())?;
        let claims: Claims = serde_json::from_value(parse_claims(&token.id_token)?)
            .map_err(|_| "id_token is missing required claims".to_string())?;
        if !same_issuer(&claims.iss, &self.issuer) {
            return Err("id_token issuer mismatch".to_string());
        }
        if !claims.aud.contains(&self.client_id) {
            return Err("id_token audience mismatch".to_string());
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        if claims.exp <= now {
            return Err("id_token expired".to_string());
        }
        if claims.nonce.as_deref() != Some(pending.nonce.as_str()) {
            return Err("id_token nonce mismatch".to_string());
        }
        if claims.sub.trim().is_empty() {
            return Err("id_token has no subject".to_string());
        }
        Ok(Person {
            sub: claims.sub,
            name: claims.name,
            email: claims.email,
        })
    }

    pub async fn logout_url(&self) -> String {
        match self
            .discover()
            .await
            .ok()
            .and_then(|d| d.end_session_endpoint.clone())
        {
            Some(end) => format!(
                "{end}?client_id={}&post_logout_redirect_uri={}",
                encode(&self.client_id),
                encode(&self.public_url)
            ),
            None => "/".to_string(),
        }
    }
}
