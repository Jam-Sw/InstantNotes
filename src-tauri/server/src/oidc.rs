use crate::sessions::{Logins, Person};
use base64::Engine;
use jsonwebtoken::jwk::{Jwk, JwkSet};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Header, Validation};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, OnceCell};

const ALGORITHMS: &[Algorithm] = &[
    Algorithm::RS256,
    Algorithm::RS384,
    Algorithm::RS512,
    Algorithm::PS256,
    Algorithm::PS384,
    Algorithm::PS512,
    Algorithm::ES256,
    Algorithm::ES384,
    Algorithm::EdDSA,
];
const LEEWAY: u64 = 60;
const REFETCH_EVERY: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Deserialize)]
pub struct Discovery {
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub jwks_uri: String,
    pub end_session_endpoint: Option<String>,
    #[serde(default)]
    pub scopes_supported: Vec<String>,
}

pub struct SignedIn {
    pub person: Person,
    pub username: Option<String>,
    pub refresh_token: Option<String>,
    pub after: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Refresh {
    Accepted(Option<String>),
    Refused(String),
    Misconfigured {
        reason: String,
        rotated: Option<String>,
    },
    Unreachable {
        reason: String,
        rotated: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Fault {
    Unreachable(String),
    Invalid(String),
}

impl From<Fault> for String {
    fn from(fault: Fault) -> String {
        match fault {
            Fault::Unreachable(why) | Fault::Invalid(why) => why,
        }
    }
}

fn http_fault(what: &str, e: reqwest::Error) -> Fault {
    match e.status() {
        Some(status) if status.is_client_error() => Fault::Invalid(format!("{what} refused: {e}")),
        _ => Fault::Unreachable(format!("{what} unreachable: {e}")),
    }
}

impl Fault {
    fn into_refresh(self, rotated: Option<String>) -> Refresh {
        match self {
            Fault::Unreachable(reason) => Refresh::Unreachable { reason, rotated },
            Fault::Invalid(reason) => Refresh::Misconfigured { reason, rotated },
        }
    }
}

const REFUSALS: &[&str] = &["invalid_grant", "access_denied", "invalid_request"];
const OFFLINE_ACCESS: &str = "offline_access";

#[derive(Default)]
struct Keys {
    set: Option<JwkSet>,
    fetched: Option<Instant>,
}

pub struct Oidc {
    issuer: String,
    client_id: String,
    client_secret: String,
    redirect_uri: String,
    public_url: String,
    http: reqwest::Client,
    discovery: OnceCell<Discovery>,
    keys: Mutex<Keys>,
}

#[derive(Deserialize)]
struct TokenResponse {
    id_token: Option<String>,
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct Claims {
    sub: String,
    #[serde(default)]
    aud: Audience,
    azp: Option<String>,
    iat: Option<i64>,
    nonce: Option<String>,
    name: Option<String>,
    email: Option<String>,
    preferred_username: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(untagged)]
enum Audience {
    Many(Vec<String>),
    One(serde::de::IgnoredAny),
    #[default]
    None,
}

impl Audience {
    fn len(&self) -> usize {
        match self {
            Audience::One(_) => 1,
            Audience::Many(all) => all.len(),
            Audience::None => 0,
        }
    }
}

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub(crate) fn encode(value: &str) -> String {
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

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn pick<'a>(set: &'a JwkSet, header: &Header) -> Option<&'a Jwk> {
    match &header.kid {
        Some(kid) => set.find(kid),
        None => {
            let mut usable = set.keys.iter().filter(|k| {
                k.common
                    .key_algorithm
                    .is_none_or(|a| format!("{a:?}") == format!("{:?}", header.alg))
            });
            let first = usable.next();
            usable.next().is_none().then_some(first).flatten()
        }
    }
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
                .connect_timeout(std::time::Duration::from_secs(5))
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("http client"),
            discovery: OnceCell::new(),
            keys: Mutex::new(Keys::default()),
        }
    }

    async fn discover(&self) -> Result<&Discovery, Fault> {
        self.discovery
            .get_or_try_init(|| async {
                let url = format!("{}/.well-known/openid-configuration", self.issuer);
                let found: Discovery = self
                    .http
                    .get(&url)
                    .send()
                    .await
                    .and_then(reqwest::Response::error_for_status)
                    .map_err(|e| http_fault("sign-in server discovery", e))?
                    .json()
                    .await
                    .map_err(|e| {
                        Fault::Invalid(format!("sign-in server discovery unreadable: {e}"))
                    })?;
                Ok(found)
            })
            .await
    }

    pub async fn reachable(&self) -> Result<(), String> {
        match self.discover().await {
            Ok(_) => Ok(()),
            Err(Fault::Unreachable(why)) => Err(why),
            Err(Fault::Invalid(_)) => Ok(()),
        }
    }

    async fn fetch_keys(&self) -> Result<JwkSet, Fault> {
        let discovery = self.discover().await?;
        self.http
            .get(&discovery.jwks_uri)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|e| http_fault("sign-in server keys", e))?
            .json()
            .await
            .map_err(|e| Fault::Invalid(format!("sign-in server keys unreadable: {e}")))
    }

