use base64::Engine;
use instantnotes_server::{AppState, Config, Person};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;

struct Server {
    base: String,
    state: AppState,
    _dir: tempfile::TempDir,
}

async fn start() -> Server {
    let dir = tempfile::tempdir().unwrap();
    let config = Config {
        listen: "127.0.0.1:0".parse().unwrap(),
        data_dir: dir.path().join("data"),
        public_url: "http://localhost:8080".into(),
        oidc_issuer: "http://127.0.0.1:9".into(),
        oidc_client_id: "client".into(),
        oidc_client_secret: "secret".into(),
        ui_dir: dir.path().join("ui"),
        idle_close: Duration::from_secs(600),
        session_ttl: Duration::from_secs(3600),
        trust_proxy: false,
        max_object_bytes: 4096,
    };
    let state = AppState::new(config).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let app = instantnotes_server::app(state.clone());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Server {
        base,
        state,
        _dir: dir,
    }
}

const VERIFIER: &str = "a-verifier-that-is-long-enough-for-pkce-0123456789";
const CALLBACK: &str = "http://127.0.0.1:49152/callback";

fn challenge() -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(VERIFIER.as_bytes()))
}

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
}

fn authorize_url(base: &str, redirect: &str) -> String {
    format!(
        "{base}/sync/v1/device/authorize?redirect_uri={}&state=app-state&code_challenge={}&code_challenge_method=S256&device_name=Work%20laptop",
        urlencode(redirect),
        challenge()
    )
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn hidden(page: &str, name: &str) -> String {
    let marker = format!(r#"name="{name}" value=""#);
    let start = page.find(&marker).unwrap() + marker.len();
    page[start..].split('"').next().unwrap().to_string()
}

fn query(location: &str, key: &str) -> Option<String> {
    location
        .split(['?', '&'])
        .find_map(|p| p.strip_prefix(&format!("{key}=")))
        .map(str::to_string)
}

impl Server {
    fn cookie(&self) -> String {
        let session = self.state.sessions.create(Person {
            sub: "alice".into(),
            name: Some("Alice <Example>".into()),
            email: None,
        });
        format!("in_session={session}")
    }

    async fn allow(&self, cookie: &str, decision: &str) -> String {
        let page = http()
            .get(authorize_url(&self.base, CALLBACK))
            .header("cookie", cookie)
            .send()
            .await
            .unwrap();
        assert_eq!(page.status(), 200);
        let page = page.text().await.unwrap();
        assert!(page.contains("Work laptop"));
        assert!(page.contains("Alice &lt;Example&gt;"));
        let sent = http()
            .post(format!("{}/sync/v1/device/allow", self.base))
            .header("cookie", cookie)
            .form(&[
                ("request", hidden(&page, "request")),
                ("csrf", hidden(&page, "csrf")),
                ("decision", decision.to_string()),
            ])
            .send()
            .await
            .unwrap();
        assert!(sent.status().is_redirection());
        sent.headers()["location"].to_str().unwrap().to_string()
    }

    async fn exchange(&self, code: &str, verifier: &str) -> reqwest::Response {
        http()
            .post(format!("{}/sync/v1/device/token", self.base))
            .json(&json!({ "code": code, "codeVerifier": verifier, "redirectUri": CALLBACK }))
            .send()
            .await
            .unwrap()
    }
}

#[tokio::test]
async fn a_desktop_signs_in_through_the_browser_and_gets_its_own_device_token() {
    let server = start().await;
    let cookie = server.cookie();
    let location = server.allow(&cookie, "allow").await;
    assert!(location.starts_with(&format!("{CALLBACK}?code=")));
    assert_eq!(query(&location, "state").as_deref(), Some("app-state"));
    let code = query(&location, "code").unwrap();
    assert_eq!(server.exchange(&code, "wrong-verifier").await.status(), 400);
    let location = server.allow(&cookie, "allow").await;
    let code = query(&location, "code").unwrap();
    let issued: Value = server.exchange(&code, VERIFIER).await.json().await.unwrap();
    let token = issued["token"].as_str().unwrap();
    assert!(token.starts_with("ins_"));
    assert_eq!(issued["person"]["name"], "Alice <Example>");
    assert_eq!(server.exchange(&code, VERIFIER).await.status(), 400);
    let devices: Value = http()
        .get(format!("{}/sync/v1/devices", server.base))
        .bearer_auth(token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(devices
        .as_array()
        .unwrap()
        .iter()
        .any(|d| d["name"] == "Work laptop" && d["current"] == true));
}

#[tokio::test]
async fn cancel_sends_the_app_a_refusal_and_no_code() {
    let server = start().await;
    let cookie = server.cookie();
    let location = server.allow(&cookie, "deny").await;
    assert_eq!(query(&location, "error").as_deref(), Some("access_denied"));
    assert!(query(&location, "code").is_none());
}

#[tokio::test]
async fn without_a_session_the_browser_signs_in_first() {
    let server = start().await;
    let r = http()
        .get(authorize_url(&server.base, CALLBACK))
        .send()
        .await
        .unwrap();
    assert!(r.status().is_redirection());
    assert!(r.headers()["location"]
        .to_str()
        .unwrap()
        .starts_with("/auth/login?device="));
}

#[tokio::test]
async fn only_a_callback_on_this_computer_is_accepted() {
    let server = start().await;
    let cookie = server.cookie();
    for redirect in [
        "https://evil.example/callback",
        "http://127.0.0.1.evil.example:80/callback",
        "http://localhost:49152/callback",
    ] {
        let r = http()
            .get(authorize_url(&server.base, redirect))
            .header("cookie", &cookie)
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 400, "{redirect}");
    }
}

#[tokio::test]
async fn a_forged_allow_without_the_pages_csrf_does_nothing() {
    let server = start().await;
    let cookie = server.cookie();
    let page = http()
        .get(authorize_url(&server.base, CALLBACK))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    let forged = http()
        .post(format!("{}/sync/v1/device/allow", server.base))
        .header("cookie", &cookie)
        .form(&[
            ("request", hidden(&page, "request")),
            ("csrf", "guessed".to_string()),
            ("decision", "allow".to_string()),
        ])
        .send()
        .await
        .unwrap();
    assert_eq!(forged.status(), 400);
}

#[tokio::test]
async fn a_headless_app_pairs_with_a_code_the_person_enters_on_another_device() {
    let server = start().await;
    let client = http();
    let started: Value = client
        .post(format!("{}/sync/v1/device/code", server.base))
        .json(&json!({ "codeChallenge": challenge(), "deviceName": "Container" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let device_code = started["deviceCode"].as_str().unwrap();
    let user_code = started["userCode"].as_str().unwrap();
    assert_eq!(user_code.len(), 9);
    assert_eq!(
        started["verificationUri"],
        "http://localhost:8080/sync/v1/device/link"
    );
    let poll = |verifier: &'static str| {
        let client = http();
        let url = format!("{}/sync/v1/device/poll", server.base);
        let body = json!({ "deviceCode": device_code, "codeVerifier": verifier });
        async move { client.post(url).json(&body).send().await.unwrap() }
    };
    let waiting = poll(VERIFIER).await;
    assert_eq!(waiting.status(), 202);
    let cookie = server.cookie();
    let wrong = client
        .get(format!(
            "{}/sync/v1/device/link?code=AAAA-AAAA",
            server.base
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(wrong.status(), 404);
    let signed_out = client
        .get(format!(
            "{}/sync/v1/device/link?code={user_code}",
            server.base
        ))
        .send()
        .await
        .unwrap();
    let login = signed_out.headers()["location"].to_str().unwrap();
    assert!(login.starts_with("/auth/login?device="));
    assert!(
        !login.contains(device_code),
        "the poll secret never reaches a browser"
    );
    let page = client
        .get(format!(
            "{}/sync/v1/device/link?code={}",
            server.base,
            user_code.to_lowercase().replace('-', " ")
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(page.contains("Container"));
    assert!(page.contains(user_code), "the person checks the code");
    assert!(!page.contains(device_code));
    let done = client
        .post(format!("{}/sync/v1/device/allow", server.base))
        .header("cookie", &cookie)
        .form(&[
            ("request", hidden(&page, "request")),
            ("csrf", hidden(&page, "csrf")),
            ("decision", "allow".to_string()),
        ])
        .send()
        .await
        .unwrap();
    assert_eq!(done.status(), 200);
    assert_eq!(
        poll("not-the-verifier-not-the-verifier-not-the-verifier")
            .await
            .status(),
        400
    );
    let again = poll(VERIFIER).await;
    assert_eq!(again.status(), 400, "a wrong verifier burns the grant");
}

#[tokio::test]
async fn pairing_hands_over_a_token_once_and_a_cancel_gives_none() {
    let server = start().await;
    let cookie = server.cookie();
    for decision in ["allow", "deny"] {
        let started: Value = http()
            .post(format!("{}/sync/v1/device/code", server.base))
            .json(&json!({ "codeChallenge": challenge(), "deviceName": "Container" }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let page = http()
            .get(format!(
                "{}/sync/v1/device/link?code={}",
                server.base,
                started["userCode"].as_str().unwrap()
            ))
            .header("cookie", &cookie)
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        http()
            .post(format!("{}/sync/v1/device/allow", server.base))
            .header("cookie", &cookie)
            .form(&[
                ("request", hidden(&page, "request")),
                ("csrf", hidden(&page, "csrf")),
                ("decision", decision.to_string()),
            ])
            .send()
            .await
            .unwrap();
        let body = json!({ "deviceCode": started["deviceCode"], "codeVerifier": VERIFIER });
        let poll = || async {
            http()
                .post(format!("{}/sync/v1/device/poll", server.base))
                .json(&body)
                .send()
                .await
                .unwrap()
        };
        let answer = poll().await;
        if decision == "allow" {
            assert_eq!(answer.status(), 200);
            let issued: Value = answer.json().await.unwrap();
            assert!(issued["token"].as_str().unwrap().starts_with("ins_"));
            assert_eq!(issued["person"]["name"], "Alice <Example>");
            assert_eq!(poll().await.status(), 400);
        } else {
            assert_eq!(answer.status(), 400);
            let refused: Value = answer.json().await.unwrap();
            assert_eq!(refused["code"], "ACCESS_DENIED");
        }
    }
}
