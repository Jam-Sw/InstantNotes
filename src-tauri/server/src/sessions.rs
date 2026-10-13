use base64::Engine;
use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const COOKIE: &str = "in_session";
pub const DEVICE_PREFIX: &str = "ins_";
const LOGIN_TTL: Duration = Duration::from_secs(10 * 60);
const DEVICE_UNUSED: i64 = 180 * 24 * 60 * 60;
const DEVICES_PER_PERSON: i64 = 100;
const SEEN_EVERY: i64 = 60;
const SESSION: &str = "session";
const DEVICE: &str = "device";

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS grants (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  kind         TEXT NOT NULL,
  sub          TEXT NOT NULL,
  name         TEXT,
  email        TEXT,
  device_name  TEXT,
  signed_in_at INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS grants_sub ON grants(sub);
CREATE TABLE IF NOT EXISTS persons (
  sub        TEXT PRIMARY KEY,
  refresh      BLOB,
  last_check   INTEGER NOT NULL,
  refreshed_at INTEGER
);
";
const WITHOUT_REFRESH: i64 = 24 * 60 * 60;
const CHECK_EVERY: i64 = 60 * 60;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Person {
    pub sub: String,
    pub name: Option<String>,
    pub email: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Grant {
    pub id: String,
    pub person: Person,
    pub device: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub browser: bool,
    pub signed_in_at: i64,
    pub last_seen: i64,
}

pub fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn hash(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub struct Sessions {
    ttl: Duration,
    conn: Mutex<Connection>,
}

impl Sessions {
    pub fn open(path: &Path, ttl: Duration) -> Result<Self, String> {
        let conn =
            Connection::open(path).map_err(|e| format!("cannot open {}: {e}", path.display()))?;
        conn.busy_timeout(Duration::from_secs(5))
            .and_then(|_| conn.pragma_update(None, "journal_mode", "WAL"))
            .and_then(|_| conn.execute_batch(SCHEMA))
            .map_err(|e| format!("cannot prepare {}: {e}", path.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
        }
        Ok(Sessions {
            ttl,
            conn: Mutex::new(conn),
        })
    }

    pub fn ttl(&self) -> Duration {
        self.ttl
    }

    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn healthy(&self) -> Result<(), String> {
        self.conn()
            .query_row("SELECT count(*) FROM grants", [], |r| r.get::<_, i64>(0))
            .map(|_| ())
            .map_err(|e| format!("server.db: {e}"))
    }

    fn insert(
        &self,
        token: &str,
        kind: &str,
        person: &Person,
        device_name: Option<&str>,
        now: i64,
    ) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let _ = self.conn().execute(
            "INSERT INTO grants (id, token_hash, kind, sub, name, email, device_name, signed_in_at, last_seen)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![id, hash(token), kind, person.sub, person.name, person.email, device_name, now],
        );
        id
    }

    pub fn create(&self, person: Person) -> String {
        self.create_session(&person, None, now_secs())
    }

    pub fn create_session(&self, person: &Person, browser: Option<&str>, now: i64) -> String {
        let token = random_token();
        self.insert(&token, SESSION, person, browser, now);
        token
    }

    pub fn create_device(&self, person: &Person, name: &str, now: i64) -> (String, String) {
        let token = format!("{DEVICE_PREFIX}{}", random_token());
        let id = self.insert(&token, DEVICE, person, Some(name), now);
        let _ = self.conn().execute(
            "DELETE FROM grants WHERE kind = ?1 AND sub = ?2 AND id NOT IN (
               SELECT id FROM grants WHERE kind = ?1 AND sub = ?2
               ORDER BY last_seen DESC, signed_in_at DESC, rowid DESC LIMIT ?3)",
            params![DEVICE, person.sub, DEVICES_PER_PERSON],
        );
        (id, token)
    }

    fn lookup(&self, token: &str, kind: &str, now: i64) -> Option<Grant> {
        let unused = match kind {
            SESSION => self.ttl.as_secs() as i64,
            _ => DEVICE_UNUSED,
        };
        let conn = self.conn();
        let found = conn
            .query_row(
                "SELECT g.id, g.sub, g.name, g.email, g.last_seen, g.signed_in_at, p.refresh IS NOT NULL
                 FROM grants g LEFT JOIN persons p ON p.sub = g.sub
                 WHERE g.token_hash = ?1 AND g.kind = ?2",
                params![hash(token), kind],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        Person {
                            sub: r.get(1)?,
                            name: r.get(2)?,
                            email: r.get(3)?,
                        },
                        r.get::<_, i64>(4)?,
                        r.get::<_, i64>(5)?,
                        r.get::<_, bool>(6)?,
                    ))
                },
            )
            .optional()
            .ok()
            .flatten()?;
        let (id, person, last_seen, signed_in_at, refreshable) = found;
        let stale = !refreshable && now - signed_in_at >= WITHOUT_REFRESH;
        if now - last_seen >= unused || stale {
            let _ = conn.execute("DELETE FROM grants WHERE id = ?1", params![id]);
            return None;
        }
        if now - last_seen >= SEEN_EVERY {
            let _ = conn.execute(
                "UPDATE grants SET last_seen = ?1 WHERE id = ?2",
                params![now, id],
            );
        }
        Some(Grant {
            id,
            person,
            device: kind == DEVICE,
        })
    }

    pub fn get(&self, token: &str) -> Option<Person> {
        self.session(token, now_secs()).map(|g| g.person)
    }

    pub fn session(&self, token: &str, now: i64) -> Option<Grant> {
        self.lookup(token, SESSION, now)
    }

    pub fn device(&self, token: &str, now: i64) -> Option<Grant> {
        token
            .starts_with(DEVICE_PREFIX)
            .then(|| self.lookup(token, DEVICE, now))
            .flatten()
    }

    pub fn remove(&self, token: &str) {
        let _ = self.conn().execute(
            "DELETE FROM grants WHERE token_hash = ?1",
            params![hash(token)],
        );
    }

    pub fn list(&self, sub: &str) -> Vec<Device> {
        let conn = self.conn();
        let Ok(mut stmt) = conn.prepare(
            "SELECT id, kind, coalesce(device_name, ''), signed_in_at, last_seen FROM grants
             WHERE sub = ?1 ORDER BY last_seen DESC",
        ) else {
            return Vec::new();
        };
        stmt.query_map(params![sub], |r| {
            Ok(Device {
                id: r.get(0)?,
                browser: r.get::<_, String>(1)? == SESSION,
                name: r.get(2)?,
                signed_in_at: r.get(3)?,
                last_seen: r.get(4)?,
            })
        })
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
    }

    pub fn revoke(&self, sub: &str, id: &str) -> bool {
        self.conn()
            .execute(
                "DELETE FROM grants WHERE sub = ?1 AND id = ?2",
                params![sub, id],
            )
            .map(|n| n > 0)
            .unwrap_or(false)
    }

    pub fn revoke_person(&self, sub: &str) -> usize {
        self.conn()
            .execute("DELETE FROM grants WHERE sub = ?1", params![sub])
            .unwrap_or(0)
    }

    pub fn set_refresh(&self, sub: &str, sealed: Option<&[u8]>, now: i64) {
        let _ = self.conn().execute(
            "INSERT INTO persons (sub, refresh, last_check, refreshed_at) VALUES (?1, ?2, ?3, ?3)
             ON CONFLICT(sub) DO UPDATE SET refresh = excluded.refresh, last_check = excluded.last_check,
               refreshed_at = excluded.refreshed_at",
            params![sub, sealed, now],
        );
    }

    pub fn signed_in(&self, sub: &str, sealed: Option<&[u8]>, now: i64) {
        match sealed {
            Some(_) => self.set_refresh(sub, sealed, now),
            None => {
                let _ = self.conn().execute(
                    "INSERT OR IGNORE INTO persons (sub, refresh, last_check) VALUES (?1, NULL, ?2)",
                    params![sub, now],
                );
            }
        }
    }

    pub fn replace_refresh(
        &self,
        sub: &str,
        expected: &[u8],
        sealed: Option<&[u8]>,
        now: i64,
    ) -> bool {
        self.conn()
            .execute(
                "UPDATE persons SET refresh = ?3, last_check = ?4,
                   refreshed_at = CASE WHEN ?3 IS NULL THEN refreshed_at ELSE ?4 END
                 WHERE sub = ?1 AND refresh = ?2",
                params![sub, expected, sealed, now],
            )
            .map(|n| n > 0)
            .unwrap_or(false)
    }

    pub fn refuse(
        &self,
        sub: &str,
        expected: &[u8],
        signed_in_before: i64,
        now: i64,
    ) -> Option<usize> {
        let mut conn = self.conn();
        let tx = conn.transaction().ok()?;
        let cleared = tx
            .execute(
                "UPDATE persons SET refresh = NULL, last_check = ?3 WHERE sub = ?1 AND refresh = ?2",
                params![sub, expected, now],
            )
            .ok()?;
        if cleared == 0 {
            return None;
        }
        let revoked = tx
            .execute(
                "DELETE FROM grants WHERE sub = ?1 AND signed_in_at < ?2",
                params![sub, signed_in_before],
            )
            .ok()?;
        tx.commit().ok()?;
        Some(revoked)
    }

    pub fn refreshed_at(&self, sub: &str) -> Option<i64> {
        self.conn()
            .query_row(
                "SELECT refreshed_at FROM persons WHERE sub = ?1",
                params![sub],
                |r| r.get(0),
            )
            .ok()
            .flatten()
    }

    pub fn lapse(&self, sub: &str, expected: &[u8], now: i64) -> bool {
        self.conn()
            .execute(
                "UPDATE persons SET refresh = NULL, last_check = ?3 WHERE sub = ?1 AND refresh = ?2",
                params![sub, expected, now],
            )
            .map(|n| n > 0)
            .unwrap_or(false)
    }

    pub fn mark_checked(&self, sub: &str, now: i64) {
        let _ = self.conn().execute(
            "UPDATE persons SET last_check = ?2 WHERE sub = ?1",
            params![sub, now],
        );
    }

    pub fn due_checks(&self, now: i64) -> Vec<(String, Vec<u8>)> {
        let conn = self.conn();
        let Ok(mut stmt) = conn.prepare(
            "SELECT p.sub, p.refresh FROM persons p
             WHERE p.refresh IS NOT NULL AND p.last_check <= ?1
               AND EXISTS (SELECT 1 FROM grants g WHERE g.sub = p.sub)
             ORDER BY p.last_check",
        ) else {
            return Vec::new();
        };
        stmt.query_map(params![now - CHECK_EVERY], |r| Ok((r.get(0)?, r.get(1)?)))
            .map(|rows| rows.filter_map(Result::ok).collect())
            .unwrap_or_default()
    }
}