    async fn key_for(&self, header: &Header) -> Result<Jwk, Fault> {
        let unpublished = || {
            Fault::Invalid(
                "id_token is signed with a key the sign-in server does not publish".into(),
            )
        };
        let mut keys = self.keys.lock().await;
        if let Some(found) = keys.set.as_ref().and_then(|set| pick(set, header)) {
            return Ok(found.clone());
        }
        if keys.fetched.is_some_and(|at| at.elapsed() < REFETCH_EVERY) {
            return Err(unpublished());
        }
        let set = self.fetch_keys().await?;
        keys.fetched = Some(Instant::now());
        let found = pick(&set, header).cloned();
        keys.set = Some(set);
        found.ok_or_else(unpublished)
    }

    async fn verify(&self, id_token: &str, nonce: Option<&str>) -> Result<Claims, Fault> {
        let invalid = |why: String| Fault::Invalid(why);
        let header =
            decode_header(id_token).map_err(|_| invalid("id_token is not a JWT".into()))?;
        if !ALGORITHMS.contains(&header.alg) {
            return Err(invalid(format!(
                "id_token algorithm {:?} is not allowed",
                header.alg
            )));
        }
        let jwk = self.key_for(&header).await?;
        self.check(id_token, &header, &jwk, nonce).map_err(invalid)
    }

    fn check(
        &self,
        id_token: &str,
        header: &Header,
        jwk: &Jwk,
        nonce: Option<&str>,
    ) -> Result<Claims, String> {
        if let Some(declared) = &jwk.common.key_algorithm {
            if format!("{declared:?}") != format!("{:?}", header.alg) {
                return Err("id_token algorithm does not match its key".into());
            }
        }
        let key =
            DecodingKey::from_jwk(jwk).map_err(|e| format!("sign-in server key unusable: {e}"))?;
        let mut validation = Validation::new(header.alg);
        validation.leeway = LEEWAY;
        validation.validate_nbf = true;
        validation.set_audience(&[&self.client_id]);
        validation.set_issuer(&[self.issuer.clone(), format!("{}/", self.issuer)]);
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        let claims = decode::<Claims>(id_token, &key, &validation)
            .map_err(|e| format!("id_token refused: {e}"))?
            .claims;
        if claims
            .iat
            .is_some_and(|iat| iat > now_secs() + LEEWAY as i64)
        {
            return Err("id_token issued in the future".into());
        }
        let azp_needed = claims.aud.len() > 1;
        match claims.azp.as_deref() {
            Some(azp) if azp != self.client_id => return Err("id_token azp mismatch".into()),
            None if azp_needed => return Err("id_token has several audiences and no azp".into()),
            _ => {}
        }
        if let Some(expected) = nonce {
            if claims.nonce.as_deref() != Some(expected) {
                return Err("id_token nonce mismatch".into());
            }
        }
        if claims.sub.trim().is_empty() {
            return Err("id_token has no subject".into());
        }
        Ok(claims)
    }

