use crate::oidc::encode;
use crate::sessions::{self, random_token, Person};
use crate::{limits, statics, too_many, AppState};
use axum::extract::{ConnectInfo, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Form, Json, Router};
use base64::Engine;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const REQUEST_TTL: Duration = Duration::from_secs(10 * 60);
const CODE_TTL: Duration = Duration::from_secs(60);
const CALLBACK_PATH: &str = "/callback";
const MAX_DEVICE_NAME: usize = 120;

#[derive(Clone)]
struct Request {
    redirect_uri: String,
    state: String,
    challenge: String,
    device_name: String,
    csrf: String,
    created: Instant,
}

struct Issued {
    request: Request,
    person: Person,
    created: Instant,
}

#[derive(Default)]
pub struct Devices {
    requests: Mutex<HashMap<String, Request>>,
    codes: Mutex<HashMap<String, Issued>>,
}

pub fn loopback_redirect(uri: &str) -> bool {
    let Some(rest) = uri.strip_prefix("http://") else {
        return false;
    };
    let (authority, path) = match rest.find('/') {
        Some(i) => rest.split_at(i),
        None => return false,
    };
    if path != CALLBACK_PATH {
        return false;
    }
    let port = if let Some(v6) = authority.strip_prefix("[::1]:") {
        v6
    } else if let Some(v4) = authority.strip_prefix("127.0.0.1:") {
        v4
    } else {
        return false;
    };
    port.parse::<u16>().is_ok_and(|p| p > 0)
}