pub struct PendingLogin {
    pub verifier: String,
    pub nonce: String,
    pub after: Option<String>,
    started: Instant,
}

#[derive(Default)]
pub struct Logins {
    map: Mutex<HashMap<String, PendingLogin>>,
}

impl Logins {
    pub fn begin(&self, after: Option<String>) -> (String, String, String) {
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
                after,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn person(sub: &str) -> Person {
        Person {
            sub: sub.into(),
            name: Some(sub.into()),
            email: None,
        }
    }

    fn open(dir: &tempfile::TempDir) -> Sessions {
        Sessions::open(
            &dir.path().join("server.db"),
            Duration::from_secs(14 * 24 * 3600),
        )
        .unwrap()
    }

    #[test]
    fn a_session_survives_reopening_and_only_its_hash_is_stored() {
        let dir = tempfile::tempdir().unwrap();
        let token = open(&dir).create(person("a"));
        let reopened = open(&dir);
        assert_eq!(reopened.get(&token).unwrap().sub, "a");
        let stored: String = reopened
            .conn()
            .query_row("SELECT token_hash FROM grants", [], |r| r.get(0))
            .unwrap();
        assert_ne!(stored, token);
        assert!(!std::fs::read(dir.path().join("server.db"))
            .unwrap()
            .windows(token.len())
            .any(|w| w == token.as_bytes()));
    }

    #[test]
    fn a_session_slides_and_ends_after_its_ttl_unused() {
        let dir = tempfile::tempdir().unwrap();
        let s = open(&dir);
        let day = 24 * 3600;
        s.set_refresh("a", Some(b"sealed"), 0);
        let token = s.create_session(&person("a"), None, 0);
        assert!(s.session(&token, 13 * day).is_some());
        assert!(s.session(&token, 26 * day).is_some());
        assert!(s.session(&token, 41 * day).is_none());
        let unused = s.create_session(&person("a"), None, 0);
        assert!(s.session(&unused, 14 * day - 1).is_some());
        let idle = s.create_session(&person("a"), None, 0);
        assert!(s.session(&idle, 14 * day).is_none());
    }

    #[test]
    fn a_new_device_survives_the_trim_even_when_every_timestamp_ties() {
        let dir = tempfile::tempdir().unwrap();
        let s = open(&dir);
        s.set_refresh("a", Some(b"sealed"), 0);
        for n in 0..100 {
            s.create_device(&person("a"), &format!("d{n}"), 5);
        }
        let (_, newest) = s.create_device(&person("a"), "newest", 5);
        assert!(s.device(&newest, 6).is_some());
        assert_eq!(s.list("a").len(), 100);
    }

    #[test]
    fn a_sign_in_without_a_refresh_token_keeps_the_one_already_stored() {
        let dir = tempfile::tempdir().unwrap();
        let s = open(&dir);
        s.signed_in("a", Some(b"first"), 0);
        s.create_session(&person("a"), None, 0);
        s.signed_in("a", None, 10);
        let (_, sealed) = s.due_checks(4000).pop().unwrap();
        assert_eq!(sealed, b"first");
        s.signed_in("b", None, 0);
        assert!(s.due_checks(4000).iter().all(|(sub, _)| sub != "b"));
    }

    #[test]
    fn a_refusal_read_before_a_fresh_sign_in_changes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let s = open(&dir);
        s.signed_in("a", Some(b"old"), 0);
        let (_, old_device) = s.create_device(&person("a"), "Old", 0);
        s.signed_in("a", Some(b"new"), 100);
        let (_, new_device) = s.create_device(&person("a"), "New", 100);
        assert_eq!(s.refuse("a", b"old", 50, 200), None);
        assert!(s.device(&old_device, 201).is_some());
        assert_eq!(s.refuse("a", b"new", 50, 200), Some(1));
        assert!(s.device(&old_device, 201).is_none());
        assert!(s.device(&new_device, 201).is_some());
        assert!(!s.replace_refresh("a", b"new", Some(b"newer"), 300));
    }

