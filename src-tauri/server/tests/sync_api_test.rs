use instantnotes_server::{AppState, Config, Person};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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
        vault_root: None,
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

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

fn sha(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[derive(Clone)]
struct Device {
    base: String,
    token: String,
    http: reqwest::Client,
}

impl Server {
    fn device(&self, sub: &str, name: &str) -> Device {
        let person = Person {
            sub: sub.into(),
            name: None,
            email: None,
        };
        self.state.sessions.set_refresh(sub, Some(b"sealed"), now());
        let (_, token) = self.state.sessions.create_device(&person, name, now());
        Device {
            base: self.base.clone(),
            token,
            http: reqwest::Client::new(),
        }
    }
}

impl Device {
    fn url(&self, path: &str) -> String {
        format!("{}/sync/v1/{path}", self.base)
    }

    async fn get(&self, path: &str) -> reqwest::Response {
        self.http
            .get(self.url(path))
            .bearer_auth(&self.token)
            .send()
            .await
            .unwrap()
    }

    async fn post(&self, path: &str, body: Value) -> reqwest::Response {
        self.http
            .post(self.url(path))
            .bearer_auth(&self.token)
            .json(&body)
            .send()
            .await
            .unwrap()
    }

    async fn upload(&self, bytes: &[u8]) -> String {
        let s = sha(bytes);
        let r = self
            .http
            .put(self.url(&format!("blobs/{s}")))
            .bearer_auth(&self.token)
            .body(bytes.to_vec())
            .send()
            .await
            .unwrap();
        assert!(r.status().is_success(), "upload {}", r.status());
        s
    }

    async fn commit(&self, ops: Value) -> reqwest::Response {
        self.post("commit", json!({ "epoch": 1, "ops": ops })).await
    }

    async fn changes(&self, since: i64) -> Value {
        self.get(&format!("changes?since={since}"))
            .await
            .json()
            .await
            .unwrap()
    }
}

fn name(n: u8) -> String {
    sha(&[n])
}

#[tokio::test]
async fn info_answers_without_signing_in_and_everything_else_needs_a_pass() {
    let server = start().await;
    let http = reqwest::Client::new();
    let info: Value = http
        .get(format!("{}/sync/v1/info", server.base))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(info["app"], "instantnotes");
    assert_eq!(info["api"], 1);
    for path in ["changes", "keys", "devices", "keys/requests"] {
        let r = http
            .get(format!("{}/sync/v1/{path}", server.base))
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 401, "{path}");
        let r = http
            .get(format!("{}/sync/v1/{path}", server.base))
            .bearer_auth("ins_forged")
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 401, "{path}");
    }
    let session = server.state.sessions.create(Person {
        sub: "alice".into(),
        name: None,
        email: None,
    });
    let cookie = format!("in_session={session}");
    let without_header = http
        .get(format!("{}/sync/v1/changes", server.base))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(without_header.status(), 401);
    let with_header = http
        .get(format!("{}/sync/v1/changes", server.base))
        .header("cookie", &cookie)
        .header("x-instantnotes", "1")
        .send()
        .await
        .unwrap();
    assert_eq!(with_header.status(), 200);
}

#[tokio::test]
async fn a_device_uploads_commits_and_another_catches_up() {
    let server = start().await;
    let laptop = server.device("alice", "Laptop");
    let desktop = server.device("alice", "Desktop");
    let note = laptop.upload(b"ciphertext of a note").await;
    let missing: Value = laptop
        .post("blobs/missing", json!({ "shas": [note, sha(b"absent")] }))
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(missing["missing"], json!([sha(b"absent")]));
    let r = laptop
        .commit(json!([{ "name": name(1), "base": null, "sha": note }]))
        .await;
    assert_eq!(r.status(), 200);
    let seen = desktop.changes(0).await;
    assert_eq!(seen["head"], 1);
    assert_eq!(seen["changes"][0]["name"], name(1));
    let fetched = desktop.get(&format!("blobs/{note}")).await;
    assert_eq!(
        fetched.bytes().await.unwrap().as_ref(),
        b"ciphertext of a note"
    );
    let stale = desktop
        .commit(json!([{ "name": name(1), "base": null, "sha": note }]))
        .await;
    assert_eq!(stale.status(), 409);
    let body: Value = stale.json().await.unwrap();
    assert_eq!(body["conflicts"][0]["current"], json!(note));
    let gone = desktop.get("changes?since=99").await;
    assert_eq!(gone.status(), 410);
}

