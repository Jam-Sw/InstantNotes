use instantnotes_core::sync::crypto::{join_words, JoinKey, LibraryKey, Lock};
use instantnotes_core::sync::cycle::{ServerSync, SyncReport, ENCRYPTED};
use instantnotes_core::types::*;
use instantnotes_core::Store;
use instantnotes_server::client::{pkce, Client, Connection, JoinAnswer};
use reqwest::header::{COOKIE, LOCATION, SET_COOKIE};
use std::collections::BTreeMap;
use std::sync::Mutex;

const REDIRECT: &str = "http://127.0.0.1:9/callback";

struct Setup {
    server: String,
    user: String,
    password: String,
    data: String,
}

fn setup() -> Setup {
    let var = |name: &str| std::env::var(name).unwrap_or_else(|_| panic!("{name} is not set"));
    Setup {
        server: var("INSTANTNOTES_E2E_URL"),
        user: var("INSTANTNOTES_E2E_USER"),
        password: var("INSTANTNOTES_E2E_PASSWORD"),
        data: var("INSTANTNOTES_E2E_DATA"),
    }
}

fn hidden(html: &str, name: &str) -> Option<String> {
    let at = html.find(&format!("name=\"{name}\" value=\""))?;
    let rest = &html[at + name.len() + 15..];
    Some(rest[..rest.find('"')?].to_string())
}

fn form_action(html: &str) -> Option<String> {
    let at = html.find("<form")?;
    let rest = &html[at..];
    let start = rest.find("action=\"")? + 8;
    let end = rest[start..].find('"')? + start;
    Some(rest[start..end].replace("&amp;", "&"))
}

fn resolve(base: &reqwest::Url, target: &str) -> reqwest::Url {
    base.join(target).unwrap()
}

async fn sign_in(s: &Setup, device: &str) -> String {
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let client = Client::new(&s.server).unwrap();
    let codes = pkce();
    let server = reqwest::Url::parse(&s.server).unwrap();
    let mut jar: BTreeMap<String, String> = BTreeMap::new();
    let mut url = reqwest::Url::parse(&client.authorize_url(
        REDIRECT,
        &codes.state,
        &codes.challenge,
        device,
    ))
    .unwrap();
    let mut form: Option<Vec<(String, String)>> = None;
    for _ in 0..30 {
        let ours = url.origin() == server.origin();
        let mut request = match form.take() {
            Some(fields) => http.post(url.clone()).form(&fields),
            None => http.get(url.clone()),
        };
        if ours && !jar.is_empty() {
            let cookies: Vec<String> = jar.iter().map(|(k, v)| format!("{k}={v}")).collect();
            request = request.header(COOKIE, cookies.join("; "));
        }
        let response = request.send().await.unwrap();
        if ours {
            for value in response.headers().get_all(SET_COOKIE) {
                let pair = value.to_str().unwrap().split(';').next().unwrap();
                if let Some((k, v)) = pair.split_once('=') {
                    jar.insert(k.trim().to_string(), v.trim().to_string());
                }
            }
        }
        if response.status().is_redirection() {
            let target = response.headers()[LOCATION].to_str().unwrap().to_string();
            if target.starts_with(REDIRECT) {
                let query = reqwest::Url::parse(&target).unwrap();
                let pairs: BTreeMap<String, String> = query.query_pairs().into_owned().collect();
                assert_eq!(pairs.get("state"), Some(&codes.state));
                let code = pairs.get("code").expect("no code in the callback");
                return client
                    .exchange(code, &codes.verifier, REDIRECT)
                    .await
                    .unwrap()
                    .token;
            }
            url = resolve(&url, &target);
            continue;
        }
        let page_url = url.clone();
        let html = response.text().await.unwrap();
        if html.contains("name=\"password\"") {
            url = resolve(&page_url, &form_action(&html).expect("login form"));
            form = Some(vec![
                ("login".into(), s.user.clone()),
                ("password".into(), s.password.clone()),
            ]);
        } else if html.contains("/sync/v1/device/allow") {
            url = resolve(&page_url, "/sync/v1/device/allow");
            form = Some(vec![
                ("request".into(), hidden(&html, "request").unwrap()),
                ("csrf".into(), hidden(&html, "csrf").unwrap()),
                ("decision".into(), "allow".into()),
            ]);
        } else {
            panic!(
                "unexpected page at {page_url}: {}",
                &html[..html.len().min(400)]
            );
        }
    }
    panic!("sign-in did not finish");
}

