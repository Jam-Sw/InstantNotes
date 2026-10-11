mod api;
mod config;
mod events;
mod libraries;
mod oidc;
mod sessions;
mod statics;
mod vaults;

pub use config::Config;
pub use sessions::Person;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode, Uri};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use events::Hub;
use instantnotes_core::AppError;
use libraries::{Libraries, Library};
use oidc::Oidc;
use serde::Deserialize;
use serde_json::{json, Value};
use sessions::{Logins, Sessions};
use std::ffi::OsString;
use std::sync::Arc;
use std::time::Duration;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

pub const SUBCOMMAND: &str = "serve";
const MUTATION_HEADER: &str = "x-instantnotes";
const CLIENT_HEADER: &str = "x-instantnotes-client";
const BODY_LIMIT: usize = 32 * 1024 * 1024;
const KEEPALIVE: Duration = Duration::from_secs(15);
const IDLE_SWEEP: Duration = Duration::from_secs(60);
const SYNC_TICK: Duration = Duration::from_secs(1);
const SIGN_IN_NOTES: usize = 400;

pub(crate) fn log(event: &str, fields: &[(&str, &str)]) {
    let mut line = String::from(event);
    for (key, value) in fields {
        line.push(' ');
        line.push_str(key);
        line.push('=');
        line.push_str(value);
    }
    println!("{line}");
}

pub struct Inner {
    pub config: Config,
    pub sessions: Sessions,
    pub libraries: Libraries,
    logins: Logins,
    hub: Hub,
    oidc: Oidc,
}

#[derive(Clone)]
pub struct AppState(Arc<Inner>);

impl std::ops::Deref for AppState {
    type Target = Inner;
    fn deref(&self) -> &Inner {
        &self.0
    }
}

impl AppState {
    pub fn new(config: Config) -> Self {
        let oidc = Oidc::new(
            &config.oidc_issuer,
            &config.oidc_client_id,
            &config.oidc_client_secret,
            &config.public_url,
            &config.redirect_uri(),
        );
        AppState(Arc::new(Inner {
            sessions: Sessions::new(config.session_ttl),
            libraries: Libraries::new(
                &config.data_dir,
                config.idle_close,
                config.vault_root.clone(),
            ),
            logins: Logins::default(),
            hub: Hub::default(),
            oidc,
            config,
        }))
    }

    pub fn sync_vaults(&self) {
        vaults::sync_due(&self.libraries, &self.hub);
    }

    fn library<T>(
        &self,
        sub: &str,
        f: impl FnOnce(&mut Library) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        if self.config.vault_root.is_some() {
            vaults::first_sync(&self.libraries, &self.hub, sub);
        }
        self.libraries.with(sub, f)
    }
}

pub fn run_from_args(mut args: impl Iterator<Item = OsString>) -> Option<i32> {
    if args.next().as_deref() != Some(SUBCOMMAND.as_ref()) {
        return None;
    }
    if args.next().is_some() {
        eprintln!("usage: instantnotes serve   (configured by INSTANTNOTES_* variables)");
        return Some(2);
    }
    let config = match Config::from_env() {
        Ok(config) => config,
        Err(e) => {
            eprintln!("instantnotes serve: {e}");
            return Some(2);
        }
    };
    Some(run(config))
}

pub fn run(config: Config) -> i32 {
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("instantnotes serve: cannot start runtime: {e}");
            return 1;
        }
    };
    runtime.block_on(async {
        let listener = match tokio::net::TcpListener::bind(config.listen).await {
            Ok(l) => l,
            Err(e) => {
                eprintln!(
                    "instantnotes serve: cannot listen on {}: {e}",
                    config.listen
                );
                return 1;
            }
        };
        let state = AppState::new(config);
        log(
            "serve.start",
            &[
                ("listen", &state.config.listen.to_string()),
                ("public_url", &state.config.public_url),
                ("data_dir", &state.config.data_dir.display().to_string()),
                ("ui_dir", &state.config.ui_dir.display().to_string()),
            ],
        );
        let sweeper = {
            let state = state.clone();
            tokio::spawn(async move {
                let mut tick = tokio::time::interval(IDLE_SWEEP);
                loop {
                    tick.tick().await;
                    state.libraries.close_idle();
                }
            })
        };
        let syncer = state.config.vault_root.as_ref().map(|root| {
            log(
                "serve.vault",
                &[("vault_root", &root.display().to_string())],
            );
            let state = state.clone();
            tokio::spawn(async move {
                let mut tick = tokio::time::interval(SYNC_TICK);
                loop {
                    tick.tick().await;
                    let state = state.clone();
                    let _ = tokio::task::spawn_blocking(move || state.sync_vaults()).await;
                }
            })
        });
        let served = axum::serve(listener, router(state.clone()))
            .with_graceful_shutdown(shutdown_signal())
            .await;
        sweeper.abort();
        if let Some(syncer) = syncer {
            syncer.abort();
        }
        state.libraries.close_all();
        match served {
            Ok(()) => {
                log("serve.stop", &[]);
                0
            }
            Err(e) => {
                eprintln!("instantnotes serve: {e}");
                1
            }
        }
    })
}

