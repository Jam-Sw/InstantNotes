pub mod client;
mod config;
mod device;
#[cfg(test)]
mod fake_idp;
mod libraries;
mod limits;
mod objects;
mod oidc;
mod recheck;
mod sessions;
mod statics;
mod sync_api;

pub use config::Config;
pub use sessions::Person;

use axum::extract::connect_info::IntoMakeServiceWithConnectInfo;
use axum::extract::{ConnectInfo, DefaultBodyLimit, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode, Uri};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::get;
use axum::{Json, Router};
use libraries::Libraries;
use limits::Limits;
use objects::Stores;
use oidc::Oidc;
use recheck::Recheck;
use serde::Deserialize;
use serde_json::json;
use sessions::{Logins, Sessions};
use std::ffi::OsString;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

pub const SUBCOMMAND: &str = "serve";
const BODY_LIMIT: usize = 32 * 1024 * 1024;
const IDLE_SWEEP: Duration = Duration::from_secs(60);
const BLOB_SWEEP_TICKS: u64 = 60;
const SERVER_DB: &str = "server.db";
const HSTS: &str = "max-age=31536000";
const LOGIN_COOKIE: &str = "in_login";
const LOGIN_TTL: Duration = Duration::from_secs(10 * 60);

pub(crate) fn log(event: &str, fields: &[(&str, &str)]) {
    let mut line = String::from(event);
    for (key, value) in fields {
        line.push(' ');
        line.push_str(key);
        line.push('=');
        line.extend(value.chars().map(|c| if c.is_control() { ' ' } else { c }));
    }
    println!("{line}");
}

pub struct Inner {
    pub config: Config,
    pub sessions: Sessions,
    pub libraries: Libraries,
    logins: Logins,
    limits: Limits,
    oidc: Arc<Oidc>,
    recheck: Recheck,
    stores: Stores,
    devices: device::Devices,
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
    pub fn new(config: Config) -> Result<Self, String> {
        let oidc = Oidc::new(
            &config.oidc_issuer,
            &config.oidc_client_id,
            &config.oidc_client_secret,
            &config.public_url,
            &config.redirect_uri(),
        );
        libraries::create_private_dir(&config.data_dir).map_err(|e| e.to_string())?;
        let sessions = Sessions::open(&config.data_dir.join(SERVER_DB), config.session_ttl)?;
        Ok(AppState(Arc::new(Inner {
            sessions,
            libraries: Libraries::new(&config.data_dir, config.idle_close),
            logins: Logins::default(),
            limits: Limits::new(),
            oidc: Arc::new(oidc),
            recheck: Recheck::new(&config.oidc_client_secret),
            stores: Stores::new(&config.data_dir),
            devices: device::Devices::default(),
            config,
        })))
    }

    fn health(&self) -> Result<(), String> {
        tempfile::Builder::new()
            .prefix(".healthz")
            .tempfile_in(&self.config.data_dir)
            .and_then(|mut probe| std::io::Write::write_all(&mut probe, b"ok"))
            .map_err(|e| format!("data folder not writable: {e}"))?;
        self.sessions.healthy()?;
        match self.recheck.problem() {
            Some(problem) => Err(problem),
            None => Ok(()),
        }
    }

    pub async fn recheck_people(&self) {
        let ran = self
            .recheck
            .run_due(&self.sessions, &self.oidc, sessions::now_secs())
            .await;
        for sub in ran.refused_people {
            if let Ok(store) = self.stores.of(&sub) {
                store.cancel_joins();
            }
        }
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
        let state = match AppState::new(config) {
            Ok(state) => state,
            Err(e) => {
                eprintln!("instantnotes serve: {e}");
                return 1;
            }
        };
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
                let mut ticks: u64 = 0;
                loop {
                    tick.tick().await;
                    state.libraries.close_idle();
                    state.limits.forget_idle();
                    ticks += 1;
                    if ticks.is_multiple_of(BLOB_SWEEP_TICKS) {
                        let swept = state.clone();
                        let _ = tokio::task::spawn_blocking(move || swept.stores.sweep()).await;
                    }
                }
            })
        };
        let rechecker = {
            let state = state.clone();
            tokio::spawn(async move {
                let mut tick = tokio::time::interval(IDLE_SWEEP);
                loop {
                    tick.tick().await;
                    state.recheck_people().await;
                }
            })
        };
        let served = axum::serve(listener, app(state.clone()))
            .with_graceful_shutdown(shutdown_signal())
            .await;
        sweeper.abort();
        rechecker.abort();
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

pub fn app(state: AppState) -> IntoMakeServiceWithConnectInfo<Router, SocketAddr> {
    router(state).into_make_service_with_connect_info::<SocketAddr>()
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .merge(sync_api::routes())
        .merge(device::routes())
        .route("/healthz", get(healthz))
        .route("/auth/login", get(login))
        .route("/auth/callback", get(callback))
        .route("/auth/logout", get(logout))
        .fallback(get(ui))
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .layer(axum::middleware::map_response_with_state(
            state.clone(),
            strict_transport,
        ))
        .with_state(state)
}

