#![cfg(target_family = "wasm")]

mod remote;

use instantnotes_core::attachments::Attachments;
use instantnotes_core::commands;
use instantnotes_core::sync::crypto::{join_words, JoinKey, LibraryKey, Lock};
use instantnotes_core::sync::cycle::{ModeCheck, ServerSync, SyncReport, ENCRYPTED, PLAIN};
use instantnotes_core::sync::remote::{Remote, RemoteError};
use instantnotes_core::{AppError, Store};
use remote::Fetch;
use serde_json::{json, Value};
use sqlite_wasm_vfs::sahpool::{install, OpfsSAHPoolCfg};
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use wasm_bindgen::prelude::*;

const DATABASE: &str = "/instantnotes.db";

static STORE: OnceLock<Mutex<Store>> = OnceLock::new();
static JOINING: Mutex<Option<JoinKey>> = Mutex::new(None);

fn fail(message: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&message.to_string())
}

fn app_error(e: AppError) -> JsValue {
    js_sys::JSON::parse(&json!({ "code": e.code(), "message": e.to_string() }).to_string())
        .unwrap_or_else(|_| fail(e))
}

fn store() -> Result<&'static Mutex<Store>, JsValue> {
    STORE.get().ok_or_else(|| fail("the library is not open"))
}

fn with<T>(f: impl FnOnce(&mut Store) -> Result<T, AppError>) -> Result<T, JsValue> {
    let mut guard = store()?
        .lock()
        .map_err(|_| fail("the library is unavailable"))?;
    f(&mut guard).map_err(app_error)
}

fn library_key(recovery: Option<&str>) -> Result<Option<LibraryKey>, JsValue> {
    recovery
        .map(LibraryKey::from_recovery)
        .transpose()
        .map_err(fail)
}

#[wasm_bindgen]
pub async fn open() -> Result<(), JsValue> {
    console_error_panic_hook::set_once();
    if STORE.get().is_some() {
        return Ok(());
    }
    install::<sqlite_wasm_rs::WasmOsCallback>(&OpfsSAHPoolCfg::default(), true)
        .await
        .map_err(|e| fail(format!("cannot open this browser's storage: {e:?}")))?;
    let mut opened = Store::open(Path::new(DATABASE)).map_err(app_error)?;
    if opened.sync_state().map_err(app_error)?.library_id.is_none() {
        opened.begin_server_sync().map_err(app_error)?;
    }
    let _ = STORE.set(Mutex::new(opened));
    Ok(())
}

#[wasm_bindgen]
pub fn call(cmd: &str, args: &str, origin: Option<String>) -> Result<String, JsValue> {
    let args: Value = if args.is_empty() {
        Value::Null
    } else {
        serde_json::from_str(args).map_err(fail)?
    };
    let outcome =
        with(|s| commands::dispatch(s, &Attachments::Database, cmd, &args, origin.as_deref()))?;
    let changes: Vec<Value> = outcome
        .changes
        .iter()
        .map(|c| json!({ "event": c.event, "payload": c.payload }))
        .collect();
    Ok(json!({ "value": outcome.value, "changes": changes }).to_string())
}

#[wasm_bindgen]
pub fn save_attachment(bytes: &[u8], ext: &str) -> Result<String, JsValue> {
    let name = commands::attachment_name(ext).map_err(app_error)?;
    if bytes.is_empty() {
        return Err(app_error(AppError::Validation(
            "attachment is empty".into(),
        )));
    }
    with(|s| s.save_attachment_file(&name, bytes))?;
    Ok(name)
}

#[derive(serde::Deserialize)]
struct LegacyNote {
    md: String,
    surface: Option<String>,
}

#[derive(serde::Deserialize)]
struct Legacy {
    notes: Vec<LegacyNote>,
    manifest: String,
}

#[wasm_bindgen]
pub fn import_legacy(legacy: &str) -> Result<usize, JsValue> {
    let legacy: Legacy = serde_json::from_str(legacy).map_err(fail)?;
    let notes: Vec<(String, Option<String>)> = legacy
        .notes
        .into_iter()
        .map(|n| (n.md, n.surface))
        .collect();
    with(|s| s.import_legacy(&notes, Some(&legacy.manifest)))
}

#[wasm_bindgen]
pub fn import_attachment(name: &str, bytes: &[u8]) -> Result<bool, JsValue> {
    if !commands::valid_attachment_name(name) {
        return Ok(false);
    }
    with(|s| s.save_attachment_file(name, bytes))
}

#[wasm_bindgen]
pub fn export_archive() -> Result<Vec<u8>, JsValue> {
    with(|store| instantnotes_core::vault::export_archive(store))
}

#[wasm_bindgen]
pub fn attachment(name: &str) -> Result<Option<Vec<u8>>, JsValue> {
    if !commands::valid_attachment_name(name) {
        return Ok(None);
    }
    with(|s| s.attachment_file(name))
}

fn stopped(e: &RemoteError) -> Value {
    let stage = match e {
        RemoteError::SignedOut => "signedOut",
        RemoteError::Unreachable(_) => "offline",
        _ => "problem",
    };
    json!({ "stage": stage, "message": e.to_string() })
}

fn reported(report: &SyncReport) -> Value {
    let stage = if report.signed_out {
        "signedOut"
    } else if report.unreachable.is_some() {
        "offline"
    } else if report.held_removals > 0 {
        "held"
    } else if !report.errors.is_empty() {
        "problem"
    } else {
        "upToDate"
    };
    json!({
        "stage": stage,
        "message": report.unreachable.clone().or_else(|| report.errors.first().cloned()),
        "notes": report.notes,
        "labelsChanged": report.labels_changed,
        "settingsChanged": report.settings_changed,
        "conflicts": report.conflicts,
        "heldRemovals": report.held_removals,
        "tooLarge": report.too_large,
        "modeChanged": report.mode_changed,
        "retry": report.retry,
    })
}

