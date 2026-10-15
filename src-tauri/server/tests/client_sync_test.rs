use instantnotes_core::sync::crypto::{LibraryKey, Lock};
use instantnotes_core::sync::cycle::ServerSync;
use instantnotes_core::types::*;
use instantnotes_core::Store;
use instantnotes_server::client::{Client, Connection};
use instantnotes_server::{AppState, Config, Person};
use std::sync::Mutex;
use std::time::Duration;

struct Server {
    base: String,
    state: AppState,
    _dir: tempfile::TempDir,
    _runtime: tokio::runtime::Runtime,
}

fn start() -> Server {
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
        max_object_bytes: 1024 * 1024,
        people_dir: None,
        sign_in_stylesheet: None,
    };
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let state = AppState::new(config).unwrap();
    let listener = runtime
        .block_on(tokio::net::TcpListener::bind("127.0.0.1:0"))
        .unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let app = instantnotes_server::app(state.clone());
    runtime.spawn(async move { axum::serve(listener, app).await.unwrap() });
    Server {
        base,
        state,
        _dir: dir,
        _runtime: runtime,
    }
}

struct Device {
    store: Mutex<Store>,
    sync: ServerSync<Connection>,
    runtime: tokio::runtime::Handle,
}

impl Server {
    fn device(&self, recovery: &str) -> Device {
        let person = Person {
            sub: "alice".into(),
            name: None,
            email: None,
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        self.state
            .sessions
            .set_refresh("alice", Some(b"sealed"), now);
        let (_, token) = self.state.sessions.create_device(&person, "Laptop", now);
        let client = Client::new(&self.base).unwrap().with_token(&token);
        let remote = Connection::new(client, 1024 * 1024);
        let mut store = Store::open_in_memory().unwrap();
        store.begin_server_sync().unwrap();
        Device {
            store: Mutex::new(store),
            sync: ServerSync::new(
                remote,
                Lock::Encrypted(LibraryKey::from_recovery(recovery).unwrap()),
                None,
            ),
            runtime: self._runtime.handle().clone(),
        }
    }
}

impl Device {
    fn sync(&mut self) {
        let report = self.runtime.block_on(self.sync.cycle(&self.store));
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert!(report.reached(), "{:?}", report.unreachable);
    }

    fn create(&self, title: &str, body: &str) -> Note {
        self.store
            .lock()
            .unwrap()
            .create_note(CreateNoteInput {
                title: Some(title.into()),
                body: Some(body.into()),
                ..Default::default()
            })
            .unwrap()
    }

    fn body(&self, id: &str) -> String {
        self.store.lock().unwrap().get_note(id, false).unwrap().body
    }
}

#[test]
fn two_devices_sync_one_encrypted_library_through_the_real_server() {
    let server = start();
    let key = LibraryKey::generate();
    let recovery = key.recovery();
    let mut laptop = server.device(&recovery);
    laptop
        .runtime
        .block_on(
            laptop
                .sync
                .remote
                .client
                .set_keys("encrypted", Some(&key.recipient())),
        )
        .unwrap();
    let mut desktop = server.device(&recovery);
    let from_laptop = laptop.create("From the laptop", "written on the laptop");
    laptop.sync();
    desktop.sync();
    assert_eq!(desktop.body(&from_laptop.id), "written on the laptop");
    let from_desktop = desktop.create("From the desktop", "written on the desktop");
    desktop.sync();
    laptop.sync();
    assert_eq!(laptop.body(&from_desktop.id), "written on the desktop");
    let data = server._dir.path().join("data").join("sync");
    for entry in walk(&data) {
        let bytes = std::fs::read(&entry).unwrap();
        assert!(
            !bytes.windows(7).any(|w| w == b"written"),
            "{}",
            entry.display()
        );
    }
}

#[test]
fn many_notes_travel_in_few_requests() {
    let server = start();
    let key = LibraryKey::generate();
    let recovery = key.recovery();
    let mut first = server.device(&recovery);
    first
        .runtime
        .block_on(
            first
                .sync
                .remote
                .client
                .set_keys("encrypted", Some(&key.recipient())),
        )
        .unwrap();
    for n in 0..1100 {
        first.create(&format!("Note {n}"), &format!("body {n}"));
    }
    first.sync();
    let mut second = server.device(&recovery);
    second.sync();
    let count = second
        .store
        .lock()
        .unwrap()
        .count_notes(&NoteFilter::default())
        .unwrap();
    assert_eq!(count, 1100);
}

fn walk(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                out.extend(walk(&path));
            } else {
                out.push(path);
            }
        }
    }
    out
}
