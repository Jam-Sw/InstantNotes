use instantnotes_server::{AppState, Config, Person};
use serde_json::{json, Value};
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
    };
    let state = AppState::new(config);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let router = instantnotes_server::router(state.clone());
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    Server {
        base,
        state,
        _dir: dir,
    }
}

fn person(sub: &str) -> Person {
    Person {
        sub: sub.into(),
        name: Some(sub.to_uppercase()),
        email: None,
    }
}

struct Client {
    http: reqwest::Client,
    base: String,
    cookie: Option<String>,
}

impl Client {
    fn new(server: &Server, session: Option<String>) -> Self {
        Client {
            http: reqwest::Client::new(),
            base: server.base.clone(),
            cookie: session.map(|id| format!("in_session={id}")),
        }
    }

    async fn call(&self, command: &str, args: Value) -> (u16, Value) {
        let mut req = self
            .http
            .post(format!("{}/api/{command}", self.base))
            .header("x-instantnotes", "1")
            .json(&args);
        if let Some(cookie) = &self.cookie {
            req = req.header("cookie", cookie);
        }
        let res = req.send().await.unwrap();
        let status = res.status().as_u16();
        let body = res.json::<Value>().await.unwrap_or(Value::Null);
        (status, body)
    }

    async fn get(&self, path: &str) -> reqwest::Response {
        let mut req = self.http.get(format!("{}{path}", self.base));
        if let Some(cookie) = &self.cookie {
            req = req.header("cookie", cookie);
        }
        req.send().await.unwrap()
    }
}

#[tokio::test]
async fn healthz_and_sign_in_page_need_no_session() {
    let server = start().await;
    let anon = Client::new(&server, None);
    assert_eq!(anon.get("/healthz").await.status(), 200);
    let home = anon.get("/").await;
    assert_eq!(home.status(), 200);
    assert!(home.text().await.unwrap().contains("/auth/login"));
    let (status, body) = anon.call("list_notes", json!({})).await;
    assert_eq!(status, 401);
    assert_eq!(body["code"], "UNAUTHORIZED");
    assert_eq!(anon.get("/api/events").await.status(), 401);
}

#[tokio::test]
async fn two_people_get_two_libraries_and_cannot_cross() {
    let server = start().await;
    let a = Client::new(
        &server,
        Some(server.state.sessions.create(person("alice-sub"))),
    );
    let b = Client::new(
        &server,
        Some(server.state.sessions.create(person("bob-sub"))),
    );

    let (status, note) = a
        .call(
            "create_note",
            json!({ "input": { "title": "Alice only", "body": "secret #mine" } }),
        )
        .await;
    assert_eq!(status, 200, "{note}");
    let id = note["id"].as_str().unwrap().to_string();
    let (_, ws) = a
        .call("get_or_create_workspace", json!({ "name": "A space" }))
        .await;
    let ws_id = ws["id"].as_str().unwrap().to_string();
    a.call(
        "add_note_to_workspace",
        json!({ "noteId": id, "workspaceId": ws_id }),
    )
    .await;

    let (status, mine) = a.call("list_notes", json!({})).await;
    assert_eq!(status, 200);
    assert_eq!(mine.as_array().unwrap().len(), 1);

    let (status, theirs) = b.call("list_notes", json!({})).await;
    assert_eq!(status, 200);
    assert_eq!(theirs, json!([]));
    let (status, _) = b.call("search_notes", json!({ "text": "secret" })).await;
    assert_eq!(status, 200);
    let (_, found) = b.call("search_notes", json!({ "text": "secret" })).await;
    assert_eq!(found, json!([]));
    let (status, body) = b.call("get_note", json!({ "id": id })).await;
    assert_eq!(status, 404, "{body}");
    let (status, _) = b
        .call(
            "update_note",
            json!({ "id": id, "patch": { "body": "overwritten" } }),
        )
        .await;
    assert_eq!(status, 404);
    let (status, _) = b.call("soft_delete_note", json!({ "id": id })).await;
    assert_eq!(status, 404);
    let (status, _) = b
        .call(
            "add_note_to_workspace",
            json!({ "noteId": id, "workspaceId": ws_id }),
        )
        .await;
    assert_ne!(status, 200);
    let (_, b_spaces) = b.call("list_workspaces", json!({})).await;
    assert_eq!(b_spaces, json!([]));
    let (_, tags) = b.call("list_tags", json!({})).await;
    assert_eq!(tags, json!([]));

    let (status, still) = a.call("get_note", json!({ "id": id })).await;
    assert_eq!(status, 200);
    assert_eq!(still["body"], "secret #mine");

    let root = server.state.config.data_dir.join("libraries");
    assert!(root.join("alice-sub").join("library.db").exists());
    assert!(root.join("bob-sub").join("library.db").exists());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(root.join("alice-sub"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o700);
    }
}

