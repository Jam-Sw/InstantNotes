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
    pairing: Option<Pairing>,
}

#[derive(Clone)]
struct Pairing {
    user_code: String,
    device_code: String,
    answer: Option<(Decision, Instant)>,
}

#[derive(Clone)]
enum Decision {
    Code(String),
    Denied,
}

enum Polled {
    Answered(Decision),
    Waiting,
    Gone,
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

fn same(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |diff, (x, y)| diff | (x ^ y))
            == 0
}

fn waiting(r: &Request) -> bool {
    r.created.elapsed() < REQUEST_TTL && r.pairing.as_ref().is_none_or(|p| p.answer.is_none())
}

fn live(r: &Request) -> bool {
    match r.pairing.as_ref().and_then(|p| p.answer.as_ref()) {
        Some((_, at)) => at.elapsed() < CODE_TTL,
        None => r.created.elapsed() < REQUEST_TTL,
    }
}

const USER_CODE_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const USER_CODE_LEN: usize = 8;
const POLL_SECONDS: u64 = 5;

fn user_code() -> String {
    use rand::RngExt;
    let mut rng = rand::rng();
    (0..USER_CODE_LEN)
        .map(|_| USER_CODE_ALPHABET[rng.random_range(0..USER_CODE_ALPHABET.len())] as char)
        .collect()
}

fn normalize_user_code(typed: &str) -> String {
    typed
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

fn show_user_code(code: &str) -> String {
    format!(
        "{}-{}",
        &code[..USER_CODE_LEN / 2],
        &code[USER_CODE_LEN / 2..]
    )
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
    port.bytes().all(|b| b.is_ascii_digit()) && port.parse::<u16>().is_ok_and(|p| p > 0)
}

fn valid_verifier(verifier: &str) -> bool {
    (43..=128).contains(&verifier.len())
        && verifier
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~'))
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
        requests.retain(|_, r| live(r));
        requests.insert(id.clone(), request);
        id
    }

    fn get(&self, id: &str) -> Option<Request> {
        let requests = self.requests.lock().unwrap_or_else(|e| e.into_inner());
        requests.get(id).filter(|r| waiting(r)).cloned()
    }

    fn take(&self, id: &str, csrf: &str) -> Option<Request> {
        let mut requests = self.requests.lock().unwrap_or_else(|e| e.into_inner());
        if requests
            .get(id)
            .is_none_or(|r| r.pairing.is_some() || !same(&r.csrf, csrf))
        {
            return None;
        }
        requests.remove(id).filter(waiting)
    }

    fn answer_pairing(&self, id: &str, csrf: &str, person: &Person, allowed: bool) -> bool {
        let mut requests = self.requests.lock().unwrap_or_else(|e| e.into_inner());
        let Some(request) = requests
            .get_mut(id)
            .filter(|r| r.pairing.is_some() && waiting(r) && same(&r.csrf, csrf))
        else {
            return false;
        };
        let decision = if allowed {
            Decision::Code(self.issue(request.clone(), person.clone()))
        } else {
            Decision::Denied
        };
        if let Some(pairing) = request.pairing.as_mut() {
            pairing.answer = Some((decision, Instant::now()));
        }
        true
    }

    fn poll(&self, device_code: &str) -> Polled {
        let mut requests = self.requests.lock().unwrap_or_else(|e| e.into_inner());
        requests.retain(|_, r| live(r));
        let Some(id) = requests
            .iter()
            .find(|(_, r)| {
                r.pairing
                    .as_ref()
                    .is_some_and(|p| same(&p.device_code, device_code))
            })
            .map(|(id, _)| id.clone())
        else {
            return Polled::Gone;
        };
        let answered = requests
            .get(&id)
            .and_then(|r| r.pairing.as_ref())
            .is_some_and(|p| p.answer.is_some());
        if !answered {
            return Polled::Waiting;
        }
        match requests
            .remove(&id)
            .and_then(|r| r.pairing)
            .and_then(|p| p.answer)
        {
            Some((decision, _)) => Polled::Answered(decision),
            None => Polled::Gone,
        }
    }

    fn find_pairing(&self, typed: &str) -> Option<(String, Request)> {
        let wanted = normalize_user_code(typed);
        if wanted.len() != USER_CODE_LEN {
            return None;
        }
        let requests = self.requests.lock().unwrap_or_else(|e| e.into_inner());
        requests
            .iter()
            .find(|(_, r)| {
                waiting(r)
                    && r.pairing
                        .as_ref()
                        .is_some_and(|p| same(&p.user_code, &wanted))
            })
            .map(|(id, r)| (id.clone(), r.clone()))
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
        let proven = valid_verifier(verifier) && same(&s256(verifier), &issued.request.challenge);
        (fresh && same_redirect && proven).then_some((issued.person, issued.request.device_name))
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/sync/v1/device/authorize", get(authorize))
        .route("/sync/v1/device/confirm", get(confirm))
        .route("/sync/v1/device/allow", post(allow))
        .route("/sync/v1/device/token", post(token))
        .route("/sync/v1/device/code", post(code))
        .route("/sync/v1/device/link", get(link))
        .route("/sync/v1/device/poll", post(poll))
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
    let code = request
        .pairing
        .as_ref()
        .map(|p| show_user_code(&p.user_code));
    statics::html(
        StatusCode::OK,
        statics::device_confirm(
            &request.device_name,
            &shown,
            code.as_deref(),
            id,
            &request.csrf,
        ),
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
        pairing: None,
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
    let allowed = form.decision == "allow";
    if state
        .devices
        .answer_pairing(&form.request, &form.csrf, &person, allowed)
    {
        if allowed {
            crate::log(
                "device.allowed",
                &[("library", &crate::libraries::folder_name(&person.sub))],
            );
        }
        return statics::html(StatusCode::OK, statics::device_paired(allowed));
    }
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
    issued_token(&state, person, &device_name)
}

fn issued_token(state: &AppState, person: Person, device_name: &str) -> Response {
    let (device_id, token) =
        state
            .sessions
            .create_device(&person, device_name, sessions::now_secs());
    Json(json!({
        "token": token,
        "deviceId": device_id,
        "person": { "name": person.name, "email": person.email },
    }))
    .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodeBody {
    code_challenge: String,
    device_name: String,
}

async fn code(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<CodeBody>,
) -> Response {
    let ip = limits::client_ip(state.config.trust_proxy, peer, &headers);
    if let Err(wait) = state.limits.sign_in(ip) {
        return too_many(wait);
    }
    if !valid_challenge(&body.code_challenge) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "code": "BAD_REQUEST", "message": "invalid code challenge" })),
        )
            .into_response();
    }
    let device_name: String = body
        .device_name
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_DEVICE_NAME)
        .collect();
    let pairing = user_code();
    let device_code = random_token();
    let request = Request {
        redirect_uri: String::new(),
        state: String::new(),
        challenge: body.code_challenge,
        device_name: if device_name.is_empty() {
            "A device".to_string()
        } else {
            device_name
        },
        csrf: random_token(),
        created: Instant::now(),
        pairing: Some(Pairing {
            user_code: pairing.clone(),
            device_code: device_code.clone(),
            answer: None,
        }),
    };
    state.devices.add(request);
    let uri = format!(
        "{}/sync/v1/device/link",
        state.config.public_url.trim_end_matches('/')
    );
    Json(json!({
        "deviceCode": device_code,
        "userCode": show_user_code(&pairing),
        "verificationUri": uri,
        "verificationUriComplete": format!("{uri}?code={}", show_user_code(&pairing)),
        "expiresIn": REQUEST_TTL.as_secs(),
        "interval": POLL_SECONDS,
    }))
    .into_response()
}