struct Device {
    store: Mutex<Store>,
    sync: ServerSync<Connection>,
    runtime: tokio::runtime::Handle,
}

fn device(s: &Setup, runtime: &tokio::runtime::Runtime, token: &str, lock: Lock) -> Device {
    let client = Client::new(&s.server).unwrap().with_token(token);
    let mut store = Store::open_in_memory().unwrap();
    store.begin_server_sync().unwrap();
    Device {
        store: Mutex::new(store),
        sync: ServerSync::new(Connection::new(client, 64 * 1024 * 1024), lock, None),
        runtime: runtime.handle().clone(),
    }
}

impl Device {
    fn cycle(&mut self) -> SyncReport {
        self.runtime.block_on(self.sync.cycle(&self.store))
    }

    fn sync(&mut self) -> SyncReport {
        let mut report = self.cycle();
        for _ in 0..3 {
            if !report.retry {
                break;
            }
            report = self.cycle();
        }
        assert!(report.errors.is_empty(), "sync errors: {:?}", report.errors);
        assert!(report.unreachable.is_none(), "{:?}", report.unreachable);
        report
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

    fn edit(&self, id: &str, body: &str) {
        self.store
            .lock()
            .unwrap()
            .update_note(
                id,
                UpdateNotePatch {
                    body: Some(body.into()),
                    ..Default::default()
                },
            )
            .unwrap();
    }

    fn bodies(&self) -> Vec<String> {
        self.store
            .lock()
            .unwrap()
            .list_notes(NoteFilter {
                limit: Some(5000),
                ..Default::default()
            })
            .unwrap()
            .into_iter()
            .map(|n| n.body)
            .collect()
    }
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    needle.is_empty() || haystack.windows(needle.len()).any(|w| w == needle)
}

fn files_holding(dir: &std::path::Path, needle: &[u8]) -> Vec<String> {
    let mut found = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return found;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            found.extend(files_holding(&path, needle));
        } else if std::fs::read(&path).is_ok_and(|bytes| contains(&bytes, needle)) {
            found.push(path.display().to_string());
        }
    }
    found
}

