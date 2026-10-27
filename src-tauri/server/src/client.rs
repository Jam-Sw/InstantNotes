use crate::config::is_local_http;
use instantnotes_core::sync::frames;
use instantnotes_core::sync::remote::{Remote, RemoteChanges, RemoteError, RemoteKeys, RemoteOp};
use reqwest::{Method, RequestBuilder, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

const TRIES: usize = 4;
const MAX_WAIT: u64 = 60;
const BATCH_BYTES: usize = 16 * 1024 * 1024;
const MISSING_BATCH: usize = 1000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub app: String,
    pub api: u32,
    pub version: String,
    pub max_object_bytes: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Person {
    pub name: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Issued {
    pub token: String,
    pub device_id: String,
    pub person: Person,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pairing {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    pub browser: bool,
    pub signed_in_at: i64,
    pub last_seen: i64,
    pub current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Join {
    pub id: String,
    pub public_key: String,
    pub device_name: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum JoinAnswer {
    Pending,
    Approved { key: String },
    Denied,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LegacyNote {
    pub md: String,
    pub surface: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Legacy {
    pub notes: Vec<LegacyNote>,
    pub manifest: String,
    pub attachments: Vec<String>,
}

pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
    pub state: String,
}

pub fn pkce() -> Pkce {
    use base64::Engine;
    use sha2::Digest;
    let verifier = crate::sessions::random_token();
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(sha2::Sha256::digest(verifier.as_bytes()));
    Pkce {
        verifier,
        challenge,
        state: crate::sessions::random_token(),
    }
}

pub fn callback_query(
    request_line: &str,
) -> Option<(Option<String>, Option<String>, Option<String>)> {
    let target = request_line.strip_prefix("GET ")?.split(' ').next()?;
    let query = target.strip_prefix("/callback?")?;
    let mut code = None;
    let mut state = None;
    let mut error = None;
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=')?;
        let value = percent_decode(value)?;
        match key {
            "code" => code = Some(value),
            "state" => state = Some(value),
            "error" => error = Some(value),
            _ => {}
        }
    }
    Some((code, state, error))
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

pub fn normalize_address(input: &str) -> Result<String, String> {
    let trimmed = input.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Type your server's address.".into());
    }
    let address = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    if address.starts_with("https://") || is_local_http(&address) {
        Ok(address)
    } else {
        Err(
            "The address must start with https:// (plain http only works for this computer)."
                .into(),
        )
    }
}

#[derive(Clone)]
pub struct Client {
    base: String,
    token: Option<String>,
    http: reqwest::Client,
}

async fn refusal(response: Response) -> RemoteError {
    let status = response.status().as_u16();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    RemoteError::from_answer(status, &body)
}

impl Client {
    pub fn new(address: &str) -> Result<Client, String> {
        Ok(Client {
            base: normalize_address(address)?,
            token: None,
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(60))
                .build()
                .map_err(|e| e.to_string())?,
        })
    }

    pub fn with_token(mut self, token: &str) -> Client {
        self.token = Some(token.to_string());
        self
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    fn url(&self, path: &str) -> String {
        format!("{}/sync/v1/{path}", self.base)
    }

    fn request(&self, method: Method, path: &str) -> RequestBuilder {
        let builder = self.http.request(method, self.url(path));
        match &self.token {
            Some(token) => builder.bearer_auth(token),
            None => builder,
        }
    }

    async fn send(&self, make: impl Fn() -> RequestBuilder) -> Result<Response, RemoteError> {
        for attempt in 1..=TRIES {
            let response = make()
                .send()
                .await
                .map_err(|e| RemoteError::Unreachable(e.to_string()))?;
            if response.status() != StatusCode::TOO_MANY_REQUESTS || attempt == TRIES {
                if response.status().is_success() {
                    return Ok(response);
                }
                return Err(refusal(response).await);
            }
            let wait = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(1)
                .clamp(1, MAX_WAIT);
            tokio::time::sleep(Duration::from_secs(wait)).await;
        }
        Err(RemoteError::Unreachable(
            "the server kept asking to slow down".into(),
        ))
    }

    async fn json<T: DeserializeOwned>(
        &self,
        make: impl Fn() -> RequestBuilder,
    ) -> Result<T, RemoteError> {
        self.send(make)
            .await?
            .json()
            .await
            .map_err(|e| RemoteError::Refused(format!("unreadable answer: {e}")))
    }

    pub async fn info(&self) -> Result<Info, RemoteError> {
        let info: Info = self.json(|| self.request(Method::GET, "info")).await?;
        if info.app != "instantnotes" || info.api != crate::sync_api::API {
            return Err(RemoteError::Refused(
                "this address does not answer as an InstantNotes server".into(),
            ));
        }
        Ok(info)
    }

    pub fn authorize_url(
        &self,
        redirect_uri: &str,
        state: &str,
        challenge: &str,
        device_name: &str,
    ) -> String {
        use crate::oidc::encode;
        format!(
            "{}?redirect_uri={}&state={}&code_challenge={}&code_challenge_method=S256&device_name={}",
            self.url("device/authorize"),
            encode(redirect_uri),
            encode(state),
            encode(challenge),
            encode(device_name)
        )
    }

    pub async fn start_pairing(
        &self,
        challenge: &str,
        device_name: &str,
    ) -> Result<Pairing, RemoteError> {
        let body = json!({ "codeChallenge": challenge, "deviceName": device_name });
        self.json(|| self.request(Method::POST, "device/code").json(&body))
            .await
    }

    pub async fn poll_pairing(
        &self,
        device_code: &str,
        verifier: &str,
    ) -> Result<Option<Issued>, RemoteError> {
        let body = json!({ "deviceCode": device_code, "codeVerifier": verifier });
        let answer: Value = self
            .json(|| self.request(Method::POST, "device/poll").json(&body))
            .await?;
        if answer.get("token").is_none() {
            return Ok(None);
        }
        serde_json::from_value(answer)
            .map(Some)
            .map_err(|e| RemoteError::Refused(format!("unreadable answer: {e}")))
    }

    pub async fn exchange(
        &self,
        code: &str,
        verifier: &str,
        redirect_uri: &str,
    ) -> Result<Issued, RemoteError> {
        let body = json!({ "code": code, "codeVerifier": verifier, "redirectUri": redirect_uri });
        self.json(|| self.request(Method::POST, "device/token").json(&body))
            .await
    }

    pub async fn changes(&self, since: i64, wait: u64) -> Result<RemoteChanges, RemoteError> {
        let path = format!("changes?since={since}&wait={wait}");
        self.json(|| self.request(Method::GET, &path)).await
    }

    pub async fn missing(&self, shas: &[String]) -> Result<Vec<String>, RemoteError> {
        let mut out = Vec::new();
        for batch in shas.chunks(MISSING_BATCH) {
            let body = json!({ "shas": batch });
            let answer: Value = self
                .json(|| self.request(Method::POST, "blobs/missing").json(&body))
                .await?;
            out.extend(
                answer["missing"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|v| v.as_str().map(str::to_string)),
            );
        }
        Ok(out)
    }

    pub async fn upload(&self, blobs: &[(String, Vec<u8>)]) -> Result<(), RemoteError> {
        let mut batch: Vec<&(String, Vec<u8>)> = Vec::new();
        let mut size = 0;
        for blob in blobs {
            if blob.1.len() > BATCH_BYTES {
                let path = format!("blobs/{}", blob.0);
                self.send(|| self.request(Method::PUT, &path).body(blob.1.clone()))
                    .await?;
                continue;
            }
            if size + blob.1.len() > BATCH_BYTES && !batch.is_empty() {
                self.upload_frames(&batch).await?;
                batch.clear();
                size = 0;
            }
            size += blob.1.len();
            batch.push(blob);
        }
        if !batch.is_empty() {
            self.upload_frames(&batch).await?;
        }
        Ok(())
    }

    async fn upload_frames(&self, batch: &[&(String, Vec<u8>)]) -> Result<(), RemoteError> {
        let body = frames::encode(batch.iter().map(|(s, b)| (s.as_str(), b.as_slice())))
            .ok_or_else(|| RemoteError::Refused("a blob name is not a hash".into()))?;
        self.send(|| self.request(Method::POST, "blobs/batch").body(body.clone()))
            .await?;
        Ok(())
    }

    pub async fn download(&self, shas: &[String]) -> Result<Vec<(String, Vec<u8>)>, RemoteError> {
        let mut out = Vec::new();
        let mut left: Vec<String> = shas.to_vec();
        while !left.is_empty() {
            let body = json!({ "shas": left });
            let bytes = self
                .send(|| self.request(Method::POST, "blobs/fetch").json(&body))
                .await?
                .bytes()
                .await
                .map_err(|e| RemoteError::Unreachable(e.to_string()))?;
            let got: Vec<(String, Vec<u8>)> = frames::decode(&bytes)
                .ok_or_else(|| RemoteError::Refused("the server sent a damaged batch".into()))?
                .into_iter()
                .filter(|(sha, _)| left.contains(sha))
                .collect();
            if got.is_empty() {
                break;
            }
            left.retain(|sha| !got.iter().any(|(g, _)| g == sha));
            out.extend(got);
        }
        Ok(out)
    }

    pub async fn commit(
        &self,
        epoch: i64,
        ops: &[RemoteOp],
        reset: bool,
    ) -> Result<i64, RemoteError> {
        let body = json!({ "epoch": epoch, "ops": ops, "reset": reset });
        let answer: Value = self
            .json(|| self.request(Method::POST, "commit").json(&body))
            .await?;
        Ok(answer["head"].as_i64().unwrap_or_default())
    }

    pub async fn keys(&self) -> Result<RemoteKeys, RemoteError> {
        self.json(|| self.request(Method::GET, "keys")).await
    }

    pub async fn set_keys(&self, mode: &str, recipient: Option<&str>) -> Result<(), RemoteError> {
        let body = json!({ "mode": mode, "recipient": recipient });
        self.send(|| self.request(Method::PUT, "keys").json(&body))
            .await?;
        Ok(())
    }

    pub async fn switch(
        &self,
        from_epoch: i64,
        built_at: i64,
        mode: &str,
        recipient: Option<&str>,
        expected: usize,
    ) -> Result<i64, RemoteError> {
        let body = json!({
            "fromEpoch": from_epoch,
            "builtAt": built_at,
            "mode": mode,
            "recipient": recipient,
            "expected": expected,
        });
        let answer: Value = self
            .json(|| self.request(Method::POST, "switch").json(&body))
            .await?;
        Ok(answer["epoch"].as_i64().unwrap_or_default())
    }

    pub async fn request_join(
        &self,
        public_key: &str,
        device_name: &str,
    ) -> Result<String, RemoteError> {
        let body = json!({ "publicKey": public_key, "deviceName": device_name });
        let answer: Value = self
            .json(|| self.request(Method::POST, "keys/requests").json(&body))
            .await?;
        answer["id"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| RemoteError::Refused("no request id".into()))
    }

    pub async fn join_answer(&self, id: &str, wait: u64) -> Result<JoinAnswer, RemoteError> {
        let path = format!("keys/requests/{id}?wait={wait}");
        self.json(|| self.request(Method::GET, &path)).await
    }

    pub async fn pending_joins(&self, wait: u64) -> Result<Vec<Join>, RemoteError> {
        let path = format!("keys/requests?wait={wait}");
        self.json(|| self.request(Method::GET, &path)).await
    }

    pub async fn answer_join(&self, id: &str, key: Option<&str>) -> Result<(), RemoteError> {
        let path = match key {
            Some(_) => format!("keys/requests/{id}/approve"),
            None => format!("keys/requests/{id}/deny"),
        };
        let body = json!({ "key": key });
        self.send(|| self.request(Method::POST, &path).json(&body))
            .await?;
        Ok(())
    }

    pub async fn devices(&self) -> Result<Vec<Device>, RemoteError> {
        self.json(|| self.request(Method::GET, "devices")).await
    }

    pub async fn legacy(&self) -> Result<Option<Legacy>, RemoteError> {
        match self.json(|| self.request(Method::GET, "legacy")).await {
            Ok(found) => Ok(Some(found)),
            Err(RemoteError::Refused(why)) if why.contains("404") => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub async fn legacy_attachment(&self, name: &str) -> Result<Vec<u8>, RemoteError> {
        let path = format!("legacy/attachments/{name}");
        let response = self.send(|| self.request(Method::GET, &path)).await?;
        Ok(response
            .bytes()
            .await
            .map_err(|e| RemoteError::Unreachable(e.to_string()))?
            .to_vec())
    }

    pub async fn drop_legacy(&self) -> Result<(), RemoteError> {
        self.send(|| self.request(Method::DELETE, "legacy")).await?;
        Ok(())
    }

    pub async fn revoke(&self, id: Option<&str>) -> Result<(), RemoteError> {
        let path = match id {
            Some(id) => format!("devices/{id}"),
            None => "devices".to_string(),
        };
        self.send(|| self.request(Method::DELETE, &path)).await?;
        Ok(())
    }
}

pub struct Connection {
    pub client: Client,
    max_object_bytes: u64,
}

impl Connection {
    pub fn new(client: Client, max_object_bytes: u64) -> Connection {
        Connection {
            client,
            max_object_bytes,
        }
    }
}

impl Remote for Connection {
    async fn changes(&mut self, since: i64) -> Result<RemoteChanges, RemoteError> {
        self.client.changes(since, 0).await
    }

    fn max_object_bytes(&self) -> u64 {
        self.max_object_bytes
    }

    async fn missing(&mut self, shas: &[String]) -> Result<Vec<String>, RemoteError> {
        self.client.missing(shas).await
    }

    async fn upload(&mut self, blobs: &[(String, Vec<u8>)]) -> Result<(), RemoteError> {
        self.client.upload(blobs).await
    }

    async fn download(&mut self, shas: &[String]) -> Result<Vec<(String, Vec<u8>)>, RemoteError> {
        self.client.download(shas).await
    }

    async fn commit(
        &mut self,
        epoch: i64,
        ops: &[RemoteOp],
        reset: bool,
    ) -> Result<i64, RemoteError> {
        self.client.commit(epoch, ops, reset).await
    }

    async fn keys(&mut self) -> Result<RemoteKeys, RemoteError> {
        self.client.keys().await
    }

    async fn set_keys(&mut self, mode: &str, recipient: Option<&str>) -> Result<(), RemoteError> {
        self.client.set_keys(mode, recipient).await
    }

    async fn switch(
        &mut self,
        from_epoch: i64,
        built_at: i64,
        mode: &str,
        recipient: Option<&str>,
        expected: usize,
    ) -> Result<i64, RemoteError> {
        self.client
            .switch(from_epoch, built_at, mode, recipient, expected)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_values_are_fresh_and_the_challenge_matches_the_verifier() {
        use base64::Engine;
        use sha2::Digest;
        let a = pkce();
        let b = pkce();
        assert_ne!(a.verifier, b.verifier);
        assert_ne!(a.state, b.state);
        assert!(a.verifier.len() >= 43);
        let expected = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(sha2::Sha256::digest(a.verifier.as_bytes()));
        assert_eq!(a.challenge, expected);
    }

    #[test]
    fn the_loopback_callback_is_read_from_the_request_line() {
        assert_eq!(
            callback_query("GET /callback?code=c%2Fd&state=s1 HTTP/1.1"),
            Some((Some("c/d".into()), Some("s1".into()), None))
        );
        assert_eq!(
            callback_query("GET /callback?error=access_denied&state=s1 HTTP/1.1"),
            Some((None, Some("s1".into()), Some("access_denied".into())))
        );
        assert_eq!(callback_query("GET /favicon.ico HTTP/1.1"), None);
        assert_eq!(callback_query("POST /callback?code=x HTTP/1.1"), None);
        assert_eq!(callback_query("GET /callback?code=%zz HTTP/1.1"), None);
    }

    #[test]
    fn an_address_gets_https_and_plain_http_only_reaches_this_computer() {
        assert_eq!(
            normalize_address(" notes.example.org/ ").unwrap(),
            "https://notes.example.org"
        );
        assert_eq!(
            normalize_address("https://notes.example.org").unwrap(),
            "https://notes.example.org"
        );
        assert_eq!(
            normalize_address("http://localhost:8080").unwrap(),
            "http://localhost:8080"
        );
        assert!(normalize_address("http://notes.example.org").is_err());
        assert!(normalize_address("   ").is_err());
    }

    #[tokio::test]
    async fn a_server_sending_blobs_nobody_asked_for_cannot_stall_a_download() {
        let stranger = "a".repeat(64);
        let body = frames::encode([(stranger.as_str(), b"not asked for".as_slice())]).unwrap();
        let app = axum::Router::new().route(
            "/sync/v1/blobs/fetch",
            axum::routing::post(move || {
                let body = body.clone();
                async move { body }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = Client::new(&address).unwrap();
        let got = tokio::time::timeout(Duration::from_secs(5), client.download(&["b".repeat(64)]))
            .await
            .expect("the download finished")
            .unwrap();
        assert!(got.is_empty());
    }
}
