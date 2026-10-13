use crate::*;
use instantnotes_core::store::iso;
use instantnotes_core::store::server_sync::MergeReview;
use instantnotes_core::sync::crypto::{join_words, JoinKey, LibraryKey, Lock};
use instantnotes_core::sync::cycle::{ModeCheck, ServerSync, SyncReport, ENCRYPTED, PLAIN};
use instantnotes_core::sync::remote::{Remote, RemoteError};
use instantnotes_server::client::{callback_query, pkce, Blocking, Client, Device, JoinAnswer};
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub(crate) const SERVER: &str = "server";
const SERVER_SETTING: &str = "vault.server";
const TRANSPORT_SETTING: &str = "vault.transport";
const KEYCHAIN: &str = "InstantNotes";
const SIGN_IN_WAIT: Duration = Duration::from_secs(10 * 60);
const JOIN_ROUNDS: usize = 24;
const LONG_POLL: u64 = 25;
const BACKUPS_KEPT: usize = 3;
const SIGNED_IN_PAGE: &str = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n<!doctype html><meta charset=utf-8><title>InstantNotes</title><body style=\"font-family:system-ui;display:grid;place-items:center;min-height:90vh\"><p>Signed in. You can close this tab and return to InstantNotes.</p>";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerSettings {
    pub address: String,
    pub device_id: String,
    pub name: Option<String>,
    pub email: Option<String>,
    pub mode: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerStatus {
    pub stage: String,
    pub message: Option<String>,
    pub address: Option<String>,
    pub person: Option<String>,
    pub encrypted: bool,
    pub join_words: Option<Vec<String>>,
    pub join_key: Option<String>,
    pub recovery_key: Option<String>,
    pub last_synced_at: Option<String>,
    pub conflicts: usize,
    pub held_removals: usize,
    pub too_large: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JoinRequest {
    pub id: String,
    pub device_name: String,
    pub public_key: String,
    pub words: Vec<String>,
}

#[derive(Default)]
pub(crate) struct ServerLink {
    pub(crate) status: Mutex<ServerStatus>,
    pub(crate) engine: Mutex<()>,
    pub(crate) allow_removals: std::sync::atomic::AtomicBool,
    cancel: Mutex<Option<tokio::sync::watch::Sender<bool>>>,
}

impl ServerLink {
    pub(crate) fn set(&self, f: impl FnOnce(&mut ServerStatus)) {
        let mut status = self.status.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut status);
    }

    pub(crate) fn get(&self) -> ServerStatus {
        self.status
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
}

fn host(address: &str) -> &str {
    address.split("://").nth(1).unwrap_or(address)
}

fn entry(settings: &ServerSettings, what: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(
        KEYCHAIN,
        &format!("{}/{}/{what}", host(&settings.address), settings.device_id),
    )
    .map_err(|e| format!("the system keychain is not available: {e}"))
}

pub(crate) fn keychain_get(settings: &ServerSettings, what: &str) -> Option<String> {
    entry(settings, what).ok()?.get_password().ok()
}

fn keychain_set(settings: &ServerSettings, what: &str, secret: &str) -> Result<(), String> {
    entry(settings, what)?
        .set_password(secret)
        .map_err(|e| format!("the system keychain refused to store a secret: {e}"))
}

fn keychain_delete(settings: &ServerSettings, what: &str) {
    if let Ok(e) = entry(settings, what) {
        let _ = e.delete_credential();
    }
}

pub(crate) fn server_settings(store: &Store) -> Option<ServerSettings> {
    store
        .get_setting(SERVER_SETTING)
        .ok()
        .flatten()
        .and_then(|v| serde_json::from_value(v).ok())
}

fn save_settings(store: &mut Store, settings: &ServerSettings) -> CmdResult<()> {
    store.set_setting(
        SERVER_SETTING,
        serde_json::to_value(settings).unwrap_or_default(),
    )?;
    Ok(())
}

pub(crate) fn is_server(store: &Store) -> bool {
    store
        .get_setting(TRANSPORT_SETTING)
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(str::to_string))
        .as_deref()
        == Some(SERVER)
}

fn device_name() -> String {
    let host = std::env::var("HOSTNAME")
        .ok()
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok())
        .map(|h| h.trim().to_string())
        .filter(|h| !h.is_empty());
    let os = if cfg!(target_os = "macos") {
        "Mac"
    } else if cfg!(target_os = "windows") {
        "Windows"
    } else {
        "Linux"
    };
    match host {
        Some(h) => format!("{os} ({h})"),
        None => format!("{os} computer"),
    }
}