    pub async fn begin(
        &self,
        logins: &Logins,
        after: Option<String>,
    ) -> Result<(String, String), String> {
        let discovery = self.discover().await.map_err(String::from)?;
        let (state, verifier, nonce) = logins.begin(after);
        let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
        let scope = if discovery
            .scopes_supported
            .iter()
            .any(|s| s == OFFLINE_ACCESS)
        {
            format!("openid profile email {OFFLINE_ACCESS}")
        } else {
            "openid profile email".to_string()
        };
        let url = format!(
            "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&nonce={}&code_challenge={}&code_challenge_method=S256",
            discovery.authorization_endpoint,
            encode(&self.client_id),
            encode(&self.redirect_uri),
            encode(&scope),
            encode(&state),
            encode(&nonce),
            encode(&challenge),
        );
        Ok((url, state))
    }

    pub async fn finish(
        &self,
        logins: &Logins,
        code: &str,
        state: &str,
    ) -> Result<SignedIn, String> {
        let pending = logins
            .take(state)
            .ok_or_else(|| "sign-in expired or unknown; start again".to_string())?;
        let discovery = self.discover().await.map_err(String::from)?;
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
        let id_token = token
            .id_token
            .ok_or_else(|| "token response has no id_token".to_string())?;
        let claims = self
            .verify(&id_token, Some(&pending.nonce))
            .await
            .map_err(String::from)?;
        Ok(SignedIn {
            username: claims.preferred_username,
            person: Person {
                sub: claims.sub,
                name: claims.name,
                email: claims.email,
            },
            refresh_token: token.refresh_token,
            after: pending.after,
        })
    }

    pub async fn refresh(&self, refresh_token: &str, sub: &str) -> Refresh {
        let discovery = match self.discover().await {
            Ok(d) => d,
            Err(fault) => return fault.into_refresh(None),
        };
        let sent = self
            .http
            .post(&discovery.token_endpoint)
            .form(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
                ("client_id", &self.client_id),
                ("client_secret", &self.client_secret),
            ])
            .send()
            .await;
        let response = match sent {
            Ok(r) => r,
            Err(e) => {
                return Refresh::Unreachable {
                    reason: format!("token endpoint unreachable: {e}"),
                    rotated: None,
                }
            }
        };
        let status = response.status();
        if status.is_server_error() {
            return Refresh::Unreachable {
                reason: format!("token endpoint answered {status}"),
                rotated: None,
            };
        }
        if !status.is_success() {
            let error = response
                .json::<serde_json::Value>()
                .await
                .ok()
                .and_then(|v| v.get("error")?.as_str().map(str::to_string));
            return match (status.as_u16(), error) {
                (400 | 401 | 403, Some(e)) if REFUSALS.contains(&e.as_str()) => Refresh::Refused(e),
                (_, e) => Refresh::Misconfigured {
                    reason: format!(
                        "token endpoint answered {status} {}",
                        e.unwrap_or_else(|| "with no OAuth error".into())
                    ),
                    rotated: None,
                },
            };
        }
        let token: TokenResponse = match response.json().await {
            Ok(t) => t,
            Err(_) => {
                return Refresh::Misconfigured {
                    reason: "refresh response unreadable".into(),
                    rotated: None,
                }
            }
        };
        let rotated = token.refresh_token;
        if let Some(id_token) = token.id_token {
            match self.verify(&id_token, None).await {
                Ok(claims) if claims.sub == sub => {}
                Ok(_) => {
                    return Refresh::Misconfigured {
                        reason: "refreshed id_token names another person".into(),
                        rotated,
                    }
                }
                Err(fault) => return fault.into_refresh(rotated),
            }
        }
        Refresh::Accepted(rotated)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fake_idp::{FakeIdp, Signer};
    use serde_json::json;

    struct Run {
        idp: FakeIdp,
        oidc: Oidc,
        logins: Logins,
    }

    async fn run() -> Run {
        let idp = FakeIdp::start().await;
        let oidc = Oidc::new(
            &idp.issuer(),
            "client",
            "secret",
            "http://app",
            "http://app/cb",
        );
        Run {
            idp,
            oidc,
            logins: Logins::default(),
        }
    }