    #[test]
    fn a_device_token_is_prefixed_and_ends_after_180_days_unused() {
        let dir = tempfile::tempdir().unwrap();
        let s = open(&dir);
        s.set_refresh("a", Some(b"sealed"), 0);
        let (_, token) = s.create_device(&person("a"), "Laptop", 0);
        assert!(token.starts_with(DEVICE_PREFIX));
        assert!(s.session(&token, 1).is_none());
        assert!(s.device(&token, 179 * 24 * 3600).is_some());
        assert!(s.device(&token, 360 * 24 * 3600).is_none());
    }

    #[test]
    fn without_a_refresh_token_a_sign_in_lasts_a_day() {
        let dir = tempfile::tempdir().unwrap();
        let s = open(&dir);
        let day = 24 * 3600;
        s.set_refresh("a", None, 0);
        let (_, device) = s.create_device(&person("a"), "Laptop", 0);
        let session = s.create_session(&person("a"), None, 0);
        assert!(s.device(&device, day - 60).is_some());
        assert!(s.session(&session, day - 60).is_some());
        assert!(s.device(&device, day).is_none());
        assert!(s.session(&session, day).is_none());
        let fresh = s.create_session(&person("a"), None, day);
        assert!(s.session(&fresh, day + 60).is_some());
    }