#[tokio::test]
async fn attachments_stay_with_their_owner() {
    let server = start().await;
    let a = Client::new(
        &server,
        Some(server.state.sessions.create(person("alice-sub"))),
    );
    let b = Client::new(
        &server,
        Some(server.state.sessions.create(person("bob-sub"))),
    );
    let res = a
        .http
        .post(format!("{}/api/save_attachment", a.base))
        .header("x-instantnotes", "1")
        .header("x-attachment-ext", "png")
        .header("cookie", a.cookie.clone().unwrap())
        .body(vec![1u8, 2, 3])
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let name: String = res.json().await.unwrap();
    assert_eq!(
        a.get(&format!("/api/attachments/{name}")).await.status(),
        200
    );
    assert_eq!(
        b.get(&format!("/api/attachments/{name}")).await.status(),
        404
    );
    assert_eq!(
        a.get("/api/attachments/..%2Flibrary.db").await.status(),
        404
    );
}

#[tokio::test]
async fn desktop_only_commands_and_headerless_writes_are_refused() {
    let server = start().await;
    let a = Client::new(
        &server,
        Some(server.state.sessions.create(person("alice-sub"))),
    );
    for cmd in [
        "quit_app",
        "list_stickies",
        "export_vault",
        "set_vault_folder",
        "agent_connection",
    ] {
        let (status, _) = a.call(cmd, json!({})).await;
        assert_eq!(status, 404, "{cmd} must not exist on the web");
    }
    let res = a
        .http
        .post(format!("{}/api/create_note", a.base))
        .header("cookie", a.cookie.clone().unwrap())
        .json(&json!({ "input": {} }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 403);
}

#[tokio::test]
async fn a_change_reaches_the_owner_stream_only() {
    let server = start().await;
    let a_session = server.state.sessions.create(person("alice-sub"));
    let a = Client::new(&server, Some(a_session.clone()));
    let b = Client::new(
        &server,
        Some(server.state.sessions.create(person("bob-sub"))),
    );
    let mut a_stream = a.get("/api/events").await;
    let mut b_stream = b.get("/api/events").await;
    assert_eq!(a_stream.status(), 200);
    tokio::time::sleep(Duration::from_millis(100)).await;
    let (status, note) = a
        .call("create_note", json!({ "input": { "body": "hello" } }))
        .await;
    assert_eq!(status, 200);
    let chunk = tokio::time::timeout(Duration::from_secs(2), a_stream.chunk())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let text = String::from_utf8_lossy(&chunk);
    assert!(text.contains("event: notes:changed"), "{text}");
    assert!(text.contains(note["id"].as_str().unwrap()), "{text}");
    let quiet = tokio::time::timeout(Duration::from_millis(300), b_stream.chunk()).await;
    assert!(quiet.is_err(), "bob's stream must stay silent");
}

fn rss_kb() -> u64 {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("VmRSS:"))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|v| v.parse().ok())
        })
        .unwrap_or(0)
}

#[tokio::test]
async fn memory_per_active_person_is_printed() {
    let server = start().await;
    let before = rss_kb();
    let a = Client::new(
        &server,
        Some(server.state.sessions.create(person("alice-sub"))),
    );
    for i in 0..20 {
        a.call(
            "create_note",
            json!({ "input": { "body": format!("note {i} #tag{i}") } }),
        )
        .await;
    }
    a.call("list_notes", json!({})).await;
    a.call("search_notes", json!({ "text": "note" })).await;
    a.call("library_graph", json!({})).await;
    let one = rss_kb();
    let b = Client::new(
        &server,
        Some(server.state.sessions.create(person("bob-sub"))),
    );
    for i in 0..20 {
        b.call(
            "create_note",
            json!({ "input": { "body": format!("note {i} #tag{i}") } }),
        )
        .await;
    }
    b.call("list_notes", json!({})).await;
    b.call("search_notes", json!({ "text": "note" })).await;
    b.call("library_graph", json!({})).await;
    let two = rss_kb();
    println!("rss_kb before={before} one_person={one} two_people={two}");
    assert_eq!(server.state.libraries.open_count(), 2);
}