    impl Run {
        async fn nonce_and_state(&self) -> (String, String) {
            let (url, _) = self.oidc.begin(&self.logins, None).await.unwrap();
            let param = |name: &str| {
                url.split(['?', '&'])
                    .find_map(|p| p.strip_prefix(&format!("{name}=")))
                    .unwrap()
                    .to_string()
            };
            (param("nonce"), param("state"))
        }

        fn claims(&self, nonce: &str) -> serde_json::Value {
            json!({
                "iss": self.idp.issuer(),
                "aud": "client",
                "sub": "person-1",
                "exp": now_secs() + 300,
                "iat": now_secs(),
                "nonce": nonce,
                "name": "Person One",
            })
        }

        async fn sign_in_with(
            &self,
            token: impl Fn(&serde_json::Value, &Signer) -> String,
        ) -> Result<Person, String> {
            let (nonce, state) = self.nonce_and_state().await;
            let claims = self.claims(&nonce);
            self.idp
                .answer_token(json!({ "id_token": token(&claims, &self.idp.signer()) }));
            self.oidc
                .finish(&self.logins, "code", &state)
                .await
                .map(|signed_in| signed_in.person)
        }

        async fn sign_in_edited(
            &self,
            edit: impl Fn(&mut serde_json::Value),
        ) -> Result<Person, String> {
            self.sign_in_with(|claims, signer| {
                let mut claims = claims.clone();
                edit(&mut claims);
                signer.sign(&claims)
            })
            .await
        }
    }

    #[tokio::test]
    async fn a_token_signed_by_the_providers_key_signs_the_person_in() {
        let r = run().await;
        let person = r.sign_in_edited(|_| {}).await.unwrap();
        assert_eq!(person.sub, "person-1");
        assert_eq!(person.name.as_deref(), Some("Person One"));
    }

    #[tokio::test]
    async fn the_preferred_username_comes_with_the_person() {
        let r = run().await;
        let (nonce, state) = r.nonce_and_state().await;
        let mut claims = r.claims(&nonce);
        claims["preferred_username"] = json!("alice");
        r.idp
            .answer_token(json!({ "id_token": r.idp.signer().sign(&claims) }));
        let signed_in = r.oidc.finish(&r.logins, "code", &state).await.unwrap();
        assert_eq!(signed_in.username.as_deref(), Some("alice"));
    }

    #[tokio::test]
    async fn a_token_signed_by_another_key_is_refused() {
        let r = run().await;
        let stranger = Signer::generate(&r.idp.signer().kid);
        let refused = r.sign_in_with(|claims, _| stranger.sign(claims)).await;
        assert!(refused.unwrap_err().contains("id_token refused"));
    }

    #[tokio::test]
    async fn an_unsigned_token_is_refused() {
        let r = run().await;
        let refused = r
            .sign_in_with(|claims, signer| {
                let header = b64url(
                    json!({ "alg": "none", "kid": signer.kid })
                        .to_string()
                        .as_bytes(),
                );
                format!("{header}.{}.", b64url(claims.to_string().as_bytes()))
            })
            .await;
        assert!(refused.is_err());
    }

    #[tokio::test]
    async fn a_token_signed_with_the_client_secret_is_refused() {
        let r = run().await;
        let refused = r
            .sign_in_with(|claims, signer| {
                let mut header = jsonwebtoken::Header::new(Algorithm::HS256);
                header.kid = Some(signer.kid.clone());
                jsonwebtoken::encode(
                    &header,
                    claims,
                    &jsonwebtoken::EncodingKey::from_secret(b"secret"),
                )
                .unwrap()
            })
            .await;
        assert!(refused.unwrap_err().contains("not allowed"));
    }

