use crate::objects::{JoinAnswer, Op, Refused, Store};
use crate::sessions::{self, Grant};
use crate::{limits, too_many, AppState};
use axum::body::Body;
use axum::extract::{ConnectInfo, DefaultBodyLimit, Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio_stream::StreamExt;

pub const API: u32 = 1;
const MAX_WAIT: u64 = 25;
const MUTATION_HEADER: &str = "x-instantnotes";

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/sync/v1/info", get(info))
        .route("/sync/v1/changes", get(changes))
        .route("/sync/v1/blobs/missing", post(missing))
        .route(
            "/sync/v1/blobs/{sha}",
            get(get_blob)
                .put(put_blob)
                .layer(DefaultBodyLimit::disable()),
        )
        .route("/sync/v1/commit", post(commit))
        .route("/sync/v1/switch", post(switch))
        .route("/sync/v1/keys", get(keys).put(set_keys))
        .route(
            "/sync/v1/keys/requests",
            get(join_requests).post(request_join),
        )
        .route("/sync/v1/keys/requests/{id}", get(join_answer))
        .route("/sync/v1/keys/requests/{id}/approve", post(approve_join))
        .route("/sync/v1/keys/requests/{id}/deny", post(deny_join))
        .route("/sync/v1/devices", get(devices).delete(revoke_all))
        .route("/sync/v1/devices/{id}", axum::routing::delete(revoke_one))
}

fn refusal(code: &str, status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "code": code, "message": message }))).into_response()
}

impl IntoResponse for Refused {
    fn into_response(self) -> Response {
        match self {
            Refused::Gone => refusal("RESET", StatusCode::GONE, "start again from the beginning"),
            Refused::Conflicts(conflicts) => (
                StatusCode::CONFLICT,
                Json(json!({ "code": "CONFLICT", "conflicts": conflicts })),
            )
                .into_response(),
            Refused::BadName(what) => refusal(
                "BAD_NAME",
                StatusCode::BAD_REQUEST,
                &format!("bad name: {what}"),
            ),
            Refused::BadHash(what) => refusal(
                "BAD_HASH",
                StatusCode::BAD_REQUEST,
                &format!("bad hash: {what}"),
            ),
            Refused::MissingBlob(sha) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "code": "MISSING_BLOB", "missing": sha })),
            )
                .into_response(),
            Refused::WrongEpoch => refusal(
                "WRONG_EPOCH",
                StatusCode::CONFLICT,
                "the library changed form; pull again",
            ),
            Refused::TooMany => refusal(
                "TOO_MANY",
                StatusCode::PAYLOAD_TOO_LARGE,
                "too many items in one request",
            ),
            Refused::TooLarge => refusal(
                "TOO_LARGE",
                StatusCode::PAYLOAD_TOO_LARGE,
                "larger than this server accepts",
            ),
            Refused::Exists => refusal("EXISTS", StatusCode::CONFLICT, "already set"),
            Refused::NotFound => refusal("NOT_FOUND", StatusCode::NOT_FOUND, "not found"),
            Refused::Busy => refusal(
                "BUSY",
                StatusCode::TOO_MANY_REQUESTS,
                "too many waiting requests",
            ),
            Refused::Storage(e) => {
                crate::log("sync.storage", &[("error", &e)]);
                refusal(
                    "STORAGE",
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "the server could not store this",
                )
            }
        }
    }
}

pub struct Caller {
    pub grant: Grant,
    pub store: Arc<Store>,
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
}

fn caller(
    state: &AppState,
    peer: SocketAddr,
    headers: &HeaderMap,
) -> Result<Caller, Box<Response>> {
    let now = sessions::now_secs();
    let grant = match bearer(headers) {
        Some(token) => state.sessions.device(token, now),
        None => sessions::cookie_value(headers)
            .filter(|_| headers.contains_key(MUTATION_HEADER))
            .and_then(|id| state.sessions.session(&id, now)),
    };
    let Some(grant) = grant else {
        let ip = limits::client_ip(state.config.trust_proxy, peer, headers);
        if let Err(wait) = state.limits.refused(ip) {
            return Err(Box::new(too_many(wait)));
        }
        return Err(Box::new(refusal(
            "UNAUTHORIZED",
            StatusCode::UNAUTHORIZED,
            "sign in again",
        )));
    };
    if let Err(wait) = state.limits.sync(&grant.id) {
        return Err(Box::new(too_many(wait)));
    }
    let store = state
        .stores
        .of(&grant.person.sub)
        .map_err(|e| Box::new(e.into_response()))?;
    Ok(Caller { grant, store })
}

