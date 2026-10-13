use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};
use tokio::sync::watch;

pub const INDEX_FILE: &str = "index.db";
pub const BLOBS_DIR: &str = "blobs";
pub const PLAIN: &str = "plain";
pub const ENCRYPTED: &str = "encrypted";
const PAGE: usize = 1000;
const MAX_OPS: usize = 5000;
const JOIN_TTL: i64 = 10 * 60;
const PENDING_JOINS: i64 = 10;
const SWEEP_AFTER: Duration = Duration::from_secs(24 * 60 * 60);

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS objects (
  epoch  INTEGER NOT NULL,
  name   TEXT NOT NULL,
  sha    TEXT,
  size   INTEGER NOT NULL,
  seq    INTEGER NOT NULL,
  device TEXT,
  at     INTEGER NOT NULL,
  PRIMARY KEY (epoch, name)
);
CREATE INDEX IF NOT EXISTS objects_seq ON objects(epoch, seq);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS joins (
  id          TEXT PRIMARY KEY,
  public_key  TEXT NOT NULL,
  device_name TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  answer      BLOB,
  denied      INTEGER NOT NULL DEFAULT 0
);
";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub name: String,
    pub sha: Option<String>,
    pub size: i64,
    pub deleted: bool,
    pub seq: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    pub library_id: String,
    pub epoch: i64,
    pub head: i64,
    pub changes: Vec<Change>,
    pub more: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Op {
    pub name: String,
    pub base: Option<String>,
    pub sha: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Conflict {
    pub name: String,
    pub current: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Refused {
    Gone,
    Conflicts(Vec<Conflict>),
    BadName(String),
    BadHash(String),
    MissingBlob(String),
    WrongEpoch,
    TooMany,
    TooLarge,
    Exists,
    NotFound,
    Busy,
    Incomplete,
    Storage(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Keys {
    pub library_id: String,
    pub mode: Option<String>,
    pub recipient: Option<String>,
    pub epoch: i64,
    pub head: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Join {
    pub id: String,
    pub public_key: String,
    pub device_name: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum JoinAnswer {
    Pending,
    Approved { key: String },
    Denied,
}

fn storage(e: impl std::fmt::Display) -> Refused {
    Refused::Storage(e.to_string())
}

pub fn valid_name(name: &str) -> bool {
    name.len() == 64
        && name
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn now_secs() -> i64 {
    crate::sessions::now_secs()
}

pub struct Store {
    dir: PathBuf,
    conn: Mutex<Connection>,
    head: watch::Sender<i64>,
    joins: watch::Sender<u64>,
}

impl Store {
    pub fn open(dir: &Path) -> Result<Store, Refused> {
        if let Some(parent) = dir.parent() {
            crate::libraries::create_private_dir(parent).map_err(storage)?;
        }
        crate::libraries::create_private_dir(dir).map_err(storage)?;
        crate::libraries::create_private_dir(&dir.join(BLOBS_DIR)).map_err(storage)?;
        let conn = Connection::open(dir.join(INDEX_FILE)).map_err(storage)?;
        conn.busy_timeout(Duration::from_secs(5)).map_err(storage)?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(storage)?;
        conn.execute_batch(SCHEMA).map_err(storage)?;
        conn.execute(
            "INSERT OR IGNORE INTO meta (key, value) VALUES ('library_id', ?1), ('head', '0'), ('epoch', '1')",
            params![uuid::Uuid::new_v4().to_string()],
        )
        .map_err(storage)?;
        let head = meta_i64(&conn, "head")?;
        Ok(Store {
            dir: dir.to_path_buf(),
            conn: Mutex::new(conn),
            head: watch::channel(head).0,
            joins: watch::channel(0).0,
        })
    }

    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn watch_head(&self) -> watch::Receiver<i64> {
        self.head.subscribe()
    }

    pub fn watch_joins(&self) -> watch::Receiver<u64> {
        self.joins.subscribe()
    }

    fn blob_path(&self, sha: &str) -> PathBuf {
        self.dir.join(BLOBS_DIR).join(&sha[..2]).join(sha)
    }

    pub fn blob(&self, sha: &str) -> Option<PathBuf> {
        if !valid_name(sha) {
            return None;
        }
        let path = self.blob_path(sha);
        path.is_file().then_some(path)
    }

    pub fn missing(&self, shas: &[String]) -> Result<Vec<String>, Refused> {
        if shas.len() > PAGE {
            return Err(Refused::TooMany);
        }
        if let Some(bad) = shas.iter().find(|s| !valid_name(s)) {
            return Err(Refused::BadHash(bad.clone()));
        }
        Ok(shas
            .iter()
            .filter(|s| match self.blob(s) {
                Some(path) => {
                    let _ = std::fs::File::options()
                        .write(true)
                        .open(path)
                        .and_then(|f| f.set_modified(SystemTime::now()));
                    false
                }
                None => true,
            })
            .cloned()
            .collect())
    }

    #[cfg(test)]
    pub fn put_blob(
        &self,
        sha: &str,
        chunks: impl IntoIterator<Item = Vec<u8>>,
        max: u64,
    ) -> Result<(), Refused> {
        let mut writer = self.blob_writer(sha, max)?;
        for chunk in chunks {
            writer.write(&chunk)?;
        }
        writer.finish()
    }

    pub fn blob_writer(&self, sha: &str, max: u64) -> Result<BlobWriter, Refused> {
        if !valid_name(sha) {
            return Err(Refused::BadHash(sha.to_string()));
        }
        let target = self.blob_path(sha);
        let dir = target.parent().map(Path::to_path_buf).unwrap_or_default();
        crate::libraries::create_private_dir(&dir).map_err(storage)?;
        let file = tempfile::NamedTempFile::new_in(&dir).map_err(storage)?;
        Ok(BlobWriter {
            file,
            hasher: Sha256::new(),
            size: 0,
            max,
            sha: sha.to_string(),
            target,
        })
    }

    pub fn changes(&self, since: i64, limit: usize) -> Result<Changes, Refused> {
        let conn = self.conn();
        let head = meta_i64(&conn, "head")?;
        let epoch = meta_i64(&conn, "epoch")?;
        if since > head {
            return Err(Refused::Gone);
        }
        let limit = limit.clamp(1, PAGE);
        let mut stmt = conn
            .prepare(
                "SELECT name, sha, size, seq FROM objects WHERE epoch = ?1 AND seq > ?2 ORDER BY seq, name LIMIT ?3",
            )
            .map_err(storage)?;
        let mut rows: Vec<Change> = stmt
            .query_map(params![epoch, since, (limit + 1) as i64], |r| {
                let sha: Option<String> = r.get(1)?;
                Ok(Change {
                    name: r.get(0)?,
                    deleted: sha.is_none(),
                    sha,
                    size: r.get(2)?,
                    seq: r.get(3)?,
                })
            })
            .map_err(storage)?
            .collect::<Result<_, _>>()
            .map_err(storage)?;
        let mut more = rows.len() > limit;
        if more {
            rows.truncate(limit);
            let last = rows.last().map(|c| c.seq).unwrap_or(since);
            let mut rest = conn
                .prepare("SELECT name, sha, size, seq FROM objects WHERE epoch = ?1 AND seq = ?2 ORDER BY name")
                .map_err(storage)?;
            let whole: Vec<Change> = rest
                .query_map(params![epoch, last], |r| {
                    let sha: Option<String> = r.get(1)?;
                    Ok(Change {
                        name: r.get(0)?,
                        deleted: sha.is_none(),
                        sha,
                        size: r.get(2)?,
                        seq: r.get(3)?,
                    })
                })
                .map_err(storage)?
                .collect::<Result<_, _>>()
                .map_err(storage)?;
            rows.retain(|c| c.seq != last);
            rows.extend(whole);
            more = conn
                .query_row(
                    "SELECT EXISTS (SELECT 1 FROM objects WHERE epoch = ?1 AND seq > ?2)",
                    params![epoch, last],
                    |r| r.get(0),
                )
                .map_err(storage)?;
        }
        Ok(Changes {
            library_id: meta(&conn, "library_id")?.unwrap_or_default(),
            epoch,
            head,
            changes: rows,
            more,
        })
    }

    pub fn commit(
        &self,
        epoch: i64,
        ops: &[Op],
        device: &str,
        reset: bool,
    ) -> Result<i64, Refused> {
        if ops.len() > MAX_OPS {
            return Err(Refused::TooMany);
        }
        for op in ops {
            if !valid_name(&op.name) {
                return Err(Refused::BadName(op.name.clone()));
            }
            for sha in op.base.iter().chain(op.sha.iter()) {
                if !valid_name(sha) {
                    return Err(Refused::BadHash(sha.clone()));
                }
            }
        }
        let mut conn = self.conn();
        let mut sizes = HashMap::new();
        for sha in ops.iter().filter_map(|op| op.sha.as_ref()) {
            let size = self
                .blob(sha)
                .and_then(|p| std::fs::metadata(p).ok())
                .map(|m| m.len() as i64)
                .ok_or_else(|| Refused::MissingBlob(sha.clone()))?;
            sizes.insert(sha.clone(), size);
        }
        let tx = conn.transaction().map_err(storage)?;
        let current_epoch = meta_i64(&tx, "epoch")?;
        if epoch != current_epoch && epoch != current_epoch + 1 {
            return Err(Refused::WrongEpoch);
        }
        let mut conflicts = Vec::new();
        let staging = epoch != current_epoch;
        if staging && reset {
            tx.execute("DELETE FROM objects WHERE epoch = ?1", params![epoch])
                .map_err(storage)?;
        }
        for op in ops.iter().filter(|_| !staging) {
            let current: Option<String> = tx
                .query_row(
                    "SELECT sha FROM objects WHERE epoch = ?1 AND name = ?2",
                    params![epoch, op.name],
                    |r| r.get(0),
                )
                .optional()
                .map_err(storage)?
                .flatten();
            if current != op.base {
                conflicts.push(Conflict {
                    name: op.name.clone(),
                    current,
                });
            }
        }
        if !conflicts.is_empty() {
            return Err(Refused::Conflicts(conflicts));
        }
        let seq = meta_i64(&tx, "head")? + 1;
        let at = now_secs();
        for op in ops {
            let size = op
                .sha
                .as_ref()
                .and_then(|s| sizes.get(s))
                .copied()
                .unwrap_or(0);
            tx.execute(
                "INSERT INTO objects (epoch, name, sha, size, seq, device, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(epoch, name) DO UPDATE SET sha = excluded.sha, size = excluded.size,
                   seq = excluded.seq, device = excluded.device, at = excluded.at",
                params![epoch, op.name, op.sha, size, seq, device, at],
            )
            .map_err(storage)?;
        }
        set_meta(&tx, "head", &seq.to_string())?;
        tx.commit().map_err(storage)?;
        self.head.send_replace(seq);
        Ok(seq)
    }

    pub fn switch(
        &self,
        from_epoch: i64,
        built_at: i64,
        mode: &str,
        recipient: Option<&str>,
        expected: usize,
    ) -> Result<i64, Refused> {
        if mode != PLAIN && mode != ENCRYPTED {
            return Err(Refused::BadName(mode.to_string()));
        }
        if (mode == ENCRYPTED) != recipient.is_some() {
            return Err(Refused::BadName("recipient".into()));
        }
        let mut conn = self.conn();
        let tx = conn.transaction().map_err(storage)?;
        if meta_i64(&tx, "epoch")? != from_epoch {
            return Err(Refused::WrongEpoch);
        }
        let live = |epoch: i64| -> Result<usize, Refused> {
            tx.query_row(
                "SELECT count(*) FROM objects WHERE epoch = ?1 AND sha IS NOT NULL",
                params![epoch],
                |r| r.get::<_, i64>(0),
            )
            .map(|n| n as usize)
            .map_err(storage)
        };
        let staged = live(from_epoch + 1)?;
        if staged != expected || staged + 1 < live(from_epoch)? {
            return Err(Refused::Incomplete);
        }
        let old_blobs: Vec<String> = {
            let mut stmt = tx
                .prepare("SELECT DISTINCT sha FROM objects WHERE epoch = ?1 AND sha IS NOT NULL")
                .map_err(storage)?;
            let rows = stmt
                .query_map(params![from_epoch], |r| r.get(0))
                .map_err(storage)?
                .collect::<Result<_, _>>()
                .map_err(storage)?;
            rows
        };
        let moved: bool = tx
            .query_row(
                "SELECT EXISTS (SELECT 1 FROM objects WHERE epoch = ?1 AND seq > ?2)",
                params![from_epoch, built_at],
                |r| r.get(0),
            )
            .map_err(storage)?;
        if moved {
            return Err(Refused::Conflicts(Vec::new()));
        }
        let next = from_epoch + 1;
        tx.execute("DELETE FROM objects WHERE epoch = ?1", params![from_epoch])
            .map_err(storage)?;
        let seq = meta_i64(&tx, "head")? + 1;
        set_meta(&tx, "head", &seq.to_string())?;
        set_meta(&tx, "epoch", &next.to_string())?;
        set_meta(&tx, "mode", mode)?;
        match recipient {
            Some(r) => set_meta(&tx, "recipient", r)?,
            None => {
                tx.execute("DELETE FROM meta WHERE key = 'recipient'", [])
                    .map_err(storage)?;
            }
        }
        tx.commit().map_err(storage)?;
        drop(conn);
        for sha in old_blobs {
            self.remove_if_unreferenced(&sha);
        }
        self.head.send_replace(seq);
        Ok(next)
    }

    fn remove_if_unreferenced(&self, sha: &str) -> bool {
        let conn = self.conn();
        let referenced = conn
            .query_row(
                "SELECT EXISTS (SELECT 1 FROM objects WHERE sha = ?1)",
                params![sha],
                |r| r.get::<_, bool>(0),
            )
            .unwrap_or(true);
        !referenced && std::fs::remove_file(self.blob_path(sha)).is_ok()
    }

    pub fn keys(&self) -> Result<Keys, Refused> {
        let conn = self.conn();
        Ok(Keys {
            library_id: meta(&conn, "library_id")?.unwrap_or_default(),
            mode: meta(&conn, "mode")?,
            recipient: meta(&conn, "recipient")?,
            epoch: meta_i64(&conn, "epoch")?,
            head: meta_i64(&conn, "head")?,
        })
    }

    pub fn set_keys(&self, mode: &str, recipient: Option<&str>) -> Result<Keys, Refused> {
        if mode != PLAIN && mode != ENCRYPTED {
            return Err(Refused::BadName(mode.to_string()));
        }
        if (mode == ENCRYPTED) != recipient.is_some() {
            return Err(Refused::BadName("recipient".into()));
        }
        {
            let mut conn = self.conn();
            let tx = conn.transaction().map_err(storage)?;
            if meta(&tx, "mode")?.is_some() {
                return Err(Refused::Exists);
            }
            set_meta(&tx, "mode", mode)?;
            if let Some(r) = recipient {
                set_meta(&tx, "recipient", r)?;
            }
            tx.commit().map_err(storage)?;
        }
        self.keys()
    }

    pub fn request_join(&self, public_key: &str, device_name: &str) -> Result<String, Refused> {
        let now = now_secs();
        let conn = self.conn();
        conn.execute(
            "DELETE FROM joins WHERE created_at <= ?1",
            params![now - JOIN_TTL],
        )
        .map_err(storage)?;
        let pending: i64 = conn
            .query_row(
                "SELECT count(*) FROM joins WHERE answer IS NULL AND denied = 0",
                [],
                |r| r.get(0),
            )
            .map_err(storage)?;
        if pending >= PENDING_JOINS {
            return Err(Refused::Busy);
        }
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO joins (id, public_key, device_name, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, public_key, device_name, now],
        )
        .map_err(storage)?;
        drop(conn);
        self.joins.send_modify(|n| *n += 1);
        Ok(id)
    }

    pub fn pending_joins(&self) -> Result<Vec<Join>, Refused> {
        let conn = self.conn();
        let mut stmt = conn
            .prepare(
                "SELECT id, public_key, device_name, created_at FROM joins
                 WHERE answer IS NULL AND denied = 0 AND created_at > ?1 ORDER BY created_at",
            )
            .map_err(storage)?;
        let joins = stmt
            .query_map(params![now_secs() - JOIN_TTL], |r| {
                Ok(Join {
                    id: r.get(0)?,
                    public_key: r.get(1)?,
                    device_name: r.get(2)?,
                    created_at: r.get(3)?,
                })
            })
            .map_err(storage)?
            .collect::<Result<_, _>>()
            .map_err(storage)?;
        Ok(joins)
    }

    pub fn answer_join(&self, id: &str, key: Option<&str>) -> Result<(), Refused> {
        let changed = self
            .conn()
            .execute(
                "UPDATE joins SET answer = ?2, denied = ?3
                 WHERE id = ?1 AND answer IS NULL AND denied = 0 AND created_at > ?4",
                params![id, key, key.is_none(), now_secs() - JOIN_TTL],
            )
            .map_err(storage)?;
        if changed == 0 {
            return Err(Refused::NotFound);
        }
        self.joins.send_modify(|n| *n += 1);
        Ok(())
    }

    pub fn join(&self, id: &str) -> Result<JoinAnswer, Refused> {
        let conn = self.conn();
        let found: Option<(Option<String>, bool, i64)> = conn
            .query_row(
                "SELECT answer, denied, created_at FROM joins WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(storage)?;
        match found {
            None => Err(Refused::NotFound),
            Some((_, _, created)) if created <= now_secs() - JOIN_TTL => Err(Refused::NotFound),
            Some((Some(key), _, _)) => {
                conn.execute("DELETE FROM joins WHERE id = ?1", params![id])
                    .map_err(storage)?;
                Ok(JoinAnswer::Approved { key })
            }
            Some((None, true, _)) => Ok(JoinAnswer::Denied),
            Some((None, false, _)) => Ok(JoinAnswer::Pending),
        }
    }

    pub fn cancel_joins(&self) {
        let _ = self.conn().execute("DELETE FROM joins", []);
        self.joins.send_modify(|n| *n += 1);
    }

    pub fn sweep_unreferenced(&self, older_than: Duration) -> usize {
        let referenced: std::collections::HashSet<String> = {
            let conn = self.conn();
            let Ok(mut stmt) =
                conn.prepare("SELECT DISTINCT sha FROM objects WHERE sha IS NOT NULL")
            else {
                return 0;
            };
            stmt.query_map([], |r| r.get(0))
                .map(|rows| rows.filter_map(Result::ok).collect())
                .unwrap_or_default()
        };
        let mut removed = 0;
        let Ok(prefixes) = std::fs::read_dir(self.dir.join(BLOBS_DIR)) else {
            return 0;
        };
        let now = SystemTime::now();
        for prefix in prefixes.flatten() {
            let Ok(files) = std::fs::read_dir(prefix.path()) else {
                continue;
            };
            for file in files.flatten() {
                let name = file.file_name().to_string_lossy().into_owned();
                if !valid_name(&name) || referenced.contains(&name) {
                    continue;
                }
                let old = file
                    .metadata()
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|t| now.duration_since(t).ok())
                    .is_some_and(|age| age >= older_than);
                if old && self.remove_if_unreferenced(&name) {
                    removed += 1;
                }
            }
        }
        removed
    }
}

pub struct BlobWriter {
    file: tempfile::NamedTempFile,
    hasher: Sha256,
    size: u64,
    max: u64,
    sha: String,
    target: PathBuf,
}

impl BlobWriter {
    pub fn write(&mut self, chunk: &[u8]) -> Result<(), Refused> {
        self.size += chunk.len() as u64;
        if self.size > self.max {
            return Err(Refused::TooLarge);
        }
        self.hasher.update(chunk);
        self.file.write_all(chunk).map_err(storage)
    }

    pub fn finish(self) -> Result<(), Refused> {
        let got: String = self
            .hasher
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        if got != self.sha {
            return Err(Refused::BadHash(self.sha));
        }
        self.file.as_file().sync_all().map_err(storage)?;
        self.file.persist(&self.target).map_err(storage)?;
        Ok(())
    }
}

fn meta(conn: &Connection, key: &str) -> Result<Option<String>, Refused> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", params![key], |r| {
        r.get(0)
    })
    .optional()
    .map_err(storage)
}

fn meta_i64(conn: &Connection, key: &str) -> Result<i64, Refused> {
    Ok(meta(conn, key)?.and_then(|v| v.parse().ok()).unwrap_or(0))
}

fn set_meta(conn: &Connection, key: &str, value: &str) -> Result<(), Refused> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map(|_| ())
    .map_err(storage)
}

pub struct Stores {
    root: PathBuf,
    open: Mutex<HashMap<String, Arc<Store>>>,
}

impl Stores {
    pub fn new(data_dir: &Path) -> Stores {
        Stores {
            root: data_dir.join("sync"),
            open: Mutex::new(HashMap::new()),
        }
    }

    pub fn of(&self, sub: &str) -> Result<Arc<Store>, Refused> {
        let mut open = self.open.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(store) = open.get(sub) {
            return Ok(Arc::clone(store));
        }
        let dir = self.root.join(crate::libraries::folder_name(sub));
        let store = Arc::new(Store::open(&dir)?);
        open.insert(sub.to_string(), Arc::clone(&store));
        Ok(store)
    }

    pub fn sweep(&self) -> usize {
        let open: Vec<Arc<Store>> = self
            .open
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .cloned()
            .collect();
        open.iter().map(|s| s.sweep_unreferenced(SWEEP_AFTER)).sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sha(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    fn name(n: u8) -> String {
        sha(&[n])
    }

    fn put(store: &Store, bytes: &[u8]) -> String {
        let s = sha(bytes);
        store.put_blob(&s, [bytes.to_vec()], 1024).unwrap();
        s
    }

    fn op(name: &str, base: Option<&str>, sha: Option<&str>) -> Op {
        Op {
            name: name.into(),
            base: base.map(Into::into),
            sha: sha.map(Into::into),
        }
    }

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("p")).unwrap();
        (dir, store)
    }

    #[test]
    fn a_commit_needs_every_base_to_match_and_applies_all_or_nothing() {
        let (_dir, s) = store();
        let a = put(&s, b"a1");
        let b = put(&s, b"b1");
        assert_eq!(
            s.commit(
                1,
                &[op(&name(1), None, Some(&a)), op(&name(2), None, Some(&b))],
                "d1",
                false
            ),
            Ok(1)
        );
        let a2 = put(&s, b"a2");
        let refused = s.commit(
            1,
            &[
                op(&name(1), Some(&a), Some(&a2)),
                op(&name(2), None, Some(&a2)),
            ],
            "d2",
            false,
        );
        assert_eq!(
            refused,
            Err(Refused::Conflicts(vec![Conflict {
                name: name(2),
                current: Some(b.clone())
            }]))
        );
        let now = s.changes(0, 100).unwrap();
        assert_eq!(now.head, 1);
        assert_eq!(
            now.changes.iter().find(|c| c.name == name(1)).unwrap().sha,
            Some(a.clone())
        );
        assert_eq!(
            s.commit(
                1,
                &[
                    op(&name(1), Some(&a), Some(&a2)),
                    op(&name(2), Some(&b), None)
                ],
                "d2",
                false
            ),
            Ok(2)
        );
        let after = s.changes(1, 100).unwrap();
        assert_eq!(after.changes.len(), 2);
        assert!(after
            .changes
            .iter()
            .any(|c| c.name == name(2) && c.deleted && c.sha.is_none()));
    }

    #[test]
    fn a_commit_refuses_bad_names_unknown_blobs_and_other_epochs() {
        let (_dir, s) = store();
        let a = put(&s, b"a");
        assert!(matches!(
            s.commit(1, &[op("../escape", None, Some(&a))], "d", false),
            Err(Refused::BadName(_))
        ));
        assert!(matches!(
            s.commit(
                1,
                &[op(&name(1).to_uppercase(), None, Some(&a))],
                "d",
                false
            ),
            Err(Refused::BadName(_))
        ));
        assert!(matches!(
            s.commit(1, &[op(&name(1), None, Some(&sha(b"never")))], "d", false),
            Err(Refused::MissingBlob(_))
        ));
        assert_eq!(
            s.commit(3, &[op(&name(1), None, Some(&a))], "d", false),
            Err(Refused::WrongEpoch)
        );
        assert_eq!(s.changes(0, 10).unwrap().head, 0);
    }

    #[test]
    fn pages_end_on_whole_commits_and_a_device_far_behind_gets_everything() {
        let (_dir, s) = store();
        let blob = put(&s, b"x");
        let first: Vec<Op> = (0..3).map(|n| op(&name(n), None, Some(&blob))).collect();
        s.commit(1, &first, "d", false).unwrap();
        for n in 3..10 {
            s.commit(1, &[op(&name(n), None, Some(&blob))], "d", false)
                .unwrap();
        }
        let page = s.changes(0, 2).unwrap();
        assert_eq!(page.changes.len(), 3);
        assert!(page.changes.iter().all(|c| c.seq == 1));
        assert!(page.more);
        let mut since = 0;
        let mut seen = 0;
        loop {
            let page = s.changes(since, 2).unwrap();
            seen += page.changes.len();
            since = page.changes.last().map(|c| c.seq).unwrap_or(since);
            if !page.more {
                break;
            }
        }
        assert_eq!(seen, 10);
        assert_eq!(s.changes(99, 10), Err(Refused::Gone));
    }

    #[test]
    fn a_blob_is_kept_only_when_its_bytes_match_its_name_and_fit() {
        let (_dir, s) = store();
        let good = sha(b"note");
        assert!(matches!(
            s.put_blob(&good, [b"other".to_vec()], 1024),
            Err(Refused::BadHash(_))
        ));
        assert!(s.blob(&good).is_none());
        assert_eq!(
            s.put_blob(&sha(&[0; 2048]), [vec![0; 2048]], 1024),
            Err(Refused::TooLarge)
        );
        s.put_blob(&good, [b"no".to_vec(), b"te".to_vec()], 1024)
            .unwrap();
        assert_eq!(std::fs::read(s.blob(&good).unwrap()).unwrap(), b"note");
        assert_eq!(
            s.missing(&[good.clone(), sha(b"absent")]).unwrap(),
            vec![sha(b"absent")]
        );
        assert!(s.blob("../../etc/passwd").is_none());
    }

    #[test]
    fn the_sweep_keeps_referenced_and_recent_blobs() {
        let (_dir, s) = store();
        let kept = put(&s, b"kept");
        let loose = put(&s, b"loose");
        s.commit(1, &[op(&name(1), None, Some(&kept))], "d", false)
            .unwrap();
        assert_eq!(s.sweep_unreferenced(SWEEP_AFTER), 0);
        assert!(s.blob(&loose).is_some());
        assert_eq!(s.sweep_unreferenced(Duration::ZERO), 1);
        assert!(s.blob(&loose).is_none());
        assert!(s.blob(&kept).is_some());
    }

    #[test]
    fn a_switch_over_replaces_the_epoch_unless_the_old_one_moved() {
        let (_dir, s) = store();
        s.set_keys(PLAIN, None).unwrap();
        let plain = put(&s, b"plain note");
        let head = s
            .commit(1, &[op(&name(1), None, Some(&plain))], "d1", false)
            .unwrap();
        let sealed = put(&s, b"sealed note");
        s.commit(2, &[op(&name(9), None, Some(&sealed))], "d1", false)
            .unwrap();
        assert_eq!(s.changes(0, 10).unwrap().changes.len(), 1);
        let edit = put(&s, b"plain edit");
        s.commit(1, &[op(&name(1), Some(&plain), Some(&edit))], "d2", false)
            .unwrap();
        assert_eq!(
            s.switch(1, head, ENCRYPTED, Some("age1recipient"), 1),
            Err(Refused::Conflicts(Vec::new()))
        );
        let caught_up = s.changes(0, 10).unwrap().head;
        assert_eq!(
            s.switch(1, caught_up, ENCRYPTED, Some("age1recipient"), 1),
            Ok(2)
        );
        let now = s.changes(0, 10).unwrap();
        assert_eq!(now.epoch, 2);
        assert_eq!(
            now.changes
                .iter()
                .map(|c| c.name.clone())
                .collect::<Vec<_>>(),
            vec![name(9)]
        );
        assert!(s.blob(&edit).is_none() && s.blob(&sealed).is_some());
        assert_eq!(s.sweep_unreferenced(Duration::ZERO), 1);
        assert!(s.blob(&plain).is_none());
        let keys = s.keys().unwrap();
        assert_eq!(
            (keys.mode.as_deref(), keys.recipient.as_deref()),
            (Some(ENCRYPTED), Some("age1recipient"))
        );
        assert_eq!(s.switch(2, now.head, PLAIN, None, 0), Ok(3));
        assert_eq!(s.keys().unwrap().recipient, None);
    }

    #[test]
    fn a_new_staging_attempt_replaces_what_an_abandoned_one_left() {
        let (_dir, s) = store();
        s.set_keys(PLAIN, None).unwrap();
        let x = put(&s, b"x");
        let head = s
            .commit(
                1,
                &[op(&name(1), None, Some(&x)), op(&name(2), None, Some(&x))],
                "d",
                false,
            )
            .unwrap();
        let sealed = put(&s, b"sealed");
        s.commit(
            2,
            &[
                op(&name(8), None, Some(&sealed)),
                op(&name(9), None, Some(&sealed)),
            ],
            "d",
            true,
        )
        .unwrap();
        s.commit(
            2,
            &[
                op(&name(8), None, Some(&sealed)),
                op(&name(7), None, Some(&sealed)),
            ],
            "d",
            true,
        )
        .unwrap();
        let head = s.changes(head, 10).unwrap().head;
        assert_eq!(s.switch(1, head, ENCRYPTED, Some("age1r"), 2), Ok(2));
        let mut names: Vec<String> = s
            .changes(0, 10)
            .unwrap()
            .changes
            .into_iter()
            .map(|c| c.name)
            .collect();
        names.sort();
        let mut want = vec![name(7), name(8)];
        want.sort();
        assert_eq!(names, want);
    }

    #[test]
    fn a_switch_is_refused_when_the_staged_set_is_short() {
        let (_dir, s) = store();
        s.set_keys(PLAIN, None).unwrap();
        let x = put(&s, b"x");
        let ops: Vec<Op> = (0..5).map(|n| op(&name(n), None, Some(&x))).collect();
        let head = s.commit(1, &ops, "d", false).unwrap();
        assert_eq!(
            s.switch(1, head, ENCRYPTED, Some("age1r"), 0),
            Err(Refused::Incomplete)
        );
        s.commit(2, &[op(&name(9), None, Some(&x))], "d", true)
            .unwrap();
        assert_eq!(
            s.switch(1, head, ENCRYPTED, Some("age1r"), 1),
            Err(Refused::Incomplete)
        );
        assert_eq!(
            s.switch(1, head, ENCRYPTED, Some("age1r"), 5),
            Err(Refused::Incomplete)
        );
        assert_eq!(s.changes(0, 10).unwrap().epoch, 1);
        assert!(s.blob(&x).is_some());
    }

    #[test]
    fn a_blob_reported_present_is_safe_from_the_sweep() {
        let (_dir, s) = store();
        let old = put(&s, b"old");
        let path = s.blob(&old).unwrap();
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(SystemTime::now() - SWEEP_AFTER * 2)
            .unwrap();
        assert!(s.missing(std::slice::from_ref(&old)).unwrap().is_empty());
        assert_eq!(s.sweep_unreferenced(SWEEP_AFTER), 0);
        assert!(s.blob(&old).is_some());
    }

    #[test]
    fn the_first_device_sets_the_mode_once() {
        let (_dir, s) = store();
        assert!(s.set_keys(ENCRYPTED, None).is_err());
        assert_eq!(
            s.set_keys(ENCRYPTED, Some("age1abc"))
                .unwrap()
                .recipient
                .as_deref(),
            Some("age1abc")
        );
        assert_eq!(s.set_keys(PLAIN, None), Err(Refused::Exists));
    }

    #[test]
    fn a_join_request_is_answered_once_and_read_once() {
        let (_dir, s) = store();
        let id = s.request_join("age1temp", "Laptop").unwrap();
        assert_eq!(s.pending_joins().unwrap().len(), 1);
        assert_eq!(s.join(&id), Ok(JoinAnswer::Pending));
        s.answer_join(&id, Some("sealed-key")).unwrap();
        assert_eq!(s.answer_join(&id, None), Err(Refused::NotFound));
        assert!(s.pending_joins().unwrap().is_empty());
        assert_eq!(
            s.join(&id),
            Ok(JoinAnswer::Approved {
                key: "sealed-key".into()
            })
        );
        assert_eq!(s.join(&id), Err(Refused::NotFound));
        let denied = s.request_join("age1other", "Phone").unwrap();
        s.answer_join(&denied, None).unwrap();
        assert_eq!(s.join(&denied), Ok(JoinAnswer::Denied));
        for n in 0..PENDING_JOINS {
            s.request_join("age1x", &format!("d{n}")).unwrap();
        }
        assert_eq!(s.request_join("age1x", "one too many"), Err(Refused::Busy));
    }

    #[test]
    fn two_people_never_share_a_store_or_a_blob() {
        let dir = tempfile::tempdir().unwrap();
        let stores = Stores::new(dir.path());
        let a = stores.of("alice").unwrap();
        let b = stores.of("../alice").unwrap();
        let blob = put(&a, b"alice's note");
        a.commit(1, &[op(&name(1), None, Some(&blob))], "d", false)
            .unwrap();
        assert!(b.blob(&blob).is_none());
        assert!(b.changes(0, 10).unwrap().changes.is_empty());
        assert!(matches!(
            b.commit(1, &[op(&name(1), None, Some(&blob))], "d", false),
            Err(Refused::MissingBlob(_))
        ));
        assert!(Arc::ptr_eq(&a, &stores.of("alice").unwrap()));
    }
}