#[test]
#[ignore = "needs the server image and an identity provider; run through the e2e script"]
fn two_desktops_share_one_encrypted_library_through_the_real_server() {
    let s = setup();
    let runtime = tokio::runtime::Runtime::new().unwrap();

    let token_a = runtime.block_on(sign_in(&s, "Laptop"));
    let key = LibraryKey::generate();
    let setup_client = Client::new(&s.server).unwrap().with_token(&token_a);
    runtime
        .block_on(setup_client.set_keys(ENCRYPTED, Some(&key.recipient())))
        .unwrap();
    let mut a = device(
        &s,
        &runtime,
        &token_a,
        Lock::Encrypted(LibraryKey::from_recovery(&key.recovery()).unwrap()),
    );

    let token_b = runtime.block_on(sign_in(&s, "Desktop"));
    let b_client = Client::new(&s.server).unwrap().with_token(&token_b);
    let joining = JoinKey::generate();
    let named = runtime
        .block_on(b_client.keys())
        .unwrap()
        .recipient
        .unwrap();
    let id = runtime
        .block_on(b_client.request_join(&joining.public(), "Desktop"))
        .unwrap();
    let pending = runtime.block_on(setup_client.pending_joins(0)).unwrap();
    let request = pending.iter().find(|j| j.id == id).unwrap();
    assert_eq!(
        join_words(&request.public_key, &key.recipient()),
        join_words(&joining.public(), &named)
    );
    runtime
        .block_on(setup_client.answer_join(&id, Some(&key.wrap_for(&request.public_key).unwrap())))
        .unwrap();
    let wrapped = match runtime.block_on(b_client.join_answer(&id, 5)).unwrap() {
        JoinAnswer::Approved { key } => key,
        other => panic!("not approved: {other:?}"),
    };
    let b_key = joining.unwrap(&wrapped, &named).unwrap();
    let mut b = device(&s, &runtime, &token_b, Lock::Encrypted(b_key));

    let from_a = a.create("From the laptop", "e2e-marker written on the laptop");
    b.create("From the desktop", "e2e-marker written on the desktop");
    a.sync();
    b.sync();
    a.sync();
    for d in [&a, &b] {
        let bodies = d.bodies();
        assert!(
            bodies.contains(&"e2e-marker written on the laptop".to_string()),
            "{bodies:?}"
        );
        assert!(
            bodies.contains(&"e2e-marker written on the desktop".to_string()),
            "{bodies:?}"
        );
    }

    let offline_client = Client::new("http://127.0.0.1:9")
        .unwrap()
        .with_token(&token_b);
    let real = std::mem::replace(
        &mut b.sync,
        ServerSync::new(
            Connection::new(offline_client, 64 * 1024 * 1024),
            Lock::Plain,
            None,
        ),
    );
    b.edit(&from_a.id, "e2e-marker edited while offline");
    assert!(b.cycle().unreachable.is_some());
    b.sync = real;
    b.sync();
    a.sync();
    assert!(a
        .bodies()
        .contains(&"e2e-marker edited while offline".to_string()));

    a.edit(&from_a.id, "e2e-marker the laptop's version");
    b.edit(&from_a.id, "e2e-marker the desktop's version");
    a.sync();
    b.sync();
    a.sync();
    for d in [&a, &b] {
        let bodies = d.bodies();
        assert!(
            bodies.contains(&"e2e-marker the laptop's version".to_string()),
            "{bodies:?}"
        );
        assert!(
            bodies.contains(&"e2e-marker the desktop's version".to_string()),
            "{bodies:?}"
        );
    }

    let stored = files_holding(std::path::Path::new(&s.data).join("sync").as_path(), b"");
    assert!(
        stored.iter().filter(|p| p.contains("/blobs/")).count() >= 4,
        "the server stored too little to check: {stored:?}"
    );
    let leaked = files_holding(std::path::Path::new(&s.data), b"e2e-marker");
    assert!(
        leaked.is_empty(),
        "note text on the server's disk: {leaked:?}"
    );
    let titles = files_holding(std::path::Path::new(&s.data), b"From the laptop");
    assert!(
        titles.is_empty(),
        "a title on the server's disk: {titles:?}"
    );
    if let Ok(path) = std::env::var("INSTANTNOTES_E2E_KEYFILE") {
        std::fs::write(path, key.recovery()).unwrap();
    }
}

#[test]
#[ignore = "runs after the browser step of the e2e script"]
fn a_note_written_in_the_browser_reaches_a_desktop() {
    let s = setup();
    let recovery =
        std::fs::read_to_string(std::env::var("INSTANTNOTES_E2E_KEYFILE").unwrap()).unwrap();
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let token = runtime.block_on(sign_in(&s, "Third desktop"));
    let mut c = device(
        &s,
        &runtime,
        &token,
        Lock::Encrypted(LibraryKey::from_recovery(&recovery).unwrap()),
    );
    c.sync();
    let bodies = c.bodies();
    assert!(
        bodies.contains(&"e2e-marker written in the browser".to_string()),
        "{bodies:?}"
    );
    let leaked = files_holding(std::path::Path::new(&s.data), b"e2e-marker");
    assert!(
        leaked.is_empty(),
        "note text on the server's disk: {leaked:?}"
    );
}