async fn shutdown_signal() {
    let ctrl_c = tokio::signal::ctrl_c();
    #[cfg(unix)]
    {
        let mut term =
            match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
                Ok(term) => term,
                Err(_) => {
                    let _ = ctrl_c.await;
                    return;
                }
            };
        tokio::select! {
            _ = ctrl_c => {}
            _ = term.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = ctrl_c.await;
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/auth/login", get(login))
        .route("/auth/callback", get(callback))
        .route("/auth/logout", get(logout))
        .route("/api/events", get(events_stream))
        .route("/api/save_attachment", post(save_attachment))
        .route("/api/attachments/{name}", get(attachment))
        .route("/api/{command}", post(command))
        .fallback(get(ui))
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .with_state(state)
}

fn error_response(e: &AppError) -> Response {
    let status = match e {
        AppError::NotFound(_) => StatusCode::NOT_FOUND,
        AppError::Validation(_) => StatusCode::BAD_REQUEST,
        AppError::Conflict(_) => StatusCode::CONFLICT,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (
        status,
        Json(json!({ "code": e.code(), "message": e.to_string() })),
    )
        .into_response()
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "code": "UNAUTHORIZED", "message": "sign in to continue" })),
    )
        .into_response()
}

fn person_of(state: &AppState, headers: &HeaderMap) -> Option<Person> {
    sessions::cookie_value(headers).and_then(|id| state.sessions.get(&id))
}

fn cookie(state: &AppState, value: &str, max_age: Option<Duration>) -> HeaderValue {
    let mut cookie = format!(
        "{}={value}; HttpOnly; SameSite=Strict; Path=/",
        sessions::COOKIE
    );
    if state.config.secure_cookies() {
        cookie.push_str("; Secure");
    }
    match max_age {
        Some(age) => cookie.push_str(&format!("; Max-Age={}", age.as_secs())),
        None => cookie.push_str("; Max-Age=0"),
    }
    HeaderValue::from_str(&cookie).expect("cookie header")
}

async fn login(State(state): State<AppState>) -> Response {
    match state.oidc.begin(&state.logins).await {
        Ok(url) => Redirect::to(&url).into_response(),
        Err(e) => {
            log("auth.login.failed", &[("reason", &e)]);
            statics::html(StatusCode::BAD_GATEWAY, statics::error_page(&e))
        }
    }
}

#[derive(Deserialize)]
struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

async fn callback(State(state): State<AppState>, Query(q): Query<CallbackQuery>) -> Response {
    if let Some(error) = q.error {
        let reason = q.error_description.unwrap_or(error);
        log("auth.callback.refused", &[("reason", &reason)]);
        return statics::html(StatusCode::BAD_REQUEST, statics::error_page(&reason));
    }
    let (Some(code), Some(login_state)) = (q.code, q.state) else {
        return statics::html(
            StatusCode::BAD_REQUEST,
            statics::error_page("the sign-in server sent no code"),
        );
    };
    match state.oidc.finish(&state.logins, &code, &login_state).await {
        Ok(person) => {
            log(
                "auth.signed_in",
                &[("library", &libraries::folder_name(&person.sub))],
            );
            let sizes = note_sizes(&state, &person.sub);
            let id = state.sessions.create(person);
            let mut response = statics::html(StatusCode::OK, statics::signed_in(&sizes));
            response.headers_mut().insert(
                header::SET_COOKIE,
                cookie(&state, &id, Some(state.sessions.ttl())),
            );
            response
        }
        Err(e) => {
            log("auth.callback.failed", &[("reason", &e)]);
            statics::html(StatusCode::BAD_REQUEST, statics::error_page(&e))
        }
    }
}

fn note_sizes(state: &AppState, sub: &str) -> Vec<usize> {
    state
        .libraries
        .with(sub, |lib| {
            Ok(lib
                .store
                .list_notes(instantnotes_core::types::NoteFilter::default())?
                .iter()
                .take(SIGN_IN_NOTES)
                .map(|n| n.title.chars().count() + n.body.chars().count())
                .collect())
        })
        .unwrap_or_default()
}

