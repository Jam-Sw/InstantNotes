use instantnotes_core::types::{CreateNoteInput, UpdateNotePatch};
use instantnotes_core::vault::{Folder, Syncer};
use instantnotes_core::Store;
use instantnotes_server::{AppState, Config, Person};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

struct Server {
    base: String,
    state: AppState,
    _dir: tempfile::TempDir,
}

async fn start() -> Server {
    start_with(None).await
}

async fn start_with(vault_root: Option<PathBuf>) -> Server {
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
        vault_root,
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

struct Desk {
    store: Mutex<Store>,
    syncer: Syncer,
}

impl Desk {
    fn new(folder: &Path, titles: &[&str]) -> Desk {
        let mut store = Store::open_in_memory().unwrap();
        for title in titles {
            store
                .create_note(CreateNoteInput {
                    title: Some(title.to_string()),
                    body: Some(format!("{title} body")),
                    ..Default::default()
                })
                .unwrap();
        }
        store.configure_vault(Some(folder)).unwrap();
        Desk {
            store: Mutex::new(store),
            syncer: Syncer::new(Box::new(Folder::new(folder.to_path_buf())), None),
        }
    }

    fn sync(&mut self) {
        let report = self.syncer.cycle(&self.store);
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert!(report.reached(), "{:?}", report.unreachable);
    }

    fn titles(&self) -> Vec<String> {
        let mut titles: Vec<String> = self
            .store
            .lock()
            .unwrap()
            .list_notes(Default::default())
            .unwrap()
            .into_iter()
            .map(|n| n.title)
            .collect();
        titles.sort();
        titles
    }
}

fn md_files(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| n.ends_with(".md"))
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

async fn titles(client: &Client) -> Vec<String> {
    let (status, notes) = client.call("list_notes", json!({})).await;
    assert_eq!(status, 200, "{notes}");
    let mut titles: Vec<String> = notes
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["title"].as_str().unwrap().to_string())
        .collect();
    titles.sort();
    titles
}

async fn sync(server: &Server) {
    let state = server.state.clone();
    tokio::task::spawn_blocking(move || state.sync_vaults())
        .await
        .unwrap();
}

#[tokio::test]
async fn without_a_vault_root_no_library_syncs() {
    let server = start().await;
    let a = Client::new(
        &server,
        Some(server.state.sessions.create(person("alice-sub"))),
    );
    a.call("create_note", json!({ "input": { "body": "hello" } }))
        .await;
    sync(&server).await;
    assert!(server.state.libraries.open_vaults().is_empty());
    let (status, _) = a.call("get_vault_status", json!({})).await;
    assert_eq!(status, 404);
}

#[tokio::test]
async fn a_persons_vault_never_reaches_another_persons_library() {
    let vaults = tempfile::tempdir().unwrap();
    let alice_folder = vaults.path().join("alice-sub");
    let bob_folder = vaults.path().join("bob-sub");
    std::fs::create_dir_all(&alice_folder).unwrap();
    std::fs::create_dir_all(&bob_folder).unwrap();
    let mut alice_desk = Desk::new(&alice_folder, &["Alice one", "Alice two"]);
    alice_desk.sync();
    let mut bob_desk = Desk::new(&bob_folder, &["Bob one"]);
    bob_desk.sync();

    let server = start_with(Some(vaults.path().to_path_buf())).await;
    let a = Client::new(
        &server,
        Some(server.state.sessions.create(person("alice-sub"))),
    );
    let b = Client::new(
        &server,
        Some(server.state.sessions.create(person("bob-sub"))),
    );
    let sneaky = Client::new(
        &server,
        Some(server.state.sessions.create(person("../alice-sub"))),
    );
    assert_eq!(titles(&a).await, vec!["Alice one", "Alice two"]);
    assert_eq!(titles(&b).await, vec!["Bob one"]);
    assert!(titles(&sneaky).await.is_empty());

    let (status, _) = a
        .call(
            "create_note",
            json!({ "input": { "title": "Alice web", "body": "from the browser" } }),
        )
        .await;
    assert_eq!(status, 200);
    sync(&server).await;
    sync(&server).await;
    bob_desk.sync();
    alice_desk.sync();

    assert_eq!(
        md_files(&alice_folder),
        vec!["Alice one.md", "Alice two.md", "Alice web.md"]
    );
    assert_eq!(md_files(&bob_folder), vec!["Bob one.md"]);
    assert_eq!(titles(&b).await, vec!["Bob one"]);
    assert_eq!(bob_desk.titles(), vec!["Bob one"]);
    assert!(titles(&sneaky).await.is_empty());
    assert_eq!(
        alice_desk.titles(),
        vec!["Alice one", "Alice two", "Alice web"]
    );
    let entries: Vec<String> = std::fs::read_dir(vaults.path())
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(entries.len(), 2, "{entries:?}");
}