#[derive(Deserialize)]
struct LinkQuery {
    code: Option<String>,
}

async fn link(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<LinkQuery>,
) -> Response {
    let ip = limits::client_ip(state.config.trust_proxy, peer, &headers);
    if let Err(wait) = state.limits.sign_in(ip) {
        return too_many(wait);
    }
    let Some(typed) = q.code.filter(|c| !c.trim().is_empty()) else {
        return statics::html(StatusCode::OK, statics::device_link(None));
    };
    let Some((id, request)) = state.devices.find_pairing(&typed) else {
        return statics::html(
            StatusCode::NOT_FOUND,
            statics::device_link(Some("That code is not valid or has expired.")),
        );
    };
    match signed_in_person(&state, &headers) {
        Some(person) => confirm_page(&person, &id, &request),
        None => Redirect::to(&format!("/auth/login?device={}", encode(&id))).into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PollBody {
    device_code: String,
    code_verifier: String,
}

async fn poll(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<PollBody>,
) -> Response {
    let ip = limits::client_ip(state.config.trust_proxy, peer, &headers);
    if let Err(wait) = state.limits.device_poll(ip) {
        return too_many(wait);
    }
    let refuse = |code: &str, message: &str| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "code": code, "message": message })),
        )
            .into_response()
    };
    match state.devices.poll(&body.device_code) {
        Polled::Answered(Decision::Code(code)) => {
            match state.devices.redeem(&code, &body.code_verifier, "") {
                Some((person, device_name)) => issued_token(&state, person, &device_name),
                None => refuse("INVALID_GRANT", "the sign-in code is not valid"),
            }
        }
        Polled::Answered(Decision::Denied) => refuse("ACCESS_DENIED", "sign-in was cancelled"),
        Polled::Waiting => (
            StatusCode::ACCEPTED,
            Json(json!({ "code": "PENDING", "message": "waiting for the person" })),
        )
            .into_response(),
        Polled::Gone => refuse("EXPIRED", "this sign-in expired"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VERIFIER: &str = "a-valid-verifier.of~forty_three_characters_x";

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
            "http://127.0.0.1:+80/callback",
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
            challenge: s256(VERIFIER),
            device_name: "Laptop".into(),
            csrf: "c".into(),
            created: Instant::now(),
            pairing: None,
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
            .redeem(&code, VERIFIER, "http://127.0.0.1:6000/callback")
            .is_none());
        let code = devices.issue(request(), person());
        assert!(devices
            .redeem(&code, "wrong", "http://127.0.0.1:5000/callback")
            .is_none());
        let code = devices.issue(request(), person());
        assert_eq!(
            devices
                .redeem(&code, VERIFIER, "http://127.0.0.1:5000/callback")
                .map(|(p, d)| (p.sub, d)),
            Some(("alice".into(), "Laptop".into()))
        );
        assert!(devices
            .redeem(&code, VERIFIER, "http://127.0.0.1:5000/callback")
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
            .redeem(&stale, VERIFIER, "http://127.0.0.1:5000/callback")
            .is_none());
    }

    #[test]
    fn a_typed_pairing_code_finds_its_request_whatever_the_spacing_or_case() {
        let devices = Devices::default();
        let id = devices.add(pairing_request());
        assert_eq!(devices.find_pairing(" abcd-2345 ").map(|f| f.0), Some(id));
        assert!(devices.find_pairing("ABCD-2346").is_none());
        assert!(devices.find_pairing("ABCD").is_none());
        let code = user_code();
        assert_eq!(code.len(), USER_CODE_LEN);
        assert!(code.bytes().all(|b| USER_CODE_ALPHABET.contains(&b)));
        assert_eq!(show_user_code("ABCD2345"), "ABCD-2345");
    }

    #[test]
    fn a_request_is_taken_once_and_only_with_its_csrf() {
        let devices = Devices::default();
        let id = devices.add(request());
        assert!(devices.take(&id, "forged").is_none());
        assert!(devices.take(&id, "c").is_some());
        assert!(devices.take(&id, "c").is_none());
    }

    fn pairing_request() -> Request {
        Request {
            redirect_uri: String::new(),
            state: String::new(),
            pairing: Some(Pairing {
                user_code: "ABCD2345".into(),
                device_code: "the-device-code".into(),
                answer: None,
            }),
            ..request()
        }
    }

    #[test]
    fn a_pairing_is_polled_by_its_device_code_and_answered_once() {
        let devices = Devices::default();
        let id = devices.add(pairing_request());
        assert_ne!(id, "the-device-code");
        assert!(matches!(devices.poll(&id), Polled::Gone));
        assert!(matches!(devices.poll("the-device-code"), Polled::Waiting));
        assert!(
            devices.take(&id, "c").is_none(),
            "only answer_pairing answers"
        );
        assert!(!devices.answer_pairing(&id, "forged", &person(), true));
        assert!(devices.answer_pairing(&id, "c", &person(), true));
        assert!(!devices.answer_pairing(&id, "c", &person(), false));
        assert!(
            devices.get(&id).is_none(),
            "an answered pairing is not shown again"
        );
        assert!(devices.find_pairing("ABCD-2345").is_none());
        let Polled::Answered(Decision::Code(code)) = devices.poll("the-device-code") else {
            panic!("the answer should be there");
        };
        assert!(matches!(devices.poll("the-device-code"), Polled::Gone));
        assert_eq!(
            devices.redeem(&code, VERIFIER, "").map(|(p, _)| p.sub),
            Some("alice".into())
        );
    }

    #[test]
    fn an_answer_waits_a_minute_for_the_app() {
        let devices = Devices::default();
        let id = devices.add(pairing_request());
        assert!(devices.answer_pairing(&id, "c", &person(), false));
        if let Some(Pairing {
            answer: Some((_, at)),
            ..
        }) = devices
            .requests
            .lock()
            .unwrap()
            .get_mut(&id)
            .and_then(|r| r.pairing.as_mut())
        {
            *at -= CODE_TTL;
        }
        assert!(matches!(devices.poll("the-device-code"), Polled::Gone));
    }

    #[test]
    fn secrets_compare_equal_only_when_identical() {
        assert!(same("abc", "abc"));
        assert!(!same("abc", "abd"));
        assert!(!same("abc", "abcd"));
        assert!(same("", ""));
    }
}