fn remote_error(e: RemoteError) -> CmdError {
    CmdError::storage(e.to_string())
}

fn client_for(settings: &ServerSettings) -> CmdResult<Client> {
    let token = keychain_get(settings, "token").ok_or_else(|| CmdError::storage("signed out"))?;
    Ok(Client::new(&settings.address)
        .map_err(CmdError::storage)?
        .with_token(&token))
}

fn link(app: &AppHandle) -> tauri::State<'_, ServerLink> {
    app.state::<ServerLink>()
}

fn backup_library(app: &AppHandle, store: &Store) -> CmdResult<std::path::PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| CmdError::storage(format!("no app data dir: {e}")))?
        .join("backups");
    std::fs::create_dir_all(&dir)
        .map_err(|e| CmdError::storage(format!("cannot create backups folder: {e}")))?;
    let stamp = iso(std::time::SystemTime::now()).replace([':', '.'], "-");
    let path = dir.join(format!("library-before-sync-{stamp}.db"));
    store.backup_to(&path)?;
    let mut kept: Vec<std::path::PathBuf> = std::fs::read_dir(&dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .is_some_and(|n| n.to_string_lossy().starts_with("library-before-sync-"))
                })
                .collect()
        })
        .unwrap_or_default();
    kept.sort();
    while kept.len() > BACKUPS_KEPT {
        let _ = std::fs::remove_file(kept.remove(0));
    }
    Ok(path)
}

async fn await_callback(
    listener: tokio::net::TcpListener,
    mut cancel: tokio::sync::watch::Receiver<bool>,
) -> CmdResult<(Option<String>, Option<String>, Option<String>)> {
    loop {
        let (mut socket, _) = tokio::select! {
            accepted = listener.accept() => accepted.map_err(|e| CmdError::storage(e.to_string()))?,
            _ = cancel.changed() => return Err(CmdError::storage("sign-in cancelled")),
        };
        let mut buffer = vec![0u8; 8192];
        let read = socket.read(&mut buffer).await.unwrap_or(0);
        let request = String::from_utf8_lossy(&buffer[..read]).to_string();
        let line = request.lines().next().unwrap_or_default();
        match callback_query(line) {
            Some(found) => {
                let _ = socket.write_all(SIGNED_IN_PAGE.as_bytes()).await;
                return Ok(found);
            }
            None => {
                let _ = socket
                    .write_all(b"HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n")
                    .await;
            }
        }
    }
}

#[tauri::command]
pub(crate) fn get_sync_server_status(
    state: State<'_, AppState>,
    link: State<'_, ServerLink>,
) -> CmdResult<ServerStatus> {
    let mut status = link.get();
    let store = locked(&state)?;
    if is_server(&store) {
        if let Some(settings) = server_settings(&store) {
            status.address = Some(settings.address.clone());
            status.person = settings.name.clone().or(settings.email.clone());
            status.encrypted = settings.mode.as_deref() == Some(ENCRYPTED);
        }
    } else if status.stage != "signingIn" {
        status = ServerStatus {
            stage: "off".into(),
            ..ServerStatus::default()
        };
    }
    Ok(status)
}

