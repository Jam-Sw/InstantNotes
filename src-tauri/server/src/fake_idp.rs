use aws_lc_rs::rand::SystemRandom;
use aws_lc_rs::signature::{Ed25519KeyPair, KeyPair};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Form, Json, Router};
use base64::Engine;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct Signer {
    pub kid: String,
    pkcs8: Vec<u8>,
    public: Vec<u8>,
}

impl Signer {
    pub fn generate(kid: &str) -> Signer {
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
        let public = Ed25519KeyPair::from_pkcs8(pkcs8.as_ref())
            .unwrap()
            .public_key()
            .as_ref()
            .to_vec();
        Signer {
            kid: kid.to_string(),
            pkcs8: pkcs8.as_ref().to_vec(),
            public,
        }
    }

    pub fn sign(&self, claims: &Value) -> String {
        let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::EdDSA);
        header.kid = Some(self.kid.clone());
        jsonwebtoken::encode(
            &header,
            claims,
            &jsonwebtoken::EncodingKey::from_ed_der(&self.pkcs8),
        )
        .unwrap()
    }

    fn jwk(&self) -> Value {
        json!({
            "kty": "OKP",
            "crv": "Ed25519",
            "alg": "EdDSA",
            "use": "sig",
            "kid": self.kid,
            "x": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&self.public),
        })
    }
}

struct Inner {
    issuer: String,
    signer: Signer,
    offline_access: bool,
    key_fetches: usize,
    answer: (StatusCode, Value),
    per_refresh: HashMap<String, (StatusCode, Value)>,
    requests: Vec<HashMap<String, String>>,
}

#[derive(Clone)]
pub struct FakeIdp(Arc<Mutex<Inner>>);

async fn discovery(State(idp): State<FakeIdp>) -> Json<Value> {
    let inner = idp.0.lock().unwrap();
    let issuer = inner.issuer.clone();
    let scopes: &[&str] = if inner.offline_access {
        &["openid", "profile", "email", "offline_access"]
    } else {
        &["openid", "profile", "email"]
    };
    Json(json!({
        "issuer": issuer,
        "authorization_endpoint": format!("{issuer}/authorize"),
        "token_endpoint": format!("{issuer}/token"),
        "jwks_uri": format!("{issuer}/jwks"),
        "scopes_supported": scopes,
    }))
}

async fn jwks(State(idp): State<FakeIdp>) -> Json<Value> {
    let mut inner = idp.0.lock().unwrap();
    inner.key_fetches += 1;
    Json(json!({ "keys": [inner.signer.jwk()] }))
}

async fn token(
    State(idp): State<FakeIdp>,
    Form(form): Form<HashMap<String, String>>,
) -> impl IntoResponse {
    let mut inner = idp.0.lock().unwrap();
    let (status, body) = form
        .get("refresh_token")
        .and_then(|t| inner.per_refresh.get(t).cloned())
        .unwrap_or_else(|| inner.answer.clone());
    inner.requests.push(form);
    (status, Json(body))
}

impl FakeIdp {
    pub async fn start() -> FakeIdp {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let idp = FakeIdp(Arc::new(Mutex::new(Inner {
            issuer: format!("http://{}", listener.local_addr().unwrap()),
            signer: Signer::generate("key-1"),
            offline_access: true,
            key_fetches: 0,
            answer: (StatusCode::SERVICE_UNAVAILABLE, json!({})),
            per_refresh: HashMap::new(),
            requests: Vec::new(),
        })));
        let router = Router::new()
            .route("/.well-known/openid-configuration", get(discovery))
            .route("/jwks", get(jwks))
            .route("/token", post(token))
            .with_state(idp.clone());
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        idp
    }

    pub fn issuer(&self) -> String {
        self.0.lock().unwrap().issuer.clone()
    }

    pub fn signer(&self) -> Signer {
        self.0.lock().unwrap().signer.clone()
    }

    pub fn rotate(&self, kid: &str) {
        self.0.lock().unwrap().signer = Signer::generate(kid);
    }

    pub fn key_fetches(&self) -> usize {
        self.0.lock().unwrap().key_fetches
    }

    pub fn answer_token(&self, body: Value) {
        self.answer_token_with(StatusCode::OK, body);
    }

    pub fn answer_token_with(&self, status: StatusCode, body: Value) {
        self.0.lock().unwrap().answer = (status, body);
    }

    pub fn answer_refresh(&self, refresh_token: &str, status: StatusCode, body: Value) {
        self.0
            .lock()
            .unwrap()
            .per_refresh
            .insert(refresh_token.to_string(), (status, body));
    }

    pub fn without_offline_access(&self) {
        self.0.lock().unwrap().offline_access = false;
    }

    pub fn requests(&self) -> Vec<HashMap<String, String>> {
        self.0.lock().unwrap().requests.clone()
    }

    pub fn id_token(&self, sub: &str) -> String {
        let issuer = self.issuer();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        self.signer().sign(&json!({
            "iss": issuer,
            "aud": "client",
            "sub": sub,
            "exp": now + 300,
            "iat": now,
        }))
    }
}
