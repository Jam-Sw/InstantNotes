use instantnotes_core::sync::remote::RemoteOp;
use instantnotes_server::client::Client;
use instantnotes_server::operators::{check, usage};
use instantnotes_server::{AppState, Config, PeopleDir, Person};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::Duration;

struct Server {
    base: String,
    state: AppState,
    root: PathBuf,
    _dir: tempfile::TempDir,
}

fn template(root: &Path) -> PeopleDir {
    PeopleDir::parse(&format!("{}/people/{{username}}/notes", root.display())).unwrap()
}

async fn start(people: bool, stylesheet: Option<&str>) -> Server {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("root");
    std::fs::create_dir_all(&root).unwrap();
    let config = Config {
        listen: "127.0.0.1:0".parse().unwrap(),
        data_dir: root.join("data"),
        public_url: "http://localhost:8080".into(),
        oidc_issuer: "http://127.0.0.1:9".into(),
        oidc_client_id: "client".into(),
        oidc_client_secret: "secret".into(),
        ui_dir: root.join("ui"),
        idle_close: Duration::from_secs(600),
        session_ttl: Duration::from_secs(3600),
        trust_proxy: false,
        max_object_bytes: 1024 * 1024,
        people_dir: people.then(|| template(&root)),
        sign_in_stylesheet: stylesheet.map(Into::into),
    };
    let state = AppState::new(config).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let app = instantnotes_server::app(state.clone());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Server {
        base,
        state,
        root,
        _dir: dir,
    }
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

fn sha(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

impl Server {
    async fn push(&self, sub: &str, username: &str, blobs: &[&[u8]]) {
        let person = Person {
            sub: sub.into(),
            name: None,
            email: Some(format!("{username}@example.org")),
        };
        self.state
            .sessions
            .record_person(sub, Some(username), person.email.as_deref(), now());
        let (_, token) = self.state.sessions.create_device(&person, "Laptop", now());
        let client = Client::new(&self.base).unwrap().with_token(&token);
        client.set_keys("plain", None).await.unwrap();
        let sent: Vec<(String, Vec<u8>)> = blobs.iter().map(|b| (sha(b), b.to_vec())).collect();
        client.upload(&sent).await.unwrap();
        let ops: Vec<RemoteOp> = sent
            .iter()
            .enumerate()
            .map(|(i, (s, _))| RemoteOp {
                name: sha(&[i as u8]),
                base: None,
                sha: Some(s.clone()),
            })
            .collect();
        let epoch = client.keys().await.unwrap().epoch;
        client.commit(epoch, &ops, false).await.unwrap();
    }

    fn template(&self) -> Option<PeopleDir> {
        self.state.config.people_dir.clone()
    }
}

fn files_under(dir: &Path) -> Vec<(PathBuf, u64)> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let meta = entry.metadata().unwrap();
        if meta.is_dir() {
            out.extend(files_under(&entry.path()));
        } else {
            out.push((entry.path(), meta.len()));
        }
    }
    out
}

#[tokio::test(flavor = "multi_thread")]
async fn usage_prints_one_row_per_person_from_their_own_folder() {
    let server = start(true, None).await;
    server.push("sub-a", "alice", &[b"one", b"two"]).await;
    server.push("sub-b", "bob", &[b"three"]).await;
    let rows = usage(&server.state.config.data_dir, server.template()).unwrap();
    assert_eq!(rows.len(), 2);
    for (row, username, blobs) in [(&rows[0], "alice", 2), (&rows[1], "bob", 1)] {
        let folder = server.root.join("people").join(username).join("notes");
        assert_eq!(row.username.as_deref(), Some(username));
        assert_eq!(row.folder, folder.display().to_string());
        assert_eq!(row.blobs, blobs);
        assert_eq!(row.objects, blobs);
        let on_disk: u64 = files_under(&folder).iter().map(|(_, n)| n).sum();
        assert_eq!(row.bytes, on_disk);
        assert!(row.last_seen.is_some());
    }
    assert!(!server
        .state
        .config
        .data_dir
        .join("sync")
        .join("sub-a")
        .exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn check_proves_the_sync_path_and_leaves_nothing_behind() {
    let server = start(true, None).await;
    let data = server.state.config.data_dir.clone();
    for _ in 0..2 {
        let done = check(&data, server.template(), &server.base).await.unwrap();
        let steps: Vec<&str> = done.iter().map(|(name, _)| *name).collect();
        for step in [
            "token", "keys", "commit", "changes", "decrypt", "stored", "cleanup",
        ] {
            assert!(steps.contains(&step), "{step} in {steps:?}");
        }
    }
    assert!(!server.root.join("people/instantnotes-check").exists());
    assert!(server.root.join("people").exists());
    assert!(server.state.sessions.list("instantnotes-check").is_empty());
    assert!(usage(&data, server.template()).unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn check_names_the_step_that_failed() {
    let server = start(false, None).await;
    let data = server.state.config.data_dir.clone();
    let failed = check(&data, None, "http://127.0.0.1:9").await.unwrap_err();
    assert_eq!(failed.0, "info");
    assert!(server.state.sessions.list("instantnotes-check").is_empty());
    assert!(!data.join("sync/instantnotes-check").exists());
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn a_full_sync_writes_only_under_the_data_and_people_folders() {
    use std::os::unix::fs::PermissionsExt;
    let server = start(true, None).await;
    std::fs::create_dir_all(server.root.join("people")).unwrap();
    let before: Vec<PathBuf> = std::fs::read_dir(&server.root)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    std::fs::set_permissions(&server.root, std::fs::Permissions::from_mode(0o555)).unwrap();
    server.push("sub-a", "alice", &[b"note"]).await;
    let checked = check(
        &server.state.config.data_dir,
        server.template(),
        &server.base,
    )
    .await;
    let after: Vec<PathBuf> = std::fs::read_dir(&server.root)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    std::fs::set_permissions(&server.root, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(checked.is_ok(), "{checked:?}");
    assert_eq!(before, after);
}

#[tokio::test]
async fn the_sign_in_page_links_the_operators_stylesheet_under_a_policy_naming_only_its_origin() {
    let server = start(false, Some("https://brand.example.org/sign-in.css")).await;
    let home = reqwest::get(format!("{}/", server.base)).await.unwrap();
    let policy = home
        .headers()
        .get("content-security-policy")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    assert!(policy.contains("style-src 'unsafe-inline' https://brand.example.org;"));
    let page = home.text().await.unwrap();
    assert!(page.contains(
        r#"<link rel="stylesheet" href="https://brand.example.org/sign-in.css"></head>"#
    ));

    let plain = start(false, None).await;
    let home = reqwest::get(format!("{}/", plain.base)).await.unwrap();
    let policy = home.headers()["content-security-policy"]
        .to_str()
        .unwrap()
        .to_string();
    assert!(policy.contains("style-src 'unsafe-inline';"));
    assert!(!home.text().await.unwrap().contains("rel=\"stylesheet\""));
}