#[tauri::command]
pub(crate) async fn connect_sync_server(
    app: AppHandle,
    address: String,
    encrypt: bool,
) -> CmdResult<ServerStatus> {
    let client = Client::new(&address).map_err(CmdError::storage)?;
    client.info().await.map_err(remote_error)?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| CmdError::storage(format!("cannot listen for the sign-in: {e}")))?;
    let port = listener
        .local_addr()
        .map_err(|e| CmdError::storage(e.to_string()))?
        .port();
    let redirect = format!("http://127.0.0.1:{port}/callback");
    let codes = pkce();
    let url = client.authorize_url(&redirect, &codes.state, &codes.challenge, &device_name());
    let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
    *link(&app).cancel.lock().unwrap_or_else(|e| e.into_inner()) = Some(cancel_tx);
    link(&app).set(|s| {
        *s = ServerStatus {
            stage: "signingIn".into(),
            address: Some(client.base().to_string()),
            ..ServerStatus::default()
        }
    });
    let _ = app.emit(events::VAULT_STATUS, ());
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| CmdError::storage(format!("cannot open the browser: {e}")))?;
    let waited = tokio::time::timeout(SIGN_IN_WAIT, await_callback(listener, cancel_rx)).await;
    let outcome = match waited {
        Ok(found) => found,
        Err(_) => Err(CmdError::storage("sign-in timed out")),
    };
    let (code, state, error) = match outcome {
        Ok(found) => found,
        Err(e) => {
            link(&app).set(|s| {
                *s = ServerStatus {
                    stage: "off".into(),
                    ..ServerStatus::default()
                }
            });
            let _ = app.emit(events::VAULT_STATUS, ());
            return Err(e);
        }
    };
    let fail = |message: &str| {
        link(&app).set(|s| {
            *s = ServerStatus {
                stage: "off".into(),
                message: Some(message.into()),
                ..ServerStatus::default()
            }
        });
        let _ = app.emit(events::VAULT_STATUS, ());
        CmdError::storage(message)
    };
    if error.is_some() || state.as_deref() != Some(codes.state.as_str()) {
        return Err(fail("sign-in was cancelled in the browser"));
    }
    let code = code.ok_or_else(|| fail("the server sent no sign-in code"))?;
    let issued = client
        .exchange(&code, &codes.verifier, &redirect)
        .await
        .map_err(|e| fail(&e.to_string()))?;
    let settings = ServerSettings {
        address: client.base().to_string(),
        device_id: issued.device_id.clone(),
        name: issued.person.name.clone(),
        email: issued.person.email.clone(),
        mode: None,
    };
    keychain_set(&settings, "token", &issued.token).map_err(|e| fail(&e))?;
    let authed = client.clone().with_token(&issued.token);
    let keys = authed.keys().await.map_err(|e| fail(&e.to_string()))?;
    {
        let state = app.state::<AppState>();
        let mut store = locked(&state)?;
        backup_library(&app, &store)?;
        store.configure_vault(None)?;
        store.set_setting(TRANSPORT_SETTING, serde_json::Value::String(SERVER.into()))?;
        save_settings(&mut store, &settings)?;
        store.begin_server_sync()?;
    }
    let mut status = ServerStatus {
        address: Some(settings.address.clone()),
        person: settings.name.clone().or(settings.email.clone()),
        ..ServerStatus::default()
    };
    match keys.mode.as_deref() {
        None if encrypt => {
            let key = LibraryKey::generate();
            authed
                .set_keys(ENCRYPTED, Some(&key.recipient()))
                .await
                .map_err(|e| fail(&e.to_string()))?;
            keychain_set(&settings, "key", &key.recovery()).map_err(|e| fail(&e))?;
            set_mode(&app, ENCRYPTED)?;
            status.stage = "recoveryKey".into();
            status.encrypted = true;
            status.recovery_key = Some(key.recovery());
        }
        None => {
            authed
                .set_keys(PLAIN, None)
                .await
                .map_err(|e| fail(&e.to_string()))?;
            set_mode(&app, PLAIN)?;
            status.stage = "syncing".into();
        }
        Some(ENCRYPTED) => {
            status.stage = "needsKey".into();
            status.encrypted = true;
        }
        Some(_) if encrypt => status.stage = "confirmPlain".into(),
        Some(_) => {
            set_mode(&app, PLAIN)?;
            status.stage = "syncing".into();
        }
    }
    link(&app).set(|s| *s = status.clone());
    let _ = app.emit(events::VAULT_STATUS, ());
    request_vault_sync(&app);
    Ok(status)
}

fn set_mode(app: &AppHandle, mode: &str) -> CmdResult<()> {
    let state = app.state::<AppState>();
    let mut store = locked(&state)?;
    let mut settings = server_settings(&store).ok_or_else(|| CmdError::storage("not connected"))?;
    settings.mode = Some(mode.to_string());
    save_settings(&mut store, &settings)
}

fn connected(app: &AppHandle) -> CmdResult<ServerSettings> {
    let state = app.state::<AppState>();
    let store = locked(&state)?;
    server_settings(&store).ok_or_else(|| CmdError::storage("not connected to a sync server"))
}

