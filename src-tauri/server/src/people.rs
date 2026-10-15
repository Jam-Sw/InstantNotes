use crate::libraries::{create_private_dir, folder_name};
use crate::sessions::{now_secs, Person, Record, Sessions};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

pub const SUB: &str = "{sub}";
pub const USERNAME: &str = "{username}";
pub const EMAIL: &str = "{email}";
pub const CHECK_SUB: &str = "instantnotes-check";
pub const CHECK_EMAIL: &str = "instantnotes-check@localhost";
const MAX_SEGMENT: usize = 128;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Template(String);

#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    Invalid(String),
    NoUsername,
    Collision(String),
    Unmoved(String),
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Refusal::Invalid(what) => write!(f, "{what} cannot name a folder"),
            Refusal::NoUsername => write!(f, "the identity provider sent no preferred_username"),
            Refusal::Collision(folder) => write!(f, "{folder} already belongs to someone else"),
            Refusal::Unmoved(why) => write!(f, "{why}"),
        }
    }
}

pub fn valid_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_SEGMENT
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b'@'))
}

impl Template {
    pub fn parse(raw: &str) -> Result<Template, String> {
        let raw = raw.trim().trim_end_matches('/');
        if !raw.starts_with('/') {
            return Err(format!("must be an absolute path: {raw}"));
        }
        let mut rest = raw;
        let mut placeholders = 0;
        while let Some(open) = rest.find('{') {
            let close = rest[open..]
                .find('}')
                .ok_or_else(|| format!("has an unclosed {{: {raw}"))?;
            let name = &rest[open..open + close + 1];
            if ![SUB, USERNAME, EMAIL].contains(&name) {
                return Err(format!(
                    "knows only {SUB}, {USERNAME} and {EMAIL}, not {name}"
                ));
            }
            placeholders += 1;
            rest = &rest[open + close + 1..];
        }
        if rest.contains('}') {
            return Err(format!("has an unopened }}: {raw}"));
        }
        if placeholders == 0 {
            return Err(format!(
                "needs {SUB}, {USERNAME} or {EMAIL}, or everyone would share one folder: {raw}"
            ));
        }
        if raw.split('/').any(|part| part == "." || part == "..") {
            return Err(format!("must not contain . or .. : {raw}"));
        }
        Ok(Template(raw.to_string()))
    }

    pub fn needs_username(&self) -> bool {
        self.0.contains(USERNAME)
    }

    pub fn apply(
        &self,
        sub: &str,
        username: Option<&str>,
        email: Option<&str>,
    ) -> Result<PathBuf, Refusal> {
        let mut path = self.0.clone();
        for (placeholder, value) in [(SUB, Some(sub)), (USERNAME, username), (EMAIL, email)] {
            if !path.contains(placeholder) {
                continue;
            }
            let value = match value {
                Some(v) => v,
                None if placeholder == USERNAME => return Err(Refusal::NoUsername),
                None => return Err(Refusal::Invalid(placeholder.to_string())),
            };
            if !valid_segment(value) {
                return Err(Refusal::Invalid(placeholder.to_string()));
            }
            path = path.replace(placeholder, value);
        }
        Ok(PathBuf::from(path))
    }
}

pub struct People {
    template: Option<Template>,
    legacy: PathBuf,
    resolved: Mutex<HashMap<String, PathBuf>>,
    told_no_username: AtomicBool,
}

impl People {
    pub fn new(data_dir: &Path, template: Option<Template>) -> People {
        People {
            template,
            legacy: data_dir.join("sync"),
            resolved: Mutex::new(HashMap::new()),
            told_no_username: AtomicBool::new(false),
        }
    }

    pub fn legacy_folder(&self, sub: &str) -> PathBuf {
        self.legacy.join(folder_name(sub))
    }

    fn intended(&self, sub: &str, record: &Record) -> Result<PathBuf, Refusal> {
        match &self.template {
            None => Ok(self.legacy_folder(sub)),
            Some(t) => t.apply(sub, record.username.as_deref(), record.email.as_deref()),
        }
    }

    fn free(&self, sessions: &Sessions, sub: &str, folder: &Path) -> Result<(), Refusal> {
        let shown = folder.display().to_string();
        let cached = self
            .resolved
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .any(|(other, path)| other != sub && path == folder);
        if cached || sessions.folder_owner(&shown, sub).is_some() {
            return Err(Refusal::Collision(shown));
        }
        Ok(())
    }

    fn refused(&self, sub: &str, refusal: &Refusal) {
        match refusal {
            Refusal::NoUsername => {
                if !self.told_no_username.swap(true, Ordering::Relaxed) {
                    crate::log("people_dir.no_username", &[("library", &folder_name(sub))]);
                }
            }
            Refusal::Invalid(what) => crate::log(
                "people_dir.invalid",
                &[("library", &folder_name(sub)), ("value", what)],
            ),
            Refusal::Collision(folder) => crate::log(
                "people_dir.collision",
                &[("library", &folder_name(sub)), ("folder", folder)],
            ),
            Refusal::Unmoved(why) => crate::log(
                "people_dir.move_failed",
                &[("library", &folder_name(sub)), ("reason", why)],
            ),
        }
    }