#[wasm_bindgen]
pub async fn sync(
    recovery: Option<String>,
    allow_removals: bool,
    plain_ok: bool,
) -> Result<String, JsValue> {
    let key = library_key(recovery.as_deref())?;
    let mut remote = match Fetch::connect().await {
        Ok(r) => r,
        Err(e) => return Ok(stopped(&e).to_string()),
    };
    let keys = match remote.keys().await {
        Ok(k) => k,
        Err(e) => return Ok(stopped(&e).to_string()),
    };
    let state = with(|s| s.sync_state())?;
    if state
        .library_id
        .as_deref()
        .is_some_and(|id| id != keys.library_id)
    {
        return Ok(json!({ "stage": "otherLibrary" }).to_string());
    }
    let known = if state.library_id.is_some() {
        state.epoch
    } else {
        0
    };
    let mut probe = ServerSync::new(remote, Lock::Plain, Some(Attachments::Database));
    let held_key = key.is_some();
    let lock = match probe.check_mode(&keys, key.as_ref(), known).await {
        Ok(ModeCheck::Encrypted) => match key {
            Some(k) => Lock::Encrypted(k),
            None => return Ok(json!({ "stage": "needsKey" }).to_string()),
        },
        Ok(ModeCheck::Plain) if held_key || plain_ok => Lock::Plain,
        Ok(ModeCheck::Plain) => return Ok(json!({ "stage": "confirmPlain" }).to_string()),
        Ok(ModeCheck::Unset) => return Ok(json!({ "stage": "unset" }).to_string()),
        Ok(ModeCheck::NeedsKey) => return Ok(json!({ "stage": "needsKey" }).to_string()),
        Ok(ModeCheck::Refuse(why)) => {
            return Ok(json!({ "stage": "refused", "message": why }).to_string())
        }
        Err(e) => return Ok(stopped(&e).to_string()),
    };
    let plain_now = matches!(lock, Lock::Plain) && held_key;
    let mut engine = ServerSync::new(probe.remote, lock, Some(Attachments::Database));
    if allow_removals {
        engine.confirm_removals();
    }
    let report = engine.cycle(store()?).await;
    let mut answer = reported(&report);
    answer["encrypted"] = json!(keys.mode.as_deref() == Some(ENCRYPTED));
    answer["dropKey"] = json!(plain_now);
    Ok(answer.to_string())
}

#[wasm_bindgen]
pub fn new_recovery() -> String {
    LibraryKey::generate().recovery()
}

#[wasm_bindgen]
pub async fn set_up(recovery: Option<String>) -> Result<(), JsValue> {
    let mut remote = Fetch::connect().await.map_err(fail)?;
    match library_key(recovery.as_deref())? {
        Some(key) => remote
            .set_keys(ENCRYPTED, Some(&key.recipient()))
            .await
            .map_err(fail),
        None => remote.set_keys(PLAIN, None).await.map_err(fail),
    }
}

#[wasm_bindgen]
pub fn recipient_of(recovery: &str) -> Result<String, JsValue> {
    Ok(LibraryKey::from_recovery(recovery)
        .map_err(fail)?
        .recipient())
}

#[wasm_bindgen]
pub fn normalize_recovery(recovery: &str) -> Result<String, JsValue> {
    Ok(LibraryKey::from_recovery(recovery)
        .map_err(fail)?
        .recovery())
}

#[wasm_bindgen]
pub fn join_start() -> Result<String, JsValue> {
    let key = JoinKey::generate();
    let public = key.public();
    *JOINING.lock().map_err(fail_lock)? = Some(key);
    Ok(public)
}

fn fail_lock<T>(_: T) -> JsValue {
    fail("the join is unavailable")
}

#[wasm_bindgen]
pub fn join_finish(wrapped: &str, recipient: &str) -> Result<String, JsValue> {
    let key = JOINING
        .lock()
        .map_err(fail_lock)?
        .take()
        .ok_or_else(|| fail("no join is waiting"))?;
    Ok(key.unwrap(wrapped, recipient).map_err(fail)?.recovery())
}

#[wasm_bindgen]
pub fn words(public: &str, recipient: &str) -> Vec<String> {
    join_words(public, recipient)
        .iter()
        .map(|w| w.to_string())
        .collect()
}

#[wasm_bindgen]
pub fn wrap_for(recovery: &str, public: &str) -> Result<String, JsValue> {
    LibraryKey::from_recovery(recovery)
        .map_err(fail)?
        .wrap_for(public)
        .map_err(fail)
}

#[wasm_bindgen]
pub async fn switch_encryption(
    recovery: Option<String>,
    next: Option<String>,
) -> Result<(), JsValue> {
    let current = match library_key(recovery.as_deref())? {
        Some(k) => Lock::Encrypted(k),
        None => Lock::Plain,
    };
    let remote = Fetch::connect().await.map_err(fail)?;
    let mut engine = ServerSync::new(remote, current, Some(Attachments::Database));
    match library_key(next.as_deref())? {
        Some(key) => {
            let recipient = key.recipient();
            engine
                .switch_mode(store()?, Lock::Encrypted(key), ENCRYPTED, Some(&recipient))
                .await
                .map_err(fail)?;
        }
        None => {
            engine
                .switch_mode(store()?, Lock::Plain, PLAIN, None)
                .await
                .map_err(fail)?;
        }
    }
    Ok(())
}