#[tauri::command]
pub(crate) fn cancel_sync_sign_in(link: State<'_, ServerLink>) {
    if let Some(cancel) = link.cancel.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = cancel.send(true);
    }
}

#[tauri::command]
pub(crate) fn confirm_recovery_saved(app: AppHandle) {
    link(&app).set(|s| {
        s.recovery_key = None;
        s.stage = "syncing".into();
    });
    let _ = app.emit(events::VAULT_STATUS, ());
    request_vault_sync(&app);
}

#[tauri::command]
pub(crate) fn show_recovery_key(app: AppHandle) -> CmdResult<String> {
    let settings = connected(&app)?;
    keychain_get(&settings, "key")
        .ok_or_else(|| CmdError::storage("this device holds no encryption key"))
}

#[tauri::command]
pub(crate) async fn start_sync_join(app: AppHandle) -> CmdResult<ServerStatus> {
    let settings = connected(&app)?;
    let client = client_for(&settings)?;
    let join = Arc::new(JoinKey::generate());
    let public = join.public();
    let recipient = client
        .keys()
        .await
        .map_err(remote_error)?
        .recipient
        .ok_or_else(|| CmdError::storage("this library is not encrypted on the server"))?;
    let id = client
        .request_join(&public, &device_name())
        .await
        .map_err(remote_error)?;
    link(&app).set(|s| {
        s.stage = "joining".into();
        s.join_words = Some(
            join_words(&public, &recipient)
                .iter()
                .map(|w| w.to_string())
                .collect(),
        );
        s.join_key = Some(public.clone());
        s.message = None;
    });
    let _ = app.emit(events::VAULT_STATUS, ());
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        for _ in 0..JOIN_ROUNDS {
            match client.join_answer(&id, LONG_POLL).await {
                Ok(JoinAnswer::Pending) => continue,
                Ok(JoinAnswer::Approved { key }) => {
                    let outcome = join
                        .unwrap(&key, &recipient)
                        .map_err(|e| e.to_string())
                        .and_then(|library| keychain_set(&settings, "key", &library.recovery()));
                    match outcome.and_then(|()| {
                        set_mode(&handle, ENCRYPTED).map_err(|e| e.message().to_string())
                    }) {
                        Ok(()) => link(&handle).set(|s| {
                            s.stage = "syncing".into();
                            s.join_words = None;
                            s.join_key = None;
                        }),
                        Err(e) => link(&handle).set(|s| {
                            s.stage = "needsKey".into();
                            s.message = Some(e);
                        }),
                    }
                    break;
                }
                Ok(JoinAnswer::Denied) | Err(_) => {
                    link(&handle).set(|s| {
                        s.stage = "needsKey".into();
                        s.join_words = None;
                        s.join_key = None;
                        s.message = Some("The request was not approved.".into());
                    });
                    break;
                }
            }
        }
        let _ = handle.emit(events::VAULT_STATUS, ());
        request_vault_sync(&handle);
    });
    Ok(link(&app).get())
}

#[tauri::command]
pub(crate) async fn enter_recovery_key(app: AppHandle, text: String) -> CmdResult<ServerStatus> {
    let settings = connected(&app)?;
    let key = LibraryKey::from_recovery(&text).map_err(|e| CmdError::validation(e.to_string()))?;
    let keys = client_for(&settings)?.keys().await.map_err(remote_error)?;
    if keys.recipient.as_deref() != Some(key.recipient().as_str()) {
        return Err(CmdError::validation(
            "this recovery key belongs to another library",
        ));
    }
    keychain_set(&settings, "key", &key.recovery()).map_err(CmdError::storage)?;
    set_mode(&app, ENCRYPTED)?;
    link(&app).set(|s| {
        s.stage = "syncing".into();
        s.message = None;
    });
    let _ = app.emit(events::VAULT_STATUS, ());
    request_vault_sync(&app);
    Ok(link(&app).get())
}

#[tauri::command]
pub(crate) fn accept_plain_server(app: AppHandle) -> CmdResult<()> {
    set_mode(&app, PLAIN)?;
    link(&app).set(|s| s.stage = "syncing".into());
    let _ = app.emit(events::VAULT_STATUS, ());
    request_vault_sync(&app);
    Ok(())
}