    pub fn admit(
        &self,
        sessions: &Sessions,
        person: &Person,
        username: Option<&str>,
    ) -> Result<(), Refusal> {
        let record = Record {
            username: username.map(str::to_string),
            email: person.email.clone(),
            folder: None,
        };
        let admitted = self.intended(&person.sub, &record).and_then(|folder| {
            sessions.record_person(&person.sub, username, person.email.as_deref(), now_secs());
            if self.template.is_none() {
                return Ok(());
            }
            self.free(sessions, &person.sub, &folder)?;
            if sessions.record(&person.sub).folder.is_none() {
                sessions.set_folder(&person.sub, &folder.display().to_string());
            }
            Ok(())
        });
        if let Err(refusal) = &admitted {
            self.refused(&person.sub, refusal);
        }
        admitted
    }

    pub fn folder(&self, sessions: &Sessions, sub: &str) -> Result<PathBuf, Refusal> {
        if let Some(found) = self
            .resolved
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(sub)
        {
            return Ok(found.clone());
        }
        let resolved = self.resolve(sessions, sub);
        match &resolved {
            Ok(folder) => {
                if sub != CHECK_SUB {
                    self.resolved
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(sub.to_string(), folder.clone());
                }
            }
            Err(refusal) => self.refused(sub, refusal),
        }
        resolved
    }

    fn resolve(&self, sessions: &Sessions, sub: &str) -> Result<PathBuf, Refusal> {
        if self.template.is_none() {
            return Ok(self.legacy_folder(sub));
        }
        let record = sessions.record(sub);
        let folder = self.intended(sub, &record)?;
        self.free(sessions, sub, &folder)?;
        let old = record
            .folder
            .map(PathBuf::from)
            .filter(|f| f.exists() && *f != folder)
            .unwrap_or_else(|| self.legacy_folder(sub));
        if old.exists() && old != folder {
            self.move_old(sub, &old, &folder)?;
        }
        sessions.set_folder(sub, &folder.display().to_string());
        Ok(folder)
    }

    fn move_old(&self, sub: &str, old: &Path, folder: &Path) -> Result<(), Refusal> {
        let occupied = std::fs::read_dir(folder)
            .map(|mut entries| entries.next().is_some())
            .unwrap_or(false);
        if occupied {
            return Err(Refusal::Unmoved(format!(
                "both {} and {} hold a library",
                old.display(),
                folder.display()
            )));
        }
        if let Some(parent) = folder.parent() {
            create_private_dir(parent).map_err(|e| Refusal::Unmoved(e.to_string()))?;
        }
        if folder.exists() {
            std::fs::remove_dir(folder).map_err(|e| Refusal::Unmoved(e.to_string()))?;
        }
        std::fs::rename(old, folder).map_err(|e| {
            Refusal::Unmoved(format!(
                "cannot move {} to {}: {e}",
                old.display(),
                folder.display()
            ))
        })?;
        crate::log(
            "people_dir.moved",
            &[
                ("library", &folder_name(sub)),
                ("folder", &folder.display().to_string()),
            ],
        );
        Ok(())
    }

