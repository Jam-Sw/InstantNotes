use crate::libraries::folder_name;
use crate::oidc::{Oidc, Refresh};
use crate::sessions::Sessions;
use chacha20poly1305::aead::{Aead, Generate, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use sha2::Sha256;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::Semaphore;

const NONCE_LEN: usize = 24;
const AT_ONCE: usize = 4;
const WINDOW: i64 = 60 * 60;
const BREAKER_MIN: usize = 3;
const KEY_INFO: &[u8] = b"instantnotes refresh tokens v1";

pub struct Sealer {
    cipher: XChaCha20Poly1305,
}

impl Sealer {
    pub fn new(client_secret: &str) -> Sealer {
        let mut key = [0u8; 32];
        Hkdf::<Sha256>::new(None, client_secret.as_bytes())
            .expand(KEY_INFO, &mut key)
            .expect("32 bytes is a valid HKDF-SHA256 output");
        Sealer {
            cipher: XChaCha20Poly1305::new(&key.into()),
        }
    }

    pub fn seal(&self, plain: &str) -> Vec<u8> {
        let nonce = XNonce::generate();
        let sealed = self
            .cipher
            .encrypt(&nonce, plain.as_bytes())
            .expect("XChaCha20-Poly1305 encryption of a short token");
        [nonce.as_slice(), &sealed].concat()
    }

    pub fn open(&self, sealed: &[u8]) -> Option<String> {
        if sealed.len() <= NONCE_LEN {
            return None;
        }
        let (nonce, body) = sealed.split_at(NONCE_LEN);
        let nonce = XNonce::try_from(nonce).ok()?;
        let plain = self.cipher.decrypt(&nonce, body).ok()?;
        String::from_utf8(plain).ok()
    }
}

#[derive(Default)]
struct Window {
    started: i64,
    checked: usize,
    refused: usize,
}

pub struct Recheck {
    pub sealer: Sealer,
    problem: Mutex<Option<String>>,
    window: Mutex<Window>,
    outage: AtomicBool,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Ran {
    pub accepted: usize,
    pub refused: usize,
    pub revoked: usize,
    pub unreachable: usize,
    pub misconfigured: usize,
    pub refused_people: Vec<String>,
}

impl Recheck {
    pub fn new(client_secret: &str) -> Recheck {
        Recheck {
            sealer: Sealer::new(client_secret),
            problem: Mutex::new(None),
            window: Mutex::new(Window::default()),
            outage: AtomicBool::new(false),
        }
    }

    pub fn problem(&self) -> Option<String> {
        self.problem
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    fn set_problem(&self, problem: Option<String>) {
        *self.problem.lock().unwrap_or_else(|e| e.into_inner()) = problem;
    }

    fn breaker(&self, checked: usize, refused: usize, now: i64) -> bool {
        let mut window = self.window.lock().unwrap_or_else(|e| e.into_inner());
        if now - window.started >= WINDOW {
            *window = Window {
                started: now,
                ..Window::default()
            };
        }
        window.checked += checked;
        window.refused += refused;
        window.refused > BREAKER_MIN && window.refused * 2 > window.checked
    }

    fn unreachable(&self, reason: &str) {
        if !self.outage.swap(true, Ordering::Relaxed) {
            crate::log("auth.recheck.unreachable", &[("reason", reason)]);
        }
    }

    fn keep_rotated(
        &self,
        sessions: &Sessions,
        sub: &str,
        old: &[u8],
        rotated: Option<String>,
        now: i64,
    ) {
        match rotated {
            Some(token) => {
                sessions.replace_refresh(sub, old, Some(&self.sealer.seal(&token)), now);
            }
            None => sessions.mark_checked(sub, now),
        }
    }

    pub async fn run_due(&self, sessions: &Sessions, oidc: &Arc<Oidc>, now: i64) -> Ran {
        let mut ran = Ran::default();
        let due = sessions.due_checks(now);
        if due.is_empty() {
            return ran;
        }
        if let Err(reason) = oidc.reachable().await {
            self.unreachable(&reason);
            ran.unreachable = due.len();
            for (sub, _) in &due {
                sessions.mark_checked(sub, now);
            }
            return ran;
        }
        let permits = Arc::new(Semaphore::new(AT_ONCE));
        let mut checks = tokio::task::JoinSet::new();
        for (sub, sealed) in due {
            let Some(token) = self.sealer.open(&sealed) else {
                crate::log(
                    "auth.recheck.unsealable",
                    &[("library", &folder_name(&sub))],
                );
                sessions.replace_refresh(&sub, &sealed, None, now);
                continue;
            };
            let permits = Arc::clone(&permits);
            let oidc = Arc::clone(oidc);
            checks.spawn(async move {
                let _permit = permits.acquire_owned().await;
                let outcome = oidc.refresh(&token, &sub).await;
                (sub, sealed, token, outcome)
            });
        }
        let mut outcomes = Vec::new();
        while let Some(done) = checks.join_next().await {
            if let Ok(outcome) = done {
                outcomes.push(outcome);
            }
        }
        let refused = outcomes
            .iter()
            .filter(|(_, _, _, o)| matches!(o, Refresh::Refused(_)))
            .count();
        let tripped = self.breaker(outcomes.len(), refused, now);
        if tripped {
            crate::log("auth.recheck.breaker", &[("refused", &refused.to_string())]);
        }
        let mut problem = tripped.then(|| {
            format!(
                "identity re-check paused: {refused} people refused at once; nothing was revoked"
            )
        });
        for (sub, sealed, token, outcome) in outcomes {
            let library = folder_name(&sub);
            match outcome {
                Refresh::Accepted(rotated) => {
                    ran.accepted += 1;
                    let kept = rotated.unwrap_or(token);
                    sessions.replace_refresh(&sub, &sealed, Some(&self.sealer.seal(&kept)), now);
                    if self.outage.swap(false, Ordering::Relaxed) {
                        crate::log("auth.recheck.reachable", &[]);
                    }
                }
                Refresh::Refused(error) if !tripped => {
                    ran.refused += 1;
                    if let Some(revoked) = sessions.refuse(&sub, &sealed, now, now) {
                        ran.revoked += revoked;
                        ran.refused_people.push(sub.clone());
                        crate::log("auth.refused", &[("library", &library), ("error", &error)]);
                    }
                }
                Refresh::Refused(_) => {
                    ran.refused += 1;
                    sessions.mark_checked(&sub, now);
                }
                Refresh::Misconfigured { reason, rotated } => {
                    ran.misconfigured += 1;
                    crate::log("auth.recheck.misconfigured", &[("reason", &reason)]);
                    problem.get_or_insert_with(|| format!("identity re-check failed: {reason}"));
                    self.keep_rotated(sessions, &sub, &sealed, rotated, now);
                }
                Refresh::Unreachable { reason, rotated } => {
                    ran.unreachable += 1;
                    self.unreachable(&reason);
                    self.keep_rotated(sessions, &sub, &sealed, rotated, now);
                }
            }
        }
        if problem.is_some() || ran.accepted > 0 {
            self.set_problem(problem);
        }
        ran
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fake_idp::FakeIdp;
    use crate::sessions::Person;
    use axum::http::StatusCode;
    use serde_json::json;
    use std::time::Duration;

    const HOUR: i64 = 3600;

    struct Run {
        idp: FakeIdp,
        oidc: Arc<Oidc>,
        sessions: Sessions,
        recheck: Recheck,
        _dir: tempfile::TempDir,
    }

    async fn run() -> Run {
        let idp = FakeIdp::start().await;
        let oidc = Arc::new(Oidc::new(
            &idp.issuer(),
            "client",
            "secret",
            "http://app",
            "http://app/cb",
        ));
        let dir = tempfile::tempdir().unwrap();
        let sessions = Sessions::open(
            &dir.path().join("server.db"),
            Duration::from_secs(14 * 86400),
        )
        .unwrap();
        Run {
            idp,
            oidc,
            sessions,
            recheck: Recheck::new("secret"),
            _dir: dir,
        }
    }

    impl Run {
        fn signed_in(&self, sub: &str, refresh: &str) -> (String, String) {
            self.sessions
                .set_refresh(sub, Some(&self.recheck.sealer.seal(refresh)), 0);
            let person = Person {
                sub: sub.into(),
                name: None,
                email: None,
            };
            let session = self.sessions.create_session(&person, None, 0);
            let (_, device) = self.sessions.create_device(&person, "Laptop", 0);
            (session, device)
        }

        fn alive(&self, (session, device): &(String, String), now: i64) -> bool {
            self.sessions.session(session, now).is_some()
                && self.sessions.device(device, now).is_some()
        }

        fn refuse(&self, refresh: &str, error: &str) {
            self.idp
                .answer_refresh(refresh, StatusCode::BAD_REQUEST, json!({ "error": error }));
        }

        fn accept(&self, refresh: &str, sub: &str, rotated: &str) {
            self.idp.answer_refresh(
                refresh,
                StatusCode::OK,
                json!({ "id_token": self.idp.id_token(sub), "refresh_token": rotated }),
            );
        }
    }

    #[test]
    fn a_sealed_token_opens_only_with_the_same_client_secret() {
        let sealer = Sealer::new("secret");
        let sealed = sealer.seal("refresh-token");
        assert!(!sealed.windows(13).any(|w| w == b"refresh-token"));
        assert_eq!(sealer.open(&sealed).as_deref(), Some("refresh-token"));
        assert_eq!(Sealer::new("another secret").open(&sealed), None);
        assert_ne!(sealer.seal("refresh-token"), sealed);
    }

    #[tokio::test]
    async fn an_accepted_person_keeps_syncing_and_the_rotated_token_is_kept() {
        let r = run().await;
        let grants = r.signed_in("alice", "a-1");
        r.accept("a-1", "alice", "a-2");
        let ran = r.recheck.run_due(&r.sessions, &r.oidc, HOUR).await;
        assert_eq!(ran.accepted, 1);
        assert!(r.alive(&grants, HOUR));
        let (_, sealed) = r.sessions.due_checks(2 * HOUR).pop().unwrap();
        assert_eq!(r.recheck.sealer.open(&sealed).as_deref(), Some("a-2"));
        assert_eq!(r.recheck.problem(), None);
    }

    #[tokio::test]
    async fn a_refused_person_loses_every_device_and_session_but_no_data() {
        for error in ["invalid_grant", "access_denied", "invalid_request"] {
            let r = run().await;
            let grants = r.signed_in("alice", "a-1");
            let other = r.signed_in("bob", "b-1");
            r.refuse("a-1", error);
            r.accept("b-1", "bob", "b-2");
            let ran = r.recheck.run_due(&r.sessions, &r.oidc, HOUR).await;
            assert_eq!((ran.refused, ran.revoked), (1, 2), "{error}");
            assert!(!r.alive(&grants, HOUR), "{error}");
            assert!(r.alive(&other, HOUR), "{error}");
            assert!(r
                .sessions
                .due_checks(3 * HOUR)
                .iter()
                .all(|(s, _)| s != "alice"));
        }
    }

    #[tokio::test]
    async fn an_unreachable_provider_revokes_nothing_and_is_retried_next_hour() {
        let r = run().await;
        let grants = r.signed_in("alice", "a-1");
        r.idp
            .answer_refresh("a-1", StatusCode::INTERNAL_SERVER_ERROR, json!({}));
        let ran = r.recheck.run_due(&r.sessions, &r.oidc, HOUR).await;
        assert_eq!(ran.unreachable, 1);
        assert!(r.alive(&grants, HOUR));
        assert!(r.sessions.due_checks(HOUR + 60).is_empty());
        assert_eq!(r.sessions.due_checks(2 * HOUR).len(), 1);
        let gone = Arc::new(Oidc::new(
            "http://127.0.0.1:9",
            "client",
            "secret",
            "http://app",
            "http://app/cb",
        ));
        let ran = r.recheck.run_due(&r.sessions, &gone, 2 * HOUR).await;
        assert_eq!(ran.unreachable, 1);
        assert!(r.alive(&grants, 2 * HOUR));
    }

    #[tokio::test]
    async fn a_misconfigured_server_revokes_nothing_and_says_so_on_healthz() {
        let r = run().await;
        let grants = r.signed_in("alice", "a-1");
        let busy = r.signed_in("bob", "b-1");
        r.idp.answer_refresh(
            "a-1",
            StatusCode::UNAUTHORIZED,
            json!({ "error": "invalid_client" }),
        );
        r.idp
            .answer_refresh("b-1", StatusCode::TOO_MANY_REQUESTS, json!({}));
        let ran = r.recheck.run_due(&r.sessions, &r.oidc, HOUR).await;
        assert_eq!(ran.misconfigured, 2);
        assert!(r.alive(&grants, HOUR) && r.alive(&busy, HOUR));
        assert!(r.recheck.problem().unwrap().contains("re-check failed"));
        r.accept("a-1", "alice", "a-2");
        r.accept("b-1", "bob", "b-2");
        r.recheck.run_due(&r.sessions, &r.oidc, 2 * HOUR).await;
        assert_eq!(r.recheck.problem(), None);
    }

    #[tokio::test]
    async fn many_refusals_at_once_trip_the_breaker_and_revoke_nobody() {
        let r = run().await;
        let people: Vec<_> = (0..5)
            .map(|n| {
                let refresh = format!("r-{n}");
                r.refuse(&refresh, "invalid_grant");
                r.signed_in(&format!("p{n}"), &refresh)
            })
            .collect();
        let ran = r.recheck.run_due(&r.sessions, &r.oidc, HOUR).await;
        assert_eq!((ran.refused, ran.revoked), (5, 0));
        assert!(people.iter().all(|g| r.alive(g, HOUR)));
        assert!(r.recheck.problem().unwrap().contains("paused"));
    }

    #[tokio::test]
    async fn one_refusal_among_many_accepted_is_not_a_fault() {
        let r = run().await;
        for n in 0..5 {
            let refresh = format!("r-{n}");
            r.accept(&refresh, &format!("p{n}"), &format!("{refresh}-2"));
            r.signed_in(&format!("p{n}"), &refresh);
        }
        let refused = r.signed_in("gone", "g-1");
        r.refuse("g-1", "invalid_grant");
        let ran = r.recheck.run_due(&r.sessions, &r.oidc, HOUR).await;
        assert_eq!((ran.accepted, ran.refused, ran.revoked), (5, 1, 2));
        assert!(!r.alive(&refused, HOUR));
    }

    #[tokio::test]
    async fn a_changed_client_secret_falls_back_to_a_daily_sign_in() {
        let r = run().await;
        let grants = r.signed_in("alice", "a-1");
        let changed = Recheck::new("rotated secret");
        let ran = changed.run_due(&r.sessions, &r.oidc, HOUR).await;
        assert_eq!(ran, Ran::default());
        assert!(r.alive(&grants, HOUR));
        assert!(r.sessions.due_checks(3 * HOUR).is_empty());
        assert!(!r.alive(&grants, 24 * HOUR));
    }

    #[tokio::test]
    async fn a_token_rotated_before_the_keys_went_down_is_kept_for_next_hour() {
        let r = run().await;
        let grants = r.signed_in("alice", "a-1");
        r.idp.rotate("key-2");
        r.idp.keys_down(true);
        r.accept("a-1", "alice", "a-2");
        let ran = r.recheck.run_due(&r.sessions, &r.oidc, HOUR).await;
        assert_eq!((ran.unreachable, ran.revoked), (1, 0));
        assert!(r.alive(&grants, HOUR));
        let (_, sealed) = r.sessions.due_checks(2 * HOUR).pop().unwrap();
        assert_eq!(r.recheck.sealer.open(&sealed).as_deref(), Some("a-2"));
        assert_eq!(r.recheck.problem(), None);
    }

    #[tokio::test]
    async fn a_problem_stays_reported_while_any_check_in_the_run_failed() {
        let r = run().await;
        r.signed_in("alice", "a-1");
        r.signed_in("bob", "b-1");
        r.accept("a-1", "alice", "a-2");
        r.idp.answer_refresh(
            "b-1",
            StatusCode::UNAUTHORIZED,
            json!({ "error": "invalid_client" }),
        );
        let ran = r.recheck.run_due(&r.sessions, &r.oidc, HOUR).await;
        assert_eq!((ran.accepted, ran.misconfigured), (1, 1));
        assert!(r.recheck.problem().is_some());
    }

    #[tokio::test]
    async fn the_breaker_counts_across_runs_in_the_same_hour() {
        let r = run().await;
        let first: Vec<_> = (0..2)
            .map(|n| {
                r.refuse(&format!("a-{n}"), "invalid_grant");
                r.signed_in(&format!("a{n}"), &format!("a-{n}"))
            })
            .collect();
        let ran = r.recheck.run_due(&r.sessions, &r.oidc, HOUR).await;
        assert_eq!(ran.revoked, 4);
        assert!(first.iter().all(|g| !r.alive(g, HOUR)));
        let later: Vec<_> = (0..2)
            .map(|n| {
                r.refuse(&format!("b-{n}"), "invalid_grant");
                r.signed_in(&format!("b{n}"), &format!("b-{n}"))
            })
            .collect();
        let ran = r.recheck.run_due(&r.sessions, &r.oidc, HOUR + 60).await;
        assert_eq!((ran.refused, ran.revoked), (2, 0));
        assert!(later.iter().all(|g| r.alive(g, HOUR + 60)));
        assert!(r.recheck.problem().unwrap().contains("paused"));
    }

    #[tokio::test]
    async fn an_unreachable_provider_skips_the_whole_batch_without_waiting_on_each() {
        let r = run().await;
        let gone = Arc::new(Oidc::new(
            "http://127.0.0.1:9",
            "client",
            "secret",
            "http://app",
            "http://app/cb",
        ));
        for n in 0..10 {
            r.signed_in(&format!("p{n}"), &format!("r-{n}"));
        }
        let started = std::time::Instant::now();
        let ran = r.recheck.run_due(&r.sessions, &gone, HOUR).await;
        assert_eq!(ran.unreachable, 10);
        assert!(started.elapsed() < Duration::from_secs(5));
        assert!(r.sessions.due_checks(HOUR + 60).is_empty());
    }
}