#[tauri::command]
pub(crate) async fn disconnect_sync_server(app: AppHandle) -> CmdResult<()> {
    let Ok(settings) = connected(&app) else {
        return Ok(());
    };
    if let Ok(client) = client_for(&settings) {
        let _ = client.revoke(Some(&settings.device_id)).await;
    }
    keychain_delete(&settings, "token");
    keychain_delete(&settings, "key");
    {
        let state = app.state::<AppState>();
        let mut store = locked(&state)?;
        store.end_server_sync()?;
        store.delete_setting(SERVER_SETTING)?;
        store.delete_setting(TRANSPORT_SETTING)?;
    }
    link(&app).set(|s| {
        *s = ServerStatus {
            stage: "off".into(),
            ..ServerStatus::default()
        }
    });
    let _ = app.emit(events::VAULT_STATUS, ());
    request_vault_sync(&app);
    Ok(())
}

#[tauri::command]
pub(crate) async fn list_sync_devices(app: AppHandle) -> CmdResult<Vec<Device>> {
    client_for(&connected(&app)?)?
        .devices()
        .await
        .map_err(remote_error)
}

#[tauri::command]
pub(crate) async fn revoke_sync_device(app: AppHandle, id: Option<String>) -> CmdResult<()> {
    client_for(&connected(&app)?)?
        .revoke(id.as_deref())
        .await
        .map_err(remote_error)
}

#[tauri::command]
pub(crate) async fn answer_sync_join(
    app: AppHandle,
    id: String,
    public_key: String,
    approve: bool,
) -> CmdResult<()> {
    let settings = connected(&app)?;
    let client = client_for(&settings)?;
    if !approve {
        return client.answer_join(&id, None).await.map_err(remote_error);
    }
    let key = keychain_get(&settings, "key")
        .ok_or_else(|| CmdError::storage("this device holds no encryption key"))?;
    let wrapped = LibraryKey::from_recovery(&key)
        .and_then(|k| k.wrap_for(&public_key))
        .map_err(|e| CmdError::storage(e.to_string()))?;
    client
        .answer_join(&id, Some(&wrapped))
        .await
        .map_err(remote_error)
}

#[tauri::command]
pub(crate) fn confirm_sync_removals(app: AppHandle) {
    link(&app)
        .allow_removals
        .store(true, std::sync::atomic::Ordering::Relaxed);
    request_vault_sync(&app);
}

#[tauri::command]
pub(crate) async fn set_sync_encryption(app: AppHandle, on: bool) -> CmdResult<ServerStatus> {
    let settings = connected(&app)?;
    let handle = app.clone();
    let (done_tx, done_rx) = tokio::sync::oneshot::channel();
    std::thread::spawn(move || {
        let _ = done_tx.send(switch_encryption(&handle, &settings, on));
    });
    let recovery = done_rx
        .await
        .map_err(|_| CmdError::storage("the switch-over stopped"))??;
    link(&app).set(|s| {
        s.encrypted = on;
        s.recovery_key = recovery.clone();
        s.stage = if recovery.is_some() {
            "recoveryKey"
        } else {
            "syncing"
        }
        .into();
    });
    let _ = app.emit(events::VAULT_STATUS, ());
    request_vault_sync(&app);
    Ok(link(&app).get())
}

fn switch_encryption(
    app: &AppHandle,
    settings: &ServerSettings,
    on: bool,
) -> CmdResult<Option<String>> {
    let link = link(app);
    let _engine = link.engine.lock().unwrap_or_else(|e| e.into_inner());
    let remote = blocking_remote(settings)?;
    let current = lock_from_keychain(settings);
    let state = app.state::<AppState>();
    let mut sync = ServerSync::new(remote, current, attachments_dir(app).ok());
    let (next, mode, recipient, recovery) = if on {
        let key = LibraryKey::generate();
        let recipient = key.recipient();
        let recovery = key.recovery();
        (
            Lock::Encrypted(key),
            ENCRYPTED,
            Some(recipient),
            Some(recovery),
        )
    } else {
        (Lock::Plain, PLAIN, None, None)
    };
    sync.switch_mode(&state.store, next, mode, recipient.as_deref())
        .map_err(remote_error)?;
    match &recovery {
        Some(r) => keychain_set(settings, "key", r).map_err(CmdError::storage)?,
        None => keychain_delete(settings, "key"),
    }
    set_mode(app, mode)?;
    Ok(recovery)
}