#[tokio::test]
async fn a_person_without_a_vault_folder_keeps_working_unsynced() {
    let vaults = tempfile::tempdir().unwrap();
    let server = start_with(Some(vaults.path().to_path_buf())).await;
    let a = Client::new(
        &server,
        Some(server.state.sessions.create(person("alice-sub"))),
    );
    let (status, _) = a
        .call("create_note", json!({ "input": { "body": "kept here" } }))
        .await;
    assert_eq!(status, 200);
    sync(&server).await;
    assert_eq!(titles(&a).await, vec!["kept here"]);
    assert!(server.state.libraries.open_vaults().is_empty());
    assert_eq!(std::fs::read_dir(vaults.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn edits_travel_both_ways_and_a_desktop_edit_reaches_the_open_page() {
    let vaults = tempfile::tempdir().unwrap();
    let folder = vaults.path().join("alice-sub");
    std::fs::create_dir_all(&folder).unwrap();
    let titles_in: Vec<String> = (1..=20).map(|i| format!("Desk {i:02}")).collect();
    let refs: Vec<&str> = titles_in.iter().map(String::as_str).collect();
    let mut desk = Desk::new(&folder, &refs);
    desk.sync();

    let server = start_with(Some(vaults.path().to_path_buf())).await;
    let a = Client::new(
        &server,
        Some(server.state.sessions.create(person("alice-sub"))),
    );
    let (status, notes) = a.call("list_notes", json!({})).await;
    assert_eq!(status, 200);
    let notes = notes.as_array().unwrap().clone();
    assert_eq!(notes.len(), 20);
    let pick = |title: &str| {
        notes.iter().find(|n| n["title"] == title).unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string()
    };
    let (web_id, desk_id) = (pick("Desk 01"), pick("Desk 02"));

    let (status, _) = a
        .call(
            "update_note",
            json!({ "id": web_id, "patch": { "body": "edited in the browser" } }),
        )
        .await;
    assert_eq!(status, 200);
    sync(&server).await;
    let file = std::fs::read_to_string(folder.join("Desk 01.md")).unwrap();
    assert!(file.contains("edited in the browser"), "{file}");
    desk.sync();
    assert_eq!(
        desk.store
            .lock()
            .unwrap()
            .get_note(&web_id, false)
            .unwrap()
            .body,
        "edited in the browser"
    );

    let mut stream = a.get("/api/events").await;
    assert_eq!(stream.status(), 200);
    desk.store
        .lock()
        .unwrap()
        .update_note(
            &desk_id,
            UpdateNotePatch {
                body: Some("edited on the desktop".into()),
                ..Default::default()
            },
        )
        .unwrap();
    desk.sync();
    tokio::time::sleep(Duration::from_millis(5100)).await;
    sync(&server).await;
    let mut seen = String::new();
    while !seen.contains("event: vault:synced") {
        let chunk = tokio::time::timeout(Duration::from_secs(2), stream.chunk())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        seen.push_str(&String::from_utf8_lossy(&chunk));
    }
    assert!(seen.contains(&desk_id), "{seen}");
    let (_, note) = a.call("get_note", json!({ "id": desk_id })).await;
    assert_eq!(note["body"], "edited on the desktop");
}