    pub fn locate(&self, sub: &str, record: &Record) -> PathBuf {
        let old = self.legacy_folder(sub);
        match record.folder.as_deref().map(PathBuf::from) {
            Some(folder) if folder.exists() || !old.exists() => folder,
            _ => old,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sessions(dir: &Path) -> Sessions {
        Sessions::open(&dir.join("server.db"), std::time::Duration::from_secs(60)).unwrap()
    }

    fn person(sub: &str, email: Option<&str>) -> Person {
        Person {
            sub: sub.into(),
            name: None,
            email: email.map(Into::into),
        }
    }

    fn template(dir: &Path, rest: &str) -> Template {
        Template::parse(&format!("{}/{rest}", dir.display())).unwrap()
    }

    #[test]
    fn a_template_names_known_placeholders_in_an_absolute_path() {
        assert!(Template::parse("/people/{username}/notes").is_ok());
        assert!(Template::parse("/people/{sub}-{email}/").is_ok());
        for refused in [
            "people/{username}",
            "/people/all",
            "/people/{name}",
            "/people/{username",
            "/people/username}",
            "/people/../{sub}",
        ] {
            assert!(Template::parse(refused).is_err(), "{refused}");
        }
    }

    #[test]
    fn each_value_is_one_plain_segment() {
        let t = Template::parse("/people/{username}/notes").unwrap();
        assert_eq!(
            t.apply("s", Some("alice.b@x-y_z"), None).unwrap(),
            PathBuf::from("/people/alice.b@x-y_z/notes")
        );
        for bad in ["", ".", "..", "a/b", "a b", "ä", &"x".repeat(129)] {
            assert_eq!(
                t.apply("s", Some(bad), None),
                Err(Refusal::Invalid(USERNAME.into())),
                "{bad}"
            );
        }
        assert_eq!(t.apply("s", None, None), Err(Refusal::NoUsername));
        let by_email = Template::parse("/people/{email}").unwrap();
        assert_eq!(
            by_email.apply("s", Some("a"), None),
            Err(Refusal::Invalid(EMAIL.into()))
        );
    }

    #[test]
    fn an_older_server_db_gains_the_person_columns() {
        let dir = tempfile::tempdir().unwrap();
        let conn = rusqlite::Connection::open(dir.path().join("server.db")).unwrap();
        conn.execute_batch(
            "CREATE TABLE persons (sub TEXT PRIMARY KEY, refresh BLOB, last_check INTEGER NOT NULL, refreshed_at INTEGER);
             INSERT INTO persons (sub, last_check) VALUES ('old', 1);",
        )
        .unwrap();
        drop(conn);
        let s = sessions(dir.path());
        assert_eq!(s.record("old"), Record::default());
        s.record_person("old", Some("o"), None, 2);
        assert_eq!(s.record("old").username.as_deref(), Some("o"));
        drop(s);
        sessions(dir.path());
    }

    #[test]
    fn unset_keeps_the_old_layout() {
        let dir = tempfile::tempdir().unwrap();
        let s = sessions(dir.path());
        let people = People::new(dir.path(), None);
        people.admit(&s, &person("a|b", None), None).unwrap();
        assert_eq!(
            people.folder(&s, "a|b").unwrap(),
            dir.path().join("sync").join(folder_name("a|b"))
        );
    }

    #[test]
    fn a_sign_in_without_the_claims_the_template_needs_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let s = sessions(dir.path());
        let people = People::new(dir.path(), Some(template(dir.path(), "p/{username}")));
        assert_eq!(
            people.admit(&s, &person("alice", None), None),
            Err(Refusal::NoUsername)
        );
        assert_eq!(
            people.admit(&s, &person("alice", None), Some("../x")),
            Err(Refusal::Invalid(USERNAME.into()))
        );
        assert!(s.record("alice").username.is_none());
    }

    #[test]
    fn the_folder_comes_from_the_record_and_is_resolved_once() {
        let dir = tempfile::tempdir().unwrap();
        let s = sessions(dir.path());
        let people = People::new(dir.path(), Some(template(dir.path(), "p/{username}/notes")));
        people
            .admit(&s, &person("sub-1", Some("a@x")), Some("alice"))
            .unwrap();
        let folder = people.folder(&s, "sub-1").unwrap();
        assert_eq!(folder, dir.path().join("p/alice/notes"));
        assert_eq!(s.record("sub-1").username.as_deref(), Some("alice"));
        people
            .admit(&s, &person("sub-1", Some("a@x")), Some("alicia"))
            .unwrap();
        assert_eq!(people.folder(&s, "sub-1").unwrap(), folder);
        assert_eq!(s.record("sub-1").username.as_deref(), Some("alicia"));
    }

    #[test]
    fn two_people_with_one_folder_are_a_collision() {
        let dir = tempfile::tempdir().unwrap();
        let s = sessions(dir.path());
        let people = People::new(dir.path(), Some(template(dir.path(), "p/{username}")));
        people.admit(&s, &person("one", None), Some("sam")).unwrap();
        assert!(matches!(
            people.admit(&s, &person("two", None), Some("sam")),
            Err(Refusal::Collision(_))
        ));
        people.admit(&s, &person("one", None), Some("sam")).unwrap();
    }

    #[test]
    fn an_old_folder_moves_once_and_a_blocked_move_keeps_refusing() {
        let dir = tempfile::tempdir().unwrap();
        let s = sessions(dir.path());
        let old = dir.path().join("sync").join("alice");
        std::fs::create_dir_all(old.join("blobs")).unwrap();
        std::fs::write(old.join("index.db"), b"x").unwrap();
        let people = People::new(dir.path(), Some(template(dir.path(), "p/{username}")));
        people
            .admit(&s, &person("alice", None), Some("al"))
            .unwrap();
        let folder = people.folder(&s, "alice").unwrap();
        assert_eq!(std::fs::read(folder.join("index.db")).unwrap(), b"x");
        assert!(!old.exists());

        let bob_old = dir.path().join("sync").join("bob");
        std::fs::create_dir_all(&bob_old).unwrap();
        std::fs::write(bob_old.join("index.db"), b"old").unwrap();
        let bob_new = dir.path().join("p/bo");
        std::fs::create_dir_all(&bob_new).unwrap();
        std::fs::write(bob_new.join("index.db"), b"new").unwrap();
        let people = People::new(dir.path(), Some(template(dir.path(), "p/{username}")));
        people.admit(&s, &person("bob", None), Some("bo")).unwrap();
        for _ in 0..2 {
            assert!(matches!(people.folder(&s, "bob"), Err(Refusal::Unmoved(_))));
        }
        assert_eq!(std::fs::read(bob_old.join("index.db")).unwrap(), b"old");
    }
}