pub(crate) fn lock_from_keychain(settings: &ServerSettings) -> Lock {
    match (settings.mode.as_deref(), keychain_get(settings, "key")) {
        (Some(ENCRYPTED), Some(text)) => LibraryKey::from_recovery(&text)
            .map(Lock::Encrypted)
            .unwrap_or(Lock::Plain),
        _ => Lock::Plain,
    }
}

pub(crate) fn blocking_remote(settings: &ServerSettings) -> CmdResult<Blocking> {
    let client = client_for(settings)?;
    let blocking = Blocking::new(client, 0).map_err(|e| CmdError::storage(e.to_string()))?;
    let info = blocking.run(blocking.client.info()).map_err(remote_error)?;
    Blocking::new(blocking.client.clone(), info.max_object_bytes)
        .map_err(|e| CmdError::storage(e.to_string()))
}

pub(crate) struct ServerEngine {
    pub sync: ServerSync<Blocking>,
    pub settings: ServerSettings,
}

pub(crate) fn build_engine(app: &AppHandle) -> Option<ServerEngine> {
    let state = app.try_state::<AppState>()?;
    let settings = {
        let store = state.store.lock().ok()?;
        if !is_server(&store) {
            return None;
        }
        server_settings(&store)?
    };
    let stage = link(app).get().stage;
    if matches!(
        stage.as_str(),
        "needsKey" | "joining" | "confirmPlain" | "signingIn"
    ) {
        return None;
    }
    let mode = settings.mode.clone()?;
    let mut remote = match blocking_remote(&settings) {
        Ok(r) => r,
        Err(e) => {
            link(app).set(|s| {
                s.stage = "offline".into();
                s.message = Some(e.message().to_string());
            });
            return None;
        }
    };
    let key = keychain_get(&settings, "key").and_then(|t| LibraryKey::from_recovery(&t).ok());
    let keys = match remote.keys() {
        Ok(keys) => keys,
        Err(e) => {
            link(app).set(|s| {
                s.stage = if e == RemoteError::SignedOut {
                    "signedOut"
                } else {
                    "offline"
                }
                .into();
                s.message = Some(e.to_string());
            });
            return None;
        }
    };
    let attachments = attachments_dir(app).ok();
    let mut sync = ServerSync::new(remote, lock_from_keychain(&settings), attachments.clone());
    let stop = |stage: &str, message: Option<String>| {
        link(app).set(|s| {
            s.stage = stage.into();
            s.message = message;
        });
    };
    let known_epoch = state
        .store
        .lock()
        .ok()
        .and_then(|st| st.sync_state().ok())
        .filter(|st| st.library_id.as_deref() == Some(keys.library_id.as_str()))
        .map(|st| st.epoch)
        .unwrap_or(0);
    match sync.check_mode(&keys, key.as_ref(), known_epoch) {
        Ok(ModeCheck::Encrypted) if mode == ENCRYPTED => {}
        Ok(ModeCheck::Plain) if mode == PLAIN => {}
        Ok(ModeCheck::Plain) => {
            let mut next = settings.clone();
            next.mode = Some(PLAIN.into());
            if let Ok(mut store) = state.store.lock() {
                let _ = save_settings(&mut store, &next);
            }
            keychain_delete(&settings, "key");
            sync = ServerSync::new(sync.remote, Lock::Plain, attachments);
        }
        Ok(ModeCheck::Refuse(why)) => {
            stop("refused", Some(why));
            return None;
        }
        Ok(_) => {
            stop("needsKey", None);
            return None;
        }
        Err(e) => {
            stop("offline", Some(e.to_string()));
            return None;
        }
    }
    let settings = {
        let store = state.store.lock().ok()?;
        server_settings(&store)?
    };
    Some(ServerEngine { sync, settings })
}

