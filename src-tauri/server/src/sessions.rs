use base64::Engine;
use rand::RngCore;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const COOKIE: &str = "in_session";
const LOGIN_TTL: Duration = Duration::from_secs(10 * 60);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Person {
    pub sub: String,
    pub name: Option<String>,
    pub email: Option<String>,
}

pub fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

struct Entry {
    person: Person,
    expires_at: Instant,
}

pub struct Sessions {
    ttl: Duration,
    map: Mutex<HashMap<String, Entry>>,
}

impl Sessions {
    pub fn new(ttl: Duration) -> Self {
        Sessions {
            ttl,
            map: Mutex::new(HashMap::new()),
        }
    }

    pub fn ttl(&self) -> Duration {
        self.ttl
    }

    pub fn create(&self, person: Person) -> String {
        let id = random_token();
        let mut map = self.map.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        map.retain(|_, e| e.expires_at > now);
        map.insert(
            id.clone(),
            Entry {
                person,
                expires_at: now + self.ttl,
            },
        );
        id
    }

    pub fn get(&self, id: &str) -> Option<Person> {
        let mut map = self.map.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        let entry = map.get_mut(id)?;
        if entry.expires_at <= now {
            map.remove(id);
            return None;
        }
        entry.expires_at = now + self.ttl;
        Some(entry.person.clone())
    }

    pub fn remove(&self, id: &str) {
        let mut map = self.map.lock().unwrap_or_else(|e| e.into_inner());
        map.remove(id);
    }
}

pub struct PendingLogin {
    pub verifier: String,
    pub nonce: String,
    started: Instant,
}

#[derive(Default)]
pub struct Logins {
    map: Mutex<HashMap<String, PendingLogin>>,
}

impl Logins {
    pub fn begin(&self) -> (String, String, String) {
        let state = random_token();
        let verifier = random_token();
        let nonce = random_token();
        let mut map = self.map.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        map.retain(|_, p| now.duration_since(p.started) < LOGIN_TTL);
        map.insert(
            state.clone(),
            PendingLogin {
                verifier: verifier.clone(),
                nonce: nonce.clone(),
                started: now,
            },
        );
        (state, verifier, nonce)
    }

    pub fn take(&self, state: &str) -> Option<PendingLogin> {
        let mut map = self.map.lock().unwrap_or_else(|e| e.into_inner());
        let pending = map.remove(state)?;
        (pending.started.elapsed() < LOGIN_TTL).then_some(pending)
    }
}

pub fn cookie_value(headers: &axum::http::HeaderMap) -> Option<String> {
    headers
        .get_all(axum::http::header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|line| line.split(';'))
        .map(str::trim)
        .find_map(|pair| {
            pair.strip_prefix(COOKIE)
                .and_then(|rest| rest.strip_prefix('='))
        })
        .map(str::to_string)
}