macro_rules! signed_in {
    ($state:expr, $peer:expr, $headers:expr) => {
        match caller(&$state, $peer, &$headers) {
            Ok(c) => c,
            Err(refused) => return *refused,
        }
    };
}

async fn info(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "app": "instantnotes",
        "api": API,
        "version": env!("CARGO_PKG_VERSION"),
        "maxObjectBytes": state.config.max_object_bytes,
    }))
}

#[derive(Deserialize)]
struct ChangesQuery {
    #[serde(default)]
    since: i64,
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default)]
    wait: u64,
}

async fn changes(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<ChangesQuery>,
) -> Response {
    let c = signed_in!(state, peer, headers);
    let mut head = c.store.watch_head();
    let limit = q.limit.unwrap_or(1000);
    let first = match c.store.changes(q.since, limit) {
        Ok(found) => found,
        Err(e) => return e.into_response(),
    };
    if !first.changes.is_empty() || q.wait == 0 || first.head > q.since {
        return Json(first).into_response();
    }
    let wait = Duration::from_secs(q.wait.min(MAX_WAIT));
    let _ = tokio::time::timeout(wait, head.changed()).await;
    match c.store.changes(q.since, limit) {
        Ok(found) => Json(found).into_response(),
        Err(e) => e.into_response(),
    }
}

#[derive(Deserialize)]
struct Shas {
    shas: Vec<String>,
}

async fn missing(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<Shas>,
) -> Response {
    let c = signed_in!(state, peer, headers);
    match c.store.missing(&body.shas) {
        Ok(missing) => Json(json!({ "missing": missing })).into_response(),
        Err(e) => e.into_response(),
    }
}

async fn put_blob(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(sha): Path<String>,
    body: Body,
) -> Response {
    let c = signed_in!(state, peer, headers);
    if c.store.blob(&sha).is_some() {
        return StatusCode::NO_CONTENT.into_response();
    }
    let mut writer = match c.store.blob_writer(&sha, state.config.max_object_bytes) {
        Ok(w) => w,
        Err(e) => return e.into_response(),
    };
    let mut stream = body.into_data_stream();
    while let Some(chunk) = stream.next().await {
        let Ok(chunk) = chunk else {
            return refusal("INCOMPLETE", StatusCode::BAD_REQUEST, "upload interrupted");
        };
        if let Err(e) = writer.write(&chunk) {
            return e.into_response();
        }
    }
    match writer.finish() {
        Ok(()) => StatusCode::CREATED.into_response(),
        Err(e) => e.into_response(),
    }
}

async fn get_blob(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(sha): Path<String>,
) -> Response {
    let c = signed_in!(state, peer, headers);
    let Some(path) = c.store.blob(&sha) else {
        return Refused::NotFound.into_response();
    };
    match tokio::fs::read(path).await {
        Ok(bytes) => (
            [(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/octet-stream"),
            )],
            bytes,
        )
            .into_response(),
        Err(_) => Refused::NotFound.into_response(),
    }
}

#[derive(Deserialize)]
struct CommitBody {
    epoch: i64,
    ops: Vec<Op>,
}

