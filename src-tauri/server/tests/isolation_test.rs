use instantnotes_server::{AppState, Config, Person};
use std::time::Duration;

struct Server {
    base: String,
    state: AppState,
    _dir: tempfile::TempDir,
}

async fn start() -> Server {
    let dir = tempfile::tempdir().unwrap();
    let ui = dir.path().join("ui");
    std::fs::create_dir_all(&ui).unwrap();
    std::fs::write(ui.join("index.html"), "<!doctype html><title>app</title>").unwrap();
    let config = Config {
        listen: "127.0.0.1:0".parse().unwrap(),
        data_dir: dir.path().join("data"),
        public_url: "http://localhost:8080".into(),
        oidc_issuer: "http://127.0.0.1:9".into(),
        oidc_client_id: "client".into(),
        oidc_client_secret: "secret".into(),
        ui_dir: ui,
        idle_close: Duration::from_secs(600),
        session_ttl: Duration::from_secs(3600),
        trust_proxy: false,
        max_object_bytes: 1024 * 1024,
        people_dir: None,
        sign_in_stylesheet: None,
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

#[tokio::test]
async fn healthz_and_sign_in_page_need_no_session() {
    let server = start().await;
    let http = reqwest::Client::new();
    let health = http
        .get(format!("{}/healthz", server.base))
        .send()
        .await
        .unwrap();
    assert_eq!(health.status(), 200);
    let home = http.get(format!("{}/", server.base)).send().await.unwrap();
    assert_eq!(home.status(), 200);
    let page = home.text().await.unwrap();
    assert!(page.contains("/auth/login"));
    assert!(!page.contains("signin:done\",{detail"));
}

#[tokio::test]
async fn the_server_keeps_no_readable_library_and_its_old_routes_are_gone() {
    let server = start().await;
    let id = server.state.sessions.create(Person {
        sub: "alice".into(),
        name: None,
        email: None,
    });
    let http = reqwest::Client::new();
    let cookie = format!("in_session={id}");
    let listed = http
        .post(format!("{}/api/list_notes", server.base))
        .header("cookie", &cookie)
        .header("x-instantnotes", "1")
        .json(&serde_json::json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(listed.status(), 405);
    let saved = http
        .post(format!("{}/api/save_attachment", server.base))
        .header("cookie", &cookie)
        .header("x-instantnotes", "1")
        .body(vec![1u8, 2, 3])
        .send()
        .await
        .unwrap();
    assert_eq!(saved.status(), 405);
    let image = http
        .get(format!("{}/api/attachments/a1.png", server.base))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert!(!image
        .headers()
        .get("content-type")
        .is_some_and(|t| t.to_str().unwrap_or_default().starts_with("image/")));
    assert!(!server._dir.path().join("data").join("libraries").exists());
}