    #[test]
    fn only_people_with_a_refresh_token_and_a_live_grant_are_due() {
        let dir = tempfile::tempdir().unwrap();
        let s = open(&dir);
        s.set_refresh("with-grant", Some(b"r1"), 0);
        s.set_refresh("no-grant", Some(b"r2"), 0);
        s.set_refresh("no-refresh", None, 0);
        s.create_session(&person("with-grant"), None, 0);
        s.create_session(&person("no-refresh"), None, 0);
        assert!(s.due_checks(1800).is_empty());
        assert_eq!(
            s.due_checks(3600),
            vec![("with-grant".to_string(), b"r1".to_vec())]
        );
        s.mark_checked("with-grant", 3600);
        assert!(s.due_checks(3600).is_empty());
    }

    #[test]
    fn a_person_keeps_at_most_100_devices_dropping_the_least_used() {
        let dir = tempfile::tempdir().unwrap();
        let s = open(&dir);
        let (_, first) = s.create_device(&person("a"), "first", 0);
        for n in 1..=100 {
            s.create_device(&person("a"), &format!("d{n}"), n);
        }
        assert_eq!(s.list("a").len(), 100);
        assert!(s.device(&first, 200).is_none());
    }

    #[test]
    fn revoking_touches_only_that_person() {
        let dir = tempfile::tempdir().unwrap();
        let s = open(&dir);
        let (a_id, a_token) = s.create_device(&person("a"), "A", 0);
        let (_, b_token) = s.create_device(&person("b"), "B", 0);
        assert!(!s.revoke("b", &a_id));
        assert!(s.device(&a_token, 1).is_some());
        assert!(s.revoke("a", &a_id));
        assert!(s.device(&a_token, 1).is_none());
        let session = s.create_session(&person("b"), Some("Firefox"), 0);
        assert_eq!(s.revoke_person("b"), 2);
        assert!(s.device(&b_token, 1).is_none());
        assert!(s.session(&session, 1).is_none());
    }
}