async fn commit(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<CommitBody>,
) -> Response {
    let c = signed_in!(state, peer, headers);
    match c.store.commit(body.epoch, &body.ops, &c.grant.id) {
        Ok(head) => Json(json!({ "head": head })).into_response(),
        Err(e) => e.into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SwitchBody {
    from_epoch: i64,
    built_at: i64,
    mode: String,
    recipient: Option<String>,
}

async fn switch(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<SwitchBody>,
) -> Response {
    let c = signed_in!(state, peer, headers);
    match c.store.switch(
        body.from_epoch,
        body.built_at,
        &body.mode,
        body.recipient.as_deref(),
    ) {
        Ok(epoch) => {
            crate::log(
                "sync.switch",
                &[
                    (
                        "library",
                        &crate::libraries::folder_name(&c.grant.person.sub),
                    ),
                    ("mode", &body.mode),
                ],
            );
            Json(json!({ "epoch": epoch })).into_response()
        }
        Err(e) => e.into_response(),
    }
}

async fn keys(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
    let c = signed_in!(state, peer, headers);
    match c.store.keys() {
        Ok(keys) => Json(keys).into_response(),
        Err(e) => e.into_response(),
    }
}

#[derive(Deserialize)]
struct KeysBody {
    mode: String,
    recipient: Option<String>,
}

async fn set_keys(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<KeysBody>,
) -> Response {
    let c = signed_in!(state, peer, headers);
    match c.store.set_keys(&body.mode, body.recipient.as_deref()) {
        Ok(keys) => Json(keys).into_response(),
        Err(e) => e.into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JoinBody {
    public_key: String,
    device_name: String,
}

async fn request_join(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<JoinBody>,
) -> Response {
    let c = signed_in!(state, peer, headers);
    if let Err(wait) = state.limits.join(&c.grant.person.sub) {
        return too_many(wait);
    }
    if body.public_key.len() > 512 || body.device_name.chars().count() > 120 {
        return Refused::BadName("join request".into()).into_response();
    }
    match c.store.request_join(&body.public_key, &body.device_name) {
        Ok(id) => Json(json!({ "id": id })).into_response(),
        Err(e) => e.into_response(),
    }
}

#[derive(Deserialize)]
struct WaitQuery {
    #[serde(default)]
    wait: u64,
}

async fn join_requests(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<WaitQuery>,
) -> Response {
    let c = signed_in!(state, peer, headers);
    let mut changed = c.store.watch_joins();
    match c.store.pending_joins() {
        Ok(found) if !found.is_empty() || q.wait == 0 => return Json(found).into_response(),
        Ok(_) => {}
        Err(e) => return e.into_response(),
    }
    let _ =
        tokio::time::timeout(Duration::from_secs(q.wait.min(MAX_WAIT)), changed.changed()).await;
    match c.store.pending_joins() {
        Ok(found) => Json(found).into_response(),
        Err(e) => e.into_response(),
    }
}

async fn join_answer(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(q): Query<WaitQuery>,
) -> Response {
    let c = signed_in!(state, peer, headers);
    let mut changed = c.store.watch_joins();
    match c.store.join(&id) {
        Ok(JoinAnswer::Pending) if q.wait > 0 => {}
        Ok(answer) => return Json(answer).into_response(),
        Err(e) => return e.into_response(),
    }
    let _ =
        tokio::time::timeout(Duration::from_secs(q.wait.min(MAX_WAIT)), changed.changed()).await;
    match c.store.join(&id) {
        Ok(answer) => Json(answer).into_response(),
        Err(e) => e.into_response(),
    }
}

#[derive(Deserialize)]
struct ApproveBody {
    key: String,
}

async fn approve_join(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<ApproveBody>,
) -> Response {
    let c = signed_in!(state, peer, headers);
    if body.key.len() > 4096 {
        return Refused::TooLarge.into_response();
    }
    match c.store.answer_join(&id, Some(&body.key)) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => e.into_response(),
    }
}

async fn deny_join(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let c = signed_in!(state, peer, headers);
    match c.store.answer_join(&id, None) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => e.into_response(),
    }
}

async fn devices(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
    let c = signed_in!(state, peer, headers);
    let list: Vec<serde_json::Value> = state
        .sessions
        .list(&c.grant.person.sub)
        .into_iter()
        .map(|d| {
            json!({
                "id": d.id,
                "name": d.name,
                "browser": d.browser,
                "signedInAt": d.signed_in_at,
                "lastSeen": d.last_seen,
                "current": d.id == c.grant.id,
            })
        })
        .collect();
    Json(list).into_response()
}

async fn revoke_one(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let c = signed_in!(state, peer, headers);
    if state.sessions.revoke(&c.grant.person.sub, &id) {
        StatusCode::NO_CONTENT.into_response()
    } else {
        Refused::NotFound.into_response()
    }
}

async fn revoke_all(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
    let c = signed_in!(state, peer, headers);
    let revoked = state.sessions.revoke_person(&c.grant.person.sub);
    c.store.cancel_joins();
    crate::log(
        "sync.signed_out_everywhere",
        &[
            (
                "library",
                &crate::libraries::folder_name(&c.grant.person.sub),
            ),
            ("grants", &revoked.to_string()),
        ],
    );
    StatusCode::NO_CONTENT.into_response()
}