pub(crate) fn record_report(app: &AppHandle, report: &SyncReport) {
    link(app).set(|s| {
        s.conflicts += report.conflicts;
        s.held_removals = report.held_removals;
        s.too_large = report.too_large.clone();
        s.message = report.errors.first().cloned();
        s.stage = if report.signed_out {
            "signedOut"
        } else if report.unreachable.is_some() {
            "offline"
        } else if report.held_removals > 0 {
            "held"
        } else if !report.errors.is_empty() {
            "problem"
        } else {
            "upToDate"
        }
        .into();
        if report.reached() && report.errors.is_empty() {
            s.last_synced_at = Some(iso(std::time::SystemTime::now()));
        }
        if let Some(why) = &report.unreachable {
            s.message = Some(why.clone());
        }
    });
}

pub(crate) fn watch_server(
    app: AppHandle,
    settings: ServerSettings,
    stop: Arc<std::sync::atomic::AtomicBool>,
) {
    let changes = {
        let app = app.clone();
        let settings = settings.clone();
        let stop = Arc::clone(&stop);
        std::thread::spawn(move || {
            let Ok(remote) = blocking_remote(&settings) else {
                return;
            };
            let mut last = None;
            while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                let cursor = app
                    .try_state::<AppState>()
                    .and_then(|s| s.store.lock().ok().and_then(|st| st.sync_state().ok()))
                    .map(|st| st.cursor)
                    .unwrap_or(0);
                let since = last.map_or(cursor, |seen: i64| seen.max(cursor));
                match remote.run(remote.client.changes(since, LONG_POLL)) {
                    Ok(page) => {
                        if page.head > since || !page.changes.is_empty() {
                            request_vault_sync(&app);
                        }
                        last = Some(page.head);
                    }
                    Err(RemoteError::Gone) => {
                        last = None;
                        request_vault_sync(&app);
                        std::thread::sleep(Duration::from_secs(5));
                    }
                    Err(_) => std::thread::sleep(Duration::from_secs(30)),
                }
            }
        })
    };
    std::thread::spawn(move || {
        let Ok(remote) = blocking_remote(&settings) else {
            return;
        };
        let mut shown: Vec<String> = Vec::new();
        while !stop.load(std::sync::atomic::Ordering::Relaxed) {
            let Some(recipient) = keychain_get(&settings, "key")
                .and_then(|k| LibraryKey::from_recovery(&k).ok())
                .map(|k| k.recipient())
            else {
                std::thread::sleep(Duration::from_secs(30));
                continue;
            };
            match remote.run(remote.client.pending_joins(LONG_POLL)) {
                Ok(joins) => {
                    let ids: Vec<String> = joins.iter().map(|j| j.id.clone()).collect();
                    if ids != shown {
                        let requests: Vec<JoinRequest> = joins
                            .into_iter()
                            .map(|j| JoinRequest {
                                words: join_words(&j.public_key, &recipient)
                                    .iter()
                                    .map(|w| w.to_string())
                                    .collect(),
                                id: j.id,
                                device_name: j.device_name,
                                public_key: j.public_key,
                            })
                            .collect();
                        let _ = app.emit(events::SYNC_JOIN_REQUESTS, requests);
                        shown = ids;
                    }
                }
                Err(_) => std::thread::sleep(Duration::from_secs(30)),
            }
        }
        let _ = changes.join();
    });
}

#[tauri::command]
pub(crate) fn get_merge_review(state: State<'_, AppState>) -> CmdResult<MergeReview> {
    Ok(locked(&state)?.merge_review()?)
}

#[tauri::command]
pub(crate) fn settle_merge_pair(
    app: AppHandle,
    state: State<'_, AppState>,
    a: String,
    b: String,
    keep: Option<String>,
) -> CmdResult<MergeReview> {
    let review = {
        let mut store = locked(&state)?;
        store.settle_pair(&a, &b, keep.as_deref())?;
        store.merge_review()?
    };
    emit_notes_changed(&app);
    Ok(review)
}

#[tauri::command]
pub(crate) fn undo_merge_combine(
    app: AppHandle,
    state: State<'_, AppState>,
    trashed: String,
) -> CmdResult<MergeReview> {
    let review = {
        let mut store = locked(&state)?;
        store.undo_combine(&trashed)?;
        store.merge_review()?
    };
    emit_notes_changed(&app);
    Ok(review)
}

#[tauri::command]
pub(crate) fn clear_merge_review(state: State<'_, AppState>) -> CmdResult<()> {
    Ok(locked(&state)?.clear_review()?)
}