async fn strict_transport(State(state): State<AppState>, mut response: Response) -> Response {
    if state.config.secure_cookies() {
        response.headers_mut().insert(
            header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static(HSTS),
        );
    }
    response
}

async fn healthz(State(state): State<AppState>) -> Response {
    let checked = tokio::task::spawn_blocking(move || state.health()).await;
    match checked {
        Ok(Ok(())) => "ok".into_response(),
        Ok(Err(reason)) => (StatusCode::SERVICE_UNAVAILABLE, reason).into_response(),
        Err(_) => (StatusCode::SERVICE_UNAVAILABLE, "health check panicked").into_response(),
    }
}

pub(crate) fn too_many(retry_after: u64) -> Response {
    let mut response = (
        StatusCode::TOO_MANY_REQUESTS,
        Json(json!({ "code": "RATE_LIMITED", "message": "too many requests; try again shortly" })),
    )
        .into_response();
    if let Ok(value) = HeaderValue::from_str(&retry_after.to_string()) {
        response.headers_mut().insert(header::RETRY_AFTER, value);
    }
    response
}

fn sign_in_limited(state: &AppState, peer: SocketAddr, headers: &HeaderMap) -> Option<Response> {
    let ip = limits::client_ip(state.config.trust_proxy, peer, headers);
    state.limits.sign_in(ip).err().map(too_many)
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

fn login_cookie(state: &AppState, value: &str, max_age: Duration) -> HeaderValue {
    let mut cookie = format!(
        "{LOGIN_COOKIE}={value}; HttpOnly; SameSite=Lax; Path=/auth; Max-Age={}",
        max_age.as_secs()
    );
    if state.config.secure_cookies() {
        cookie.push_str("; Secure");
    }
    HeaderValue::from_str(&cookie).expect("cookie header")
}

fn login_cookie_value(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|line| line.split(';'))
        .map(str::trim)
        .find_map(|pair| {
            pair.strip_prefix(LOGIN_COOKIE)
                .and_then(|rest| rest.strip_prefix('='))
        })
        .map(str::to_string)
}

#[derive(Deserialize)]
struct LoginQuery {
    device: Option<String>,
}

async fn login(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<LoginQuery>,
) -> Response {
    if let Some(limited) = sign_in_limited(&state, peer, &headers) {
        return limited;
    }
    match state.oidc.begin(&state.logins, q.device).await {
        Ok((url, login_state)) => {
            let mut response = Redirect::to(&url).into_response();
            response.headers_mut().insert(
                header::SET_COOKIE,
                login_cookie(&state, &login_state, LOGIN_TTL),
            );
            response
        }
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

async fn callback(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<CallbackQuery>,
) -> Response {
    if let Some(limited) = sign_in_limited(&state, peer, &headers) {
        return limited;
    }
    if let Some(error) = q.error {
        log("auth.callback.refused", &[("error", &error)]);
        let reason = q.error_description.unwrap_or(error);
        return statics::html(StatusCode::BAD_REQUEST, statics::error_page(&reason));
    }
    let (Some(code), Some(login_state)) = (q.code, q.state) else {
        return statics::html(
            StatusCode::BAD_REQUEST,
            statics::error_page("the sign-in server sent no code"),
        );
    };
    if login_cookie_value(&headers).as_deref() != Some(login_state.as_str()) {
        log("auth.callback.foreign", &[]);
        return statics::html(
            StatusCode::BAD_REQUEST,
            statics::error_page("This sign-in was not started in this browser. Start again."),
        );
    }
    match state.oidc.finish(&state.logins, &code, &login_state).await {
        Ok(signed_in) => {
            let person = signed_in.person;
            log(
                "auth.signed_in",
                &[
                    ("library", &libraries::folder_name(&person.sub)),
                    ("refresh", &signed_in.refresh_token.is_some().to_string()),
                ],
            );
            let sealed = signed_in
                .refresh_token
                .map(|token| state.recheck.sealer.seal(&token));
            state
                .sessions
                .signed_in(&person.sub, sealed.as_deref(), sessions::now_secs());
            if let Some(device) = signed_in.after {
                let id = state.sessions.create(person);
                let mut response = Redirect::to(&format!(
                    "/sync/v1/device/confirm?request={}",
                    oidc::encode(&device)
                ))
                .into_response();
                response.headers_mut().insert(
                    header::SET_COOKIE,
                    cookie(&state, &id, Some(state.sessions.ttl())),
                );
                return response;
            }
            let id = state.sessions.create(person);
            let mut response = statics::html(StatusCode::OK, statics::signed_in());
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
