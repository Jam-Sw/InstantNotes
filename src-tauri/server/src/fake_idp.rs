use aws_lc_rs::rand::SystemRandom;
use aws_lc_rs::signature::{Ed25519KeyPair, KeyPair};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use serde_json::{json, Value};
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
    key_fetches: usize,
    token_answers: Vec<(StatusCode, Value)>,
}

#[derive(Clone)]
pub struct FakeIdp(Arc<Mutex<Inner>>);

async fn discovery(State(idp): State<FakeIdp>) -> Json<Value> {
    let issuer = idp.issuer();
    Json(json!({
        "issuer": issuer,
        "authorization_endpoint": format!("{issuer}/authorize"),
        "token_endpoint": format!("{issuer}/token"),
        "jwks_uri": format!("{issuer}/jwks"),
        "scopes_supported": ["openid", "profile", "email", "offline_access"],
    }))
}

async fn jwks(State(idp): State<FakeIdp>) -> Json<Value> {
    let mut inner = idp.0.lock().unwrap();
    inner.key_fetches += 1;
    Json(json!({ "keys": [inner.signer.jwk()] }))
}

async fn token(State(idp): State<FakeIdp>) -> impl IntoResponse {
    let mut inner = idp.0.lock().unwrap();
    let (status, body) = if inner.token_answers.len() > 1 {
        inner.token_answers.remove(0)
    } else {
        inner
            .token_answers
            .first()
            .cloned()
            .unwrap_or((StatusCode::SERVICE_UNAVAILABLE, json!({})))
    };
    (status, Json(body))
}

impl FakeIdp {
    pub async fn start() -> FakeIdp {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let idp = FakeIdp(Arc::new(Mutex::new(Inner {
            issuer: format!("http://{}", listener.local_addr().unwrap()),
            signer: Signer::generate("key-1"),
            key_fetches: 0,
            token_answers: Vec::new(),
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
        self.0.lock().unwrap().token_answers = vec![(status, body)];
    }
}