fn valid_challenge(challenge: &str) -> bool {
    (43..=128).contains(&challenge.len())
        && challenge
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn s256(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

impl Devices {
    fn add(&self, request: Request) -> String {
        let id = random_token();
        let mut requests = self.requests.lock().unwrap_or_else(|e| e.into_inner());
        requests.retain(|_, r| r.created.elapsed() < REQUEST_TTL);
        requests.insert(id.clone(), request);
        id
    }

    fn get(&self, id: &str) -> Option<Request> {
        let requests = self.requests.lock().unwrap_or_else(|e| e.into_inner());
        requests
            .get(id)
            .filter(|r| r.created.elapsed() < REQUEST_TTL)
            .cloned()
    }

    fn take(&self, id: &str, csrf: &str) -> Option<Request> {
        let mut requests = self.requests.lock().unwrap_or_else(|e| e.into_inner());
        if requests.get(id).is_none_or(|r| r.csrf != csrf) {
            return None;
        }
        requests
            .remove(id)
            .filter(|r| r.created.elapsed() < REQUEST_TTL)
    }

    fn issue(&self, request: Request, person: Person) -> String {
        let code = random_token();
        let mut codes = self.codes.lock().unwrap_or_else(|e| e.into_inner());
        codes.retain(|_, c| c.created.elapsed() < CODE_TTL);
        codes.insert(
            code.clone(),
            Issued {
                request,
                person,
                created: Instant::now(),
            },
        );
        code
    }

    fn redeem(&self, code: &str, verifier: &str, redirect_uri: &str) -> Option<(Person, String)> {
        let issued = self
            .codes
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(code)?;
        let fresh = issued.created.elapsed() < CODE_TTL;
        let same_redirect = issued.request.redirect_uri == redirect_uri;
        let proven = s256(verifier) == issued.request.challenge;
        (fresh && same_redirect && proven).then_some((issued.person, issued.request.device_name))
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/sync/v1/device/authorize", get(authorize))
        .route("/sync/v1/device/confirm", get(confirm))
        .route("/sync/v1/device/allow", post(allow))
        .route("/sync/v1/device/token", post(token))
}

fn bad_request(message: &str) -> Response {
    statics::html(StatusCode::BAD_REQUEST, statics::error_page(message))
}

fn signed_in_person(state: &AppState, headers: &HeaderMap) -> Option<Person> {
    sessions::cookie_value(headers).and_then(|id| state.sessions.get(&id))
}

fn confirm_page(person: &Person, id: &str, request: &Request) -> Response {
    let shown = person
        .name
        .clone()
        .or_else(|| person.email.clone())
        .unwrap_or_else(|| person.sub.clone());
    statics::html(
        StatusCode::OK,
        statics::device_confirm(&request.device_name, &shown, id, &request.csrf),
    )
}

#[derive(Deserialize)]
struct AuthorizeQuery {
    redirect_uri: String,
    state: String,
    code_challenge: String,
    code_challenge_method: String,
    device_name: String,
}

async fn authorize(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<AuthorizeQuery>,
) -> Response {
    let ip = limits::client_ip(state.config.trust_proxy, peer, &headers);
    if let Err(wait) = state.limits.sign_in(ip) {
        return too_many(wait);
    }
    if !loopback_redirect(&q.redirect_uri) {
        return bad_request("This sign-in can only return to an app on your own computer.");
    }
    if q.code_challenge_method != "S256" || !valid_challenge(&q.code_challenge) {
        return bad_request("The app sent an invalid sign-in request.");
    }
    if q.state.is_empty() || q.state.len() > 256 {
        return bad_request("The app sent an invalid sign-in request.");
    }
    let device_name: String = q
        .device_name
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_DEVICE_NAME)
        .collect();
    let request = Request {
        redirect_uri: q.redirect_uri,
        state: q.state,
        challenge: q.code_challenge,
        device_name: if device_name.is_empty() {
            "A device".to_string()
        } else {
            device_name
        },
        csrf: random_token(),
        created: Instant::now(),
    };
    let id = state.devices.add(request.clone());
    match signed_in_person(&state, &headers) {
        Some(person) => confirm_page(&person, &id, &request),
        None => Redirect::to(&format!("/auth/login?device={}", encode(&id))).into_response(),
    }
}

#[derive(Deserialize)]
struct ConfirmQuery {
    request: String,
}

async fn confirm(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<ConfirmQuery>,
) -> Response {
    let Some(request) = state.devices.get(&q.request) else {
        return bad_request("This sign-in expired. Start it again from the app.");
    };
    match signed_in_person(&state, &headers) {
        Some(person) => confirm_page(&person, &q.request, &request),
        None => Redirect::to(&format!("/auth/login?device={}", encode(&q.request))).into_response(),
    }
}

#[derive(Deserialize)]
struct AllowForm {
    request: String,
    csrf: String,
    decision: String,
}

async fn allow(
    State(state): State<AppState>,
    headers: HeaderMap,
    Form(form): Form<AllowForm>,
) -> Response {
    let Some(person) = signed_in_person(&state, &headers) else {
        return bad_request("Sign in again to allow this device.");
    };
    let Some(request) = state.devices.take(&form.request, &form.csrf) else {
        return bad_request("This sign-in expired. Start it again from the app.");
    };
    let target = if form.decision == "allow" {
        crate::log(
            "device.allowed",
            &[("library", &crate::libraries::folder_name(&person.sub))],
        );
        let code = state.devices.issue(request.clone(), person);
        format!(
            "{}?code={}&state={}",
            request.redirect_uri,
            encode(&code),
            encode(&request.state)
        )
    } else {
        format!(
            "{}?error=access_denied&state={}",
            request.redirect_uri,
            encode(&request.state)
        )
    };
    Redirect::to(&target).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenBody {
    code: String,
    code_verifier: String,
    redirect_uri: String,
}

async fn token(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<TokenBody>,
) -> Response {
    let ip = limits::client_ip(state.config.trust_proxy, peer, &headers);
    if let Err(wait) = state.limits.device_token(ip) {
        return too_many(wait);
    }
    let Some((person, device_name)) =
        state
            .devices
            .redeem(&body.code, &body.code_verifier, &body.redirect_uri)
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "code": "INVALID_GRANT", "message": "the sign-in code is not valid" })),
        )
            .into_response();
    };
    let (device_id, token) =
        state
            .sessions
            .create_device(&person, &device_name, sessions::now_secs());
    Json(json!({
        "token": token,
        "deviceId": device_id,
        "person": { "name": person.name, "email": person.email },
    }))
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_loopback_callback_is_accepted() {
        for ok in [
            "http://127.0.0.1:49152/callback",
            "http://[::1]:8000/callback",
        ] {
            assert!(loopback_redirect(ok), "{ok}");
        }
        for refused in [
            "https://127.0.0.1:49152/callback",
            "http://localhost:49152/callback",
            "http://127.0.0.1/callback",
            "http://127.0.0.1:0/callback",
            "http://127.0.0.1:49152/other",
            "http://127.0.0.1:49152/callback?x=1",
            "http://127.0.0.1.evil.example:80/callback",
            "http://127.0.0.1:49152@evil.example/callback",
            "http://evil.example/callback",
            "instantnotes://auth/callback",
        ] {
            assert!(!loopback_redirect(refused), "{refused}");
        }
    }

    fn request() -> Request {
        Request {
            redirect_uri: "http://127.0.0.1:5000/callback".into(),
            state: "s".into(),
            challenge: s256("verifier"),
            device_name: "Laptop".into(),
            csrf: "c".into(),
            created: Instant::now(),
        }
    }

    fn person() -> Person {
        Person {
            sub: "alice".into(),
            name: None,
            email: None,
        }
    }

    #[test]
    fn a_code_works_once_with_its_verifier_and_redirect_and_not_after_a_minute() {
        let devices = Devices::default();
        let code = devices.issue(request(), person());
        assert!(devices
            .redeem(&code, "verifier", "http://127.0.0.1:6000/callback")
            .is_none());
        let code = devices.issue(request(), person());
        assert!(devices
            .redeem(&code, "wrong", "http://127.0.0.1:5000/callback")
            .is_none());
        let code = devices.issue(request(), person());
        assert_eq!(
            devices
                .redeem(&code, "verifier", "http://127.0.0.1:5000/callback")
                .map(|(p, d)| (p.sub, d)),
            Some(("alice".into(), "Laptop".into()))
        );
        assert!(devices
            .redeem(&code, "verifier", "http://127.0.0.1:5000/callback")
            .is_none());
        let stale = devices.issue(request(), person());
        devices
            .codes
            .lock()
            .unwrap()
            .get_mut(&stale)
            .unwrap()
            .created -= CODE_TTL;
        assert!(devices
            .redeem(&stale, "verifier", "http://127.0.0.1:5000/callback")
            .is_none());
    }

    #[test]
    fn a_request_is_taken_once_and_only_with_its_csrf() {
        let devices = Devices::default();
        let id = devices.add(request());
        assert!(devices.take(&id, "forged").is_none());
        assert!(devices.take(&id, "c").is_some());
        assert!(devices.take(&id, "c").is_none());
    }
}
