use instantnotes_server::{AppState, Config, Person};
use std::time::Duration;

struct Server {
    base: String,
    state: AppState,
    dir: tempfile::TempDir,
}

async fn start(public_url: &str) -> Server {
    let dir = tempfile::tempdir().unwrap();
    let config = Config {
        listen: "127.0.0.1:0".parse().unwrap(),
        data_dir: dir.path().join("data"),
        public_url: public_url.into(),
        oidc_issuer: "http://127.0.0.1:9".into(),
        oidc_client_id: "client".into(),
        oidc_client_secret: "secret".into(),
        ui_dir: dir.path().join("ui"),
        vault_root: None,
        idle_close: Duration::from_secs(600),
        session_ttl: Duration::from_secs(3600),
        trust_proxy: false,
        max_object_bytes: 1024 * 1024,
    };
    let state = AppState::new(config).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let app = instantnotes_server::app(state.clone());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Server { base, state, dir }
}

fn person(sub: &str) -> Person {
    Person {
        sub: sub.into(),
        name: None,
        email: None,
    }
}

#[tokio::test]
async fn a_session_outlives_a_restart_of_the_server() {
    let first = start("http://localhost:8080").await;
    let token = first.state.sessions.create(person("alice"));
    let config = first.state.config.clone();
    drop(first.state);
    let again = AppState::new(config).unwrap();
    assert_eq!(again.sessions.get(&token).unwrap().sub, "alice");
    drop(first.dir);
}

#[cfg(unix)]
#[tokio::test]
async fn healthz_fails_when_the_data_folder_cannot_be_written() {
    use std::os::unix::fs::PermissionsExt;
    let server = start("http://localhost:8080").await;
    let http = reqwest::Client::new();
    let ok = http
        .get(format!("{}/healthz", server.base))
        .send()
        .await
        .unwrap();
    assert_eq!(ok.status(), 200);
    let data = server.dir.path().join("data");
    std::fs::set_permissions(&data, std::fs::Permissions::from_mode(0o500)).unwrap();
    let failed = http
        .get(format!("{}/healthz", server.base))
        .send()
        .await
        .unwrap();
    std::fs::set_permissions(&data, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(failed.status(), 503);
    assert!(failed.text().await.unwrap().contains("not writable"));
}

#[tokio::test]
async fn hsts_is_sent_only_for_an_https_address() {
    let http = reqwest::Client::new();
    let plain = start("http://localhost:8080").await;
    let response = http
        .get(format!("{}/healthz", plain.base))
        .send()
        .await
        .unwrap();
    assert!(response
        .headers()
        .get("strict-transport-security")
        .is_none());
    let secure = start("https://notes.example.org").await;
    let response = http
        .get(format!("{}/healthz", secure.base))
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.headers()["strict-transport-security"],
        "max-age=31536000"
    );
}

#[tokio::test]
async fn sign_in_pages_are_rate_limited_per_address() {
    let server = start("http://localhost:8080").await;
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    for n in 0..30 {
        let r = http
            .get(format!("{}/auth/callback?error=access_denied", server.base))
            .send()
            .await
            .unwrap();
        assert_ne!(r.status(), 429, "request {n} was limited");
    }
    let limited = http
        .get(format!("{}/auth/callback?error=access_denied", server.base))
        .send()
        .await
        .unwrap();
    assert_eq!(limited.status(), 429);
    let retry: u64 = limited.headers()["retry-after"]
        .to_str()
        .unwrap()
        .parse()
        .unwrap();
    assert!(retry >= 1);
}

#[tokio::test]
async fn a_callback_this_browser_did_not_start_is_refused() {
    let server = start("http://localhost:8080").await;
    let http = reqwest::Client::new();
    let foreign = http
        .get(format!(
            "{}/auth/callback?code=attackers-code&state=attackers-state",
            server.base
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(foreign.status(), 400);
    let mismatched = http
        .get(format!(
            "{}/auth/callback?code=c&state=attackers-state",
            server.base
        ))
        .header("cookie", "in_login=this-browsers-state")
        .send()
        .await
        .unwrap();
    assert_eq!(mismatched.status(), 400);
    assert!(mismatched
        .text()
        .await
        .unwrap()
        .contains("not started in this browser"));
}