async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(id) = sessions::cookie_value(&headers) {
        state.sessions.remove(&id);
    }
    let target = state.oidc.logout_url().await;
    let mut response = Redirect::to(&target).into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, cookie(&state, "", None));
    response
}

async fn ui(State(state): State<AppState>, headers: HeaderMap, uri: Uri) -> Response {
    if person_of(&state, &headers).is_none() {
        return statics::html(StatusCode::OK, statics::SIGN_IN.to_string());
    }
    statics::serve_ui(&state.config.ui_dir, uri.path()).await
}

async fn events_stream(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Some(person) = person_of(&state, &headers) else {
        return unauthorized();
    };
    let receiver = state.hub.subscribe(&person.sub);
    let stream = BroadcastStream::new(receiver).filter_map(|item| {
        item.ok().map(|change| {
            Ok::<Event, std::convert::Infallible>(
                Event::default()
                    .event(change.event)
                    .data(change.payload.to_string()),
            )
        })
    });
    Sse::new(stream)
        .keep_alive(KeepAlive::new().interval(KEEPALIVE).text("keepalive"))
        .into_response()
}

fn client_origin(headers: &HeaderMap) -> Option<String> {
    headers
        .get(CLIENT_HEADER)
        .and_then(|v| v.to_str().ok())
        .filter(|v| !v.is_empty() && v.len() <= 64)
        .map(str::to_string)
}

fn forbidden_without_header(headers: &HeaderMap) -> Option<Response> {
    if headers.contains_key(MUTATION_HEADER) {
        return None;
    }
    Some(
        (
            StatusCode::FORBIDDEN,
            Json(json!({ "code": "FORBIDDEN", "message": "missing X-InstantNotes header" })),
        )
            .into_response(),
    )
}

async fn command(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(command): Path<String>,
    body: Bytes,
) -> Response {
    let Some(person) = person_of(&state, &headers) else {
        return unauthorized();
    };
    if let Some(refused) = forbidden_without_header(&headers) {
        return refused;
    }
    if !api::WEB_COMMANDS.contains(&command.as_str()) {
        return error_response(&AppError::NotFound(format!("command {command}")));
    }
    let args: Value = if body.is_empty() {
        Value::Null
    } else {
        match serde_json::from_slice(&body) {
            Ok(v) => v,
            Err(e) => return error_response(&AppError::Validation(format!("arguments: {e}"))),
        }
    };
    let origin = client_origin(&headers);
    let sub = person.sub.clone();
    let libraries_state = state.clone();
    let name = command.clone();
    let outcome = tokio::task::spawn_blocking(move || {
        libraries_state.library(&sub, |lib| {
            let outcome = api::dispatch(lib, &name, &args, origin.as_deref())?;
            if let Some(vault) = lib.vault.as_ref().filter(|_| !outcome.changes.is_empty()) {
                vault.poke();
            }
            Ok(outcome)
        })
    })
    .await;
    match outcome {
        Ok(Ok(outcome)) => {
            state.hub.publish(&person.sub, outcome.changes);
            Json(outcome.value).into_response()
        }
        Ok(Err(e)) => {
            log("api.error", &[("command", &command), ("code", e.code())]);
            error_response(&e)
        }
        Err(_) => error_response(&AppError::Storage("command panicked".into())),
    }
}

async fn save_attachment(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Some(person) = person_of(&state, &headers) else {
        return unauthorized();
    };
    if let Some(refused) = forbidden_without_header(&headers) {
        return refused;
    }
    let ext = headers
        .get("x-attachment-ext")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let sub = person.sub;
    let libraries_state = state.clone();
    let saved = tokio::task::spawn_blocking(move || {
        libraries_state.library(&sub, |lib| api::save_attachment(lib, &body, &ext))
    })
    .await;
    match saved {
        Ok(Ok(name)) => Json(json!(name)).into_response(),
        Ok(Err(e)) => error_response(&e),
        Err(_) => error_response(&AppError::Storage("attachment write panicked".into())),
    }
}

async fn attachment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> Response {
    let Some(person) = person_of(&state, &headers) else {
        return unauthorized();
    };
    let sub = person.sub;
    let libraries_state = state.clone();
    let path = tokio::task::spawn_blocking(move || {
        libraries_state.library(&sub, |lib| {
            api::attachment_path(lib, &name)
                .ok_or_else(|| AppError::NotFound(format!("attachment {name}")))
        })
    })
    .await;
    match path {
        Ok(Ok(path)) => match statics::serve_file(&path, "private, max-age=86400").await {
            Some(found) => found,
            None => error_response(&AppError::NotFound("attachment".into())),
        },
        Ok(Err(e)) => error_response(&e),
        Err(_) => error_response(&AppError::Storage("attachment read panicked".into())),
    }
}