#[tokio::test]
async fn an_upload_that_lies_about_its_hash_or_size_is_refused() {
    let server = start().await;
    let d = server.device("alice", "Laptop");
    let lie = d
        .http
        .put(d.url(&format!("blobs/{}", sha(b"claimed"))))
        .bearer_auth(&d.token)
        .body(b"actual".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(lie.status(), 400);
    let big = vec![7u8; 5000];
    let too_big = d
        .http
        .put(d.url(&format!("blobs/{}", sha(&big))))
        .bearer_auth(&d.token)
        .body(big)
        .send()
        .await
        .unwrap();
    assert_eq!(too_big.status(), 413);
    let bad_name = d
        .commit(json!([{ "name": "../../escape", "base": null, "sha": null }]))
        .await;
    assert_eq!(bad_name.status(), 400);
}

#[tokio::test]
async fn a_waiting_device_wakes_when_another_commits() {
    let server = start().await;
    let a = server.device("alice", "A");
    let b = server.device("alice", "B");
    let waiting = tokio::spawn({
        let b = b.clone();
        async move {
            let started = std::time::Instant::now();
            let seen = b
                .get("changes?since=0&wait=20")
                .await
                .json::<Value>()
                .await
                .unwrap();
            (started.elapsed(), seen)
        }
    });
    tokio::time::sleep(Duration::from_millis(300)).await;
    let blob = a.upload(b"x").await;
    a.commit(json!([{ "name": name(1), "base": null, "sha": blob }]))
        .await;
    let (took, seen) = waiting.await.unwrap();
    assert!(took < Duration::from_secs(5), "{took:?}");
    assert_eq!(seen["changes"][0]["name"], name(1));
}

#[tokio::test]
async fn a_new_device_gets_the_key_through_the_relay_only_once_approved() {
    let server = start().await;
    let old = server.device("alice", "Old laptop");
    let new = server.device("alice", "New laptop");
    let set = old
        .http
        .put(old.url("keys"))
        .bearer_auth(&old.token)
        .json(&json!({ "mode": "encrypted", "recipient": "age1library" }))
        .send()
        .await
        .unwrap();
    assert_eq!(set.status(), 200);
    let keys: Value = new.get("keys").await.json().await.unwrap();
    assert_eq!(keys["recipient"], "age1library");
    let id = new
        .post(
            "keys/requests",
            json!({ "publicKey": "age1temporary", "deviceName": "New laptop" }),
        )
        .await
        .json::<Value>()
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let pending: Value = old.get("keys/requests").await.json().await.unwrap();
    assert_eq!(pending[0]["publicKey"], "age1temporary");
    let still: Value = new
        .get(&format!("keys/requests/{id}"))
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(still["state"], "pending");
    let approve = old
        .post(
            &format!("keys/requests/{id}/approve"),
            json!({ "key": "age-encrypted-library-key" }),
        )
        .await;
    assert_eq!(approve.status(), 204);
    let answer: Value = new
        .get(&format!("keys/requests/{id}?wait=5"))
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(answer["state"], "approved");
    assert_eq!(answer["key"], "age-encrypted-library-key");
    assert_eq!(new.get(&format!("keys/requests/{id}")).await.status(), 404);
}

#[tokio::test]
async fn devices_are_listed_and_revoking_one_stops_it() {
    let server = start().await;
    let a = server.device("alice", "Laptop");
    let b = server.device("alice", "Phone");
    let list: Value = a.get("devices").await.json().await.unwrap();
    assert_eq!(list.as_array().unwrap().len(), 2);
    let phone = list
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["name"] == "Phone")
        .unwrap();
    assert_eq!(phone["current"], false);
    let r = a
        .http
        .delete(a.url(&format!("devices/{}", phone["id"].as_str().unwrap())))
        .bearer_auth(&a.token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 204);
    assert_eq!(b.get("changes").await.status(), 401);
    let everywhere = a
        .http
        .delete(a.url("devices"))
        .bearer_auth(&a.token)
        .send()
        .await
        .unwrap();
    assert_eq!(everywhere.status(), 204);
    assert_eq!(a.get("changes").await.status(), 401);
}