    #[tokio::test]
    async fn wrong_issuer_audience_azp_and_nonce_are_each_refused() {
        let r = run().await;
        type Edit = Box<dyn Fn(&mut serde_json::Value)>;
        let edits: [(&str, Edit); 4] = [
            (
                "issuer",
                Box::new(|c| c["iss"] = json!("https://elsewhere.example")),
            ),
            ("audience", Box::new(|c| c["aud"] = json!("another-client"))),
            (
                "azp",
                Box::new(|c| {
                    c["aud"] = json!(["client", "another-client"]);
                    c["azp"] = json!("another-client");
                }),
            ),
            ("nonce", Box::new(|c| c["nonce"] = json!("replayed"))),
        ];
        for (what, edit) in edits {
            assert!(r.sign_in_edited(edit).await.is_err(), "{what} was accepted");
        }
        assert!(
            r.sign_in_edited(|c| c["aud"] = json!(["client", "another-client"]))
                .await
                .is_err(),
            "several audiences with no azp were accepted"
        );
        assert!(
            r.sign_in_edited(|c| {
                c["aud"] = json!(["client", "another-client"]);
                c["azp"] = json!("client");
            })
            .await
            .is_ok(),
            "several audiences with our azp were refused"
        );
    }

    #[tokio::test]
    async fn expired_not_yet_valid_and_future_tokens_are_refused() {
        let r = run().await;
        assert!(r
            .sign_in_edited(|c| c["exp"] = json!(now_secs() - 120))
            .await
            .is_err());
        assert!(r
            .sign_in_edited(|c| c["nbf"] = json!(now_secs() + 600))
            .await
            .is_err());
        assert!(r
            .sign_in_edited(|c| c["iat"] = json!(now_secs() + 600))
            .await
            .is_err());
        assert!(r
            .sign_in_edited(|c| c["exp"] = json!(now_secs() - 30))
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn a_rotated_key_is_fetched_once_then_not_again_within_a_minute() {
        let r = run().await;
        r.sign_in_edited(|_| {}).await.unwrap();
        assert_eq!(r.idp.key_fetches(), 1);
        r.idp.rotate("key-2");
        r.oidc.keys.lock().await.fetched = Some(Instant::now() - REFETCH_EVERY);
        r.sign_in_edited(|_| {}).await.unwrap();
        assert_eq!(r.idp.key_fetches(), 2);
        r.idp.rotate("key-3");
        assert!(r
            .sign_in_edited(|_| {})
            .await
            .unwrap_err()
            .contains("does not publish"));
        assert_eq!(r.idp.key_fetches(), 2);
    }

    #[tokio::test]
    async fn sign_in_asks_for_offline_access_only_where_the_provider_offers_it() {
        let r = run().await;
        assert!(r
            .oidc
            .begin(&r.logins, None)
            .await
            .unwrap()
            .0
            .contains("offline_access"));
        let idp = FakeIdp::start().await;
        idp.without_offline_access();
        let oidc = Oidc::new(
            &idp.issuer(),
            "client",
            "secret",
            "http://app",
            "http://app/cb",
        );
        assert!(!oidc
            .begin(&r.logins, None)
            .await
            .unwrap()
            .0
            .contains("offline_access"));
    }

    #[tokio::test]
    async fn sign_in_keeps_the_refresh_token() {
        let r = run().await;
        let (nonce, state) = r.nonce_and_state().await;
        let id_token = r.idp.signer().sign(&r.claims(&nonce));
        r.idp
            .answer_token(json!({ "id_token": id_token, "refresh_token": "r-1" }));
        let signed_in = r.oidc.finish(&r.logins, "code", &state).await.unwrap();
        assert_eq!(signed_in.refresh_token.as_deref(), Some("r-1"));
        assert_eq!(signed_in.after, None);
    }

    #[tokio::test]
    async fn a_device_sign_in_comes_back_to_its_request() {
        let r = run().await;
        let (url, _) = r
            .oidc
            .begin(&r.logins, Some("device-request".into()))
            .await
            .unwrap();
        let param = |name: &str| {
            url.split(['?', '&'])
                .find_map(|p| p.strip_prefix(&format!("{name}=")))
                .unwrap()
                .to_string()
        };
        let id_token = r.idp.signer().sign(&r.claims(&param("nonce")));
        r.idp.answer_token(json!({ "id_token": id_token }));
        let signed_in = r
            .oidc
            .finish(&r.logins, "code", &param("state"))
            .await
            .unwrap();
        assert_eq!(signed_in.after.as_deref(), Some("device-request"));
    }

    #[tokio::test]
    async fn a_refresh_is_sorted_into_accepted_refused_misconfigured_or_unreachable() {
        use axum::http::StatusCode;
        let r = run().await;
        let error = |e: &str| json!({ "error": e });
        r.idp.answer_refresh(
            "ok",
            StatusCode::OK,
            json!({ "id_token": r.idp.id_token("person-1"), "refresh_token": "ok-2" }),
        );
        assert_eq!(
            r.oidc.refresh("ok", "person-1").await,
            Refresh::Accepted(Some("ok-2".into()))
        );
        let sent = r.idp.requests().pop().unwrap();
        assert_eq!(sent["grant_type"], "refresh_token");
        assert_eq!(sent["refresh_token"], "ok");
        r.idp.answer_refresh(
            "other",
            StatusCode::OK,
            json!({ "id_token": r.idp.id_token("person-2") }),
        );
        assert!(matches!(
            r.oidc.refresh("other", "person-1").await,
            Refresh::Misconfigured { .. }
        ));
        for code in ["invalid_grant", "access_denied", "invalid_request"] {
            r.idp
                .answer_refresh(code, StatusCode::BAD_REQUEST, error(code));
            assert_eq!(
                r.oidc.refresh(code, "person-1").await,
                Refresh::Refused(code.into())
            );
        }
        r.idp
            .answer_refresh("group", StatusCode::FORBIDDEN, error("access_denied"));
        assert_eq!(
            r.oidc.refresh("group", "person-1").await,
            Refresh::Refused("access_denied".into())
        );
        for (token, status, body) in [
            ("client", StatusCode::UNAUTHORIZED, error("invalid_client")),
            ("scope", StatusCode::BAD_REQUEST, error("invalid_scope")),
            ("busy", StatusCode::TOO_MANY_REQUESTS, json!({})),
        ] {
            r.idp.answer_refresh(token, status, body);
            assert!(
                matches!(
                    r.oidc.refresh(token, "person-1").await,
                    Refresh::Misconfigured { rotated: None, .. }
                ),
                "{token}"
            );
        }
        r.idp
            .answer_refresh("down", StatusCode::INTERNAL_SERVER_ERROR, json!({}));
        assert!(matches!(
            r.oidc.refresh("down", "person-1").await,
            Refresh::Unreachable { .. }
        ));
        let gone = Oidc::new(
            "http://127.0.0.1:9",
            "client",
            "secret",
            "http://app",
            "http://app/cb",
        );
        assert!(matches!(
            gone.refresh("any", "person-1").await,
            Refresh::Unreachable { .. }
        ));
    }

    #[tokio::test]
    async fn a_rotated_token_survives_when_the_new_id_token_cannot_be_checked() {
        use axum::http::StatusCode;
        let r = run().await;
        r.idp.rotate("key-2");
        r.idp.keys_down(true);
        r.idp.answer_refresh(
            "r-1",
            StatusCode::OK,
            json!({ "id_token": r.idp.id_token("person-1"), "refresh_token": "r-2" }),
        );
        let outcome = r.oidc.refresh("r-1", "person-1").await;
        assert!(
            matches!(&outcome, Refresh::Unreachable { rotated: Some(t), .. } if t == "r-2"),
            "{outcome:?}"
        );
    }

    #[tokio::test]
    async fn an_es256_key_from_the_provider_is_accepted_and_others_refused() {
        let r = run().await;
        let ec = crate::fake_idp::EcSigner::generate("ec-1");
        r.idp.publish_extra(ec.jwk());
        let accepted = r.sign_in_with(|claims, _| ec.sign(claims)).await;
        assert_eq!(accepted.unwrap().sub, "person-1");
        let stranger = crate::fake_idp::EcSigner::generate("ec-1");
        let refused = r.sign_in_with(|claims, _| stranger.sign(claims)).await;
        assert!(refused.unwrap_err().contains("InvalidSignature"));
    }
}