#[tokio::test]
async fn one_person_can_never_reach_anothers_notes_keys_requests_or_devices() {
    let server = start().await;
    let alice = server.device("alice", "Alice laptop");
    let mallory = server.device("mallory", "Mallory laptop");
    let note = alice.upload(b"alice's ciphertext").await;
    alice
        .commit(json!([{ "name": name(1), "base": null, "sha": note }]))
        .await;
    alice
        .http
        .put(alice.url("keys"))
        .bearer_auth(&alice.token)
        .json(&json!({ "mode": "encrypted", "recipient": "age1alice" }))
        .send()
        .await
        .unwrap();
    let request = alice
        .post(
            "keys/requests",
            json!({ "publicKey": "age1tmp", "deviceName": "Alice phone" }),
        )
        .await
        .json::<Value>()
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let alice_devices: Value = alice.get("devices").await.json().await.unwrap();
    let alice_device = alice_devices[0]["id"].as_str().unwrap().to_string();

    assert!(mallory.changes(0).await["changes"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(mallory.get(&format!("blobs/{note}")).await.status(), 404);
    let missing: Value = mallory
        .post("blobs/missing", json!({ "shas": [note] }))
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(missing["missing"], json!([note]));
    assert_eq!(
        mallory
            .commit(json!([{ "name": name(1), "base": null, "sha": note }]))
            .await
            .status(),
        400
    );
    let keys: Value = mallory.get("keys").await.json().await.unwrap();
    assert!(keys["recipient"].is_null());
    assert!(mallory
        .get("keys/requests")
        .await
        .json::<Value>()
        .await
        .unwrap()
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(
        mallory
            .post(
                &format!("keys/requests/{request}/approve"),
                json!({ "key": "stolen" })
            )
            .await
            .status(),
        404
    );
    assert_eq!(
        mallory
            .http
            .delete(mallory.url(&format!("devices/{alice_device}")))
            .bearer_auth(&mallory.token)
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    assert_eq!(alice.get("changes").await.status(), 200);
    assert_eq!(alice.changes(0).await["changes"][0]["sha"], json!(note));
    let stolen = mallory
        .http
        .post(mallory.url("blobs/fetch"))
        .bearer_auth(&mallory.token)
        .json(&json!({ "shas": [note] }))
        .send()
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    assert!(stolen.is_empty());
}

#[tokio::test]
async fn many_blobs_travel_in_one_request_each_way_and_a_lying_batch_is_refused() {
    use instantnotes_core::sync::frames;
    let server = start().await;
    let d = server.device("alice", "Laptop");
    let blobs: Vec<(String, Vec<u8>)> = (0..50u8)
        .map(|n| {
            let bytes = vec![n; 100];
            (sha(&bytes), bytes)
        })
        .collect();
    let body = frames::encode(blobs.iter().map(|(s, b)| (s.as_str(), b.as_slice()))).unwrap();
    let sent = d
        .http
        .post(d.url("blobs/batch"))
        .bearer_auth(&d.token)
        .body(body)
        .send()
        .await
        .unwrap();
    assert_eq!(sent.status(), 200);
    let shas: Vec<String> = blobs.iter().map(|(s, _)| s.clone()).collect();
    let back = d
        .http
        .post(d.url("blobs/fetch"))
        .bearer_auth(&d.token)
        .json(&json!({ "shas": shas }))
        .send()
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    assert_eq!(frames::decode(&back).unwrap(), blobs);
    let lie = frames::encode([(sha(b"claimed").as_str(), &b"actual"[..])]).unwrap();
    let refused = d
        .http
        .post(d.url("blobs/batch"))
        .bearer_auth(&d.token)
        .body(lie)
        .send()
        .await
        .unwrap();
    assert_eq!(refused.status(), 400);
    let garbage = d
        .http
        .post(d.url("blobs/batch"))
        .bearer_auth(&d.token)
        .body(vec![1, 2, 3])
        .send()
        .await
        .unwrap();
    assert_eq!(garbage.status(), 400);
}

fn person_index(server: &Server) -> std::path::PathBuf {
    let sync = server._dir.path().join("data").join("sync");
    let person = std::fs::read_dir(&sync)
        .unwrap()
        .flatten()
        .find(|e| e.path().is_dir())
        .unwrap();
    person.path().join("index.db")
}

#[tokio::test]
async fn a_join_request_expires_after_ten_minutes() {
    let server = start().await;
    let old = server.device("alice", "Old laptop");
    let new = server.device("alice", "New laptop");
    let id = new
        .post(
            "keys/requests",
            json!({ "publicKey": "age1temporary", "deviceName": "New laptop" }),
        )
        .await
        .json::<Value>()
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    rusqlite::Connection::open(person_index(&server))
        .unwrap()
        .execute("UPDATE joins SET created_at = created_at - 601", [])
        .unwrap();
    assert_eq!(new.get(&format!("keys/requests/{id}")).await.status(), 404);
    let approve = old
        .post(
            &format!("keys/requests/{id}/approve"),
            json!({ "key": "age-encrypted-library-key" }),
        )
        .await;
    assert_eq!(approve.status(), 404);
    let pending: Value = old.get("keys/requests").await.json().await.unwrap();
    assert_eq!(pending, json!([]));
}

#[tokio::test]
async fn a_switch_over_needs_a_complete_staging_and_an_unmoved_library() {
    let server = start().await;
    let a = server.device("alice", "Laptop");
    let b = server.device("alice", "Desktop");
    let set = a
        .http
        .put(a.url("keys"))
        .bearer_auth(&a.token)
        .json(&json!({ "mode": "plain" }))
        .send()
        .await
        .unwrap();
    assert_eq!(set.status(), 200);
    let plain = a.upload(b"plain note").await;
    let other = a.upload(b"other note").await;
    a.commit(json!([
        { "name": name(1), "base": null, "sha": plain },
        { "name": name(2), "base": null, "sha": other },
    ]))
    .await;
    let built_at = a.changes(0).await["head"].as_i64().unwrap();
    let sealed = a.upload(b"sealed note").await;
    let staged = a
        .post(
            "commit",
            json!({ "epoch": 2, "reset": true, "ops": [
                { "name": name(8), "base": null, "sha": sealed },
                { "name": name(9), "base": null, "sha": sealed },
            ] }),
        )
        .await;
    assert_eq!(staged.status(), 200);
    let wrong_epoch = a
        .post("commit", json!({ "epoch": 5, "ops": [] }))
        .await
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(wrong_epoch["code"], "WRONG_EPOCH");
    let switch = |expected: usize, built: i64| {
        json!({ "fromEpoch": 1, "builtAt": built, "mode": "encrypted",
                "recipient": "age1library", "expected": expected })
    };
    let short = a.post("switch", switch(1, built_at + 1)).await;
    assert_eq!(short.status(), 409);
    assert_eq!(short.json::<Value>().await.unwrap()["code"], "INCOMPLETE");
    let edit = b.upload(b"edited meanwhile").await;
    b.commit(json!([{ "name": name(1), "base": plain, "sha": edit }]))
        .await;
    let moved = a.post("switch", switch(2, built_at + 1)).await;
    assert_eq!(moved.status(), 409);
    assert_eq!(moved.json::<Value>().await.unwrap()["code"], "CONFLICT");
    let caught_up = a.changes(0).await["head"].as_i64().unwrap();
    let done = a.post("switch", switch(2, caught_up)).await;
    assert_eq!(done.status(), 200);
    assert_eq!(done.json::<Value>().await.unwrap()["epoch"], 2);
    let keys: Value = b.get("keys").await.json().await.unwrap();
    assert_eq!(
        (keys["mode"].clone(), keys["recipient"].clone()),
        (json!("encrypted"), json!("age1library"))
    );
    let now = b.changes(0).await;
    assert_eq!(now["epoch"], 2);
    assert_eq!(now["changes"].as_array().unwrap().len(), 2);
    let gone = b.post("blobs/fetch", json!({ "shas": [edit] })).await;
    assert!(gone.bytes().await.unwrap().len() < 8);
}

#[tokio::test]
async fn an_old_web_library_is_handed_to_its_owner_only_and_then_deleted() {
    let server = start().await;
    let alice = server.device("alice", "Laptop");
    let bob = server.device("bob", "Laptop");
    assert_eq!(alice.get("legacy").await.status(), 404);
    server
        .state
        .libraries
        .with("alice", |lib| {
            lib.store
                .create_note(instantnotes_core::types::CreateNoteInput {
                    title: Some("Old".into()),
                    body: Some("from the old web version".into()),
                    ..Default::default()
                })?;
            std::fs::write(lib.attachments.join("a1.png"), b"image").unwrap();
            Ok(())
        })
        .unwrap();
    let exported: Value = alice.get("legacy").await.json().await.unwrap();
    assert!(exported["notes"][0]["md"]
        .as_str()
        .unwrap()
        .contains("from the old web version"));
    assert_eq!(exported["attachments"], json!(["a1.png"]));
    let image = alice.get("legacy/attachments/a1.png").await;
    assert_eq!(image.bytes().await.unwrap().as_ref(), b"image");
    assert_eq!(bob.get("legacy").await.status(), 404);
    assert_eq!(bob.get("legacy/attachments/a1.png").await.status(), 404);
    assert_eq!(
        alice
            .get("legacy/attachments/..%2Flibrary.db")
            .await
            .status(),
        404
    );
    let removed = alice
        .http
        .delete(alice.url("legacy"))
        .bearer_auth(&alice.token)
        .send()
        .await
        .unwrap();
    assert_eq!(removed.status(), 204);
    assert_eq!(alice.get("legacy").await.status(), 404);
}
