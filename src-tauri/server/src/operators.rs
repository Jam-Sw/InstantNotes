use crate::client::Client;
use crate::config;
use crate::people::{People, Template, CHECK_EMAIL, CHECK_SUB};
use crate::sessions::{now_secs, Person, Sessions};
use instantnotes_core::sync::crypto::{LibraryKey, Lock};
use instantnotes_core::sync::remote::RemoteOp;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub const USAGE: &str = "usage";
pub const CHECK: &str = "check";
const CHECK_TOKEN_TTL: i64 = 5 * 60;
const CHECK_DEVICE: &str = "instantnotes check";
const CHANGES_PATIENCE: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub sub: String,
    pub username: Option<String>,
    pub email: Option<String>,
    pub folder: String,
    pub bytes: u64,
    pub blobs: u64,
    pub objects: u64,
    pub last_seen: Option<i64>,
}

fn open_server_db(data_dir: &Path) -> Result<Sessions, String> {
    let db = data_dir.join(crate::SERVER_DB);
    if !db.is_file() {
        return Err(format!(
            "no {} in {}: has the server run here?",
            crate::SERVER_DB,
            data_dir.display()
        ));
    }
    Sessions::open(&db, Duration::ZERO)
}

fn walk(dir: &Path, in_blobs: bool, bytes: &mut u64, blobs: &mut u64) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_dir() {
            let blobs_dir = in_blobs || entry.file_name() == crate::objects::BLOBS_DIR;
            walk(&entry.path(), blobs_dir, bytes, blobs);
        } else {
            *bytes += meta.len();
            if in_blobs && !entry.file_name().to_string_lossy().starts_with('.') {
                *blobs += 1;
            }
        }
    }
}

fn objects_in(folder: &Path) -> u64 {
    let index = folder.join(crate::objects::INDEX_FILE);
    if !index.is_file() {
        return 0;
    }
    rusqlite::Connection::open_with_flags(&index, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .and_then(|conn| {
            conn.query_row(
                "SELECT count(*) FROM objects WHERE sha IS NOT NULL
                   AND epoch = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'epoch')",
                [],
                |r| r.get::<_, i64>(0),
            )
        })
        .map(|n| n as u64)
        .unwrap_or(0)
}

pub fn usage(data_dir: &Path, template: Option<Template>) -> Result<Vec<Usage>, String> {
    let sessions = open_server_db(data_dir)?;
    let people = People::new(data_dir, template);
    Ok(sessions
        .known()
        .into_iter()
        .map(|known| {
            let folder = people.locate(&known.sub, &known.record);
            let (mut bytes, mut blobs) = (0, 0);
            walk(&folder, false, &mut bytes, &mut blobs);
            Usage {
                objects: objects_in(&folder),
                folder: folder.display().to_string(),
                sub: known.sub,
                username: known.record.username,
                email: known.record.email,
                bytes,
                blobs,
                last_seen: known.last_seen,
            }
        })
        .collect())
}

fn ago(at: Option<i64>, now: i64) -> String {
    let Some(at) = at else {
        return "never".into();
    };
    match (now - at).max(0) {
        s if s < 60 => "now".into(),
        s if s < 3600 => format!("{}m ago", s / 60),
        s if s < 86400 => format!("{}h ago", s / 3600),
        s => format!("{}d ago", s / 86400),
    }
}

pub fn usage_table(rows: &[Usage], now: i64) -> String {
    let mut out = String::from("sub\tusername\temail\tbytes\tblobs\tobjects\tlast seen\tfolder\n");
    for r in rows {
        out.push_str(&format!(
            "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\n",
            r.sub,
            r.username.as_deref().unwrap_or("-"),
            r.email.as_deref().unwrap_or("-"),
            r.bytes,
            r.blobs,
            r.objects,
            ago(r.last_seen, now),
            r.folder
        ));
    }
    out
}

fn sha_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

struct Steps {
    done: Vec<(&'static str, u128)>,
    at: Instant,
}

impl Steps {
    fn step<T, E: std::fmt::Display>(
        &mut self,
        name: &'static str,
        result: Result<T, E>,
    ) -> Result<T, (&'static str, String)> {
        let ms = self.at.elapsed().as_millis();
        self.at = Instant::now();
        match result {
            Ok(v) => {
                self.done.push((name, ms));
                Ok(v)
            }
            Err(e) => Err((name, e.to_string())),
        }
    }
}

async fn exercise(
    url: &str,
    token: &str,
    folder: &Path,
    steps: &mut Steps,
) -> Result<(), (&'static str, String)> {
    let client = steps.step("connect", Client::new(url))?.with_token(token);
    steps.step("info", client.info().await)?;
    let key = LibraryKey::generate();
    let recipient = key.recipient();
    steps.step(
        "keys",
        client
            .set_keys(crate::objects::ENCRYPTED, Some(&recipient))
            .await,
    )?;
    let lock = Lock::Encrypted(key);
    let marker = format!("instantnotes-check {}", uuid::Uuid::new_v4());
    let sealed = lock.seal(marker.as_bytes());
    let sha = sha_hex(&sealed);
    let name = lock.name(CHECK_SUB);
    steps.step(
        "upload",
        client.upload(&[(sha.clone(), sealed.clone())]).await,
    )?;
    let epoch = steps.step("epoch", client.keys().await)?.epoch;
    let op = RemoteOp {
        name: name.clone(),
        base: None,
        sha: Some(sha.clone()),
    };
    steps.step("commit", client.commit(epoch, &[op], false).await)?;
    let started = Instant::now();
    let seen = loop {
        let changes = client.changes(0, 0).await;
        match changes {
            Ok(c) if c.changes.iter().any(|ch| ch.sha.as_deref() == Some(&sha)) => break Ok(()),
            Ok(_) if started.elapsed() < CHANGES_PATIENCE => {
                tokio::time::sleep(Duration::from_millis(200)).await
            }
            Ok(_) => break Err("the commit never appeared in the change feed".to_string()),
            Err(e) => break Err(e.to_string()),
        }
    };
    steps.step("changes", seen)?;
    let got = steps.step(
        "download",
        client.download(std::slice::from_ref(&sha)).await,
    )?;
    let bytes = got
        .into_iter()
        .find(|(s, _)| *s == sha)
        .map(|(_, b)| b)
        .ok_or("the server did not send the blob back");
    let bytes = steps.step("received", bytes)?;
    let opened = lock
        .open(&bytes)
        .map_err(|e| e.to_string())
        .and_then(|plain| {
            (plain == marker.as_bytes())
                .then_some(())
                .ok_or_else(|| "the decrypted blob differs from what was sent".to_string())
        });
    steps.step("decrypt", opened)?;
    let stored = std::fs::read(
        folder
            .join(crate::objects::BLOBS_DIR)
            .join(&sha[..2])
            .join(&sha),
    )
    .map_err(|e| format!("not under {}: {e}", folder.display()))
    .and_then(|on_disk| {
        let plain_inside = on_disk
            .windows(marker.len())
            .any(|w| w == marker.as_bytes());
        match (on_disk == sealed, plain_inside) {
            (true, false) => Ok(()),
            (_, true) => Err("the stored file holds the plaintext".to_string()),
            (false, false) => Err("the stored file is not the ciphertext sent".to_string()),
        }
    });
    steps.step("stored", stored)?;
    Ok(())
}

fn forget(sessions: &Sessions, folder: Option<&PathBuf>) -> Result<(), String> {
    sessions.forget_person(CHECK_SUB);
    let Some(folder) = folder else {
        return Ok(());
    };
    if folder.exists() {
        std::fs::remove_dir_all(folder)
            .map_err(|e| format!("cannot remove {}: {e}", folder.display()))?;
    }
    for parent in folder.ancestors().skip(1) {
        let own = parent
            .file_name()
            .is_some_and(|n| n.to_string_lossy().contains(CHECK_SUB));
        if !own || std::fs::remove_dir(parent).is_err() {
            break;
        }
    }
    Ok(())
}

pub type Checked = Result<Vec<(&'static str, u128)>, (&'static str, String)>;

pub async fn check(data_dir: &Path, template: Option<Template>, url: &str) -> Checked {
    let mut steps = Steps {
        done: Vec::new(),
        at: Instant::now(),
    };
    let sessions = steps.step("server.db", open_server_db(data_dir))?;
    let people = People::new(data_dir, template);
    let person = Person {
        sub: CHECK_SUB.into(),
        name: Some(CHECK_DEVICE.into()),
        email: Some(CHECK_EMAIL.into()),
    };
    let folder = people
        .admit(&sessions, &person, Some(CHECK_SUB))
        .and_then(|()| people.folder(&sessions, CHECK_SUB))
        .map_err(|e| e.to_string());
    let folder = steps.step("people dir", folder)?;
    steps.step("prepare", forget(&sessions, Some(&folder)))?;
    sessions.record_person(CHECK_SUB, Some(CHECK_SUB), Some(CHECK_EMAIL), now_secs());
    let token = sessions.create_expiring_device(&person, CHECK_DEVICE, now_secs(), CHECK_TOKEN_TTL);
    steps.step("token", Ok::<_, String>(()))?;
    let exercised = exercise(url, &token, &folder, &mut steps).await;
    let cleaned = forget(&sessions, Some(&folder));
    exercised?;
    steps.step("cleanup", cleaned)?;
    Ok(steps.done)
}

fn report(checked: &Checked) -> (i32, String) {
    match checked {
        Ok(done) => {
            let total: u128 = done.iter().map(|(_, ms)| ms).sum();
            let timings: Vec<String> = done
                .iter()
                .map(|(name, ms)| format!("{name}={ms}ms"))
                .collect();
            (0, format!("ok {total}ms {}", timings.join(" ")))
        }
        Err((step, why)) => (1, format!("failed at {step}: {why}")),
    }
}

pub fn run(command: &str, args: impl Iterator<Item = OsString>) -> i32 {
    let args: Vec<String> = args.map(|a| a.to_string_lossy().into_owned()).collect();
    let settings = config::data_dir().and_then(|d| config::people_dir().map(|t| (d, t)));
    let (data_dir, template) = match settings {
        Ok(s) => s,
        Err(e) => {
            eprintln!("instantnotes {command}: {e}");
            return 2;
        }
    };
    match (command, args.as_slice()) {
        (USAGE, []) | (USAGE, [_]) if args.first().is_none_or(|a| a == "--json") => {
            match usage(&data_dir, template) {
                Ok(rows) if args.is_empty() => {
                    print!("{}", usage_table(&rows, now_secs()));
                    0
                }
                Ok(rows) => {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&rows).unwrap_or_default()
                    );
                    0
                }
                Err(e) => {
                    eprintln!("instantnotes usage: {e}");
                    1
                }
            }
        }
        (CHECK, []) | (CHECK, [_, _]) if args.first().is_none_or(|a| a == "--url") => {
            let url = match args.get(1) {
                Some(url) => url.trim_end_matches('/').to_string(),
                None => match std::env::var(config::PUBLIC_URL) {
                    Ok(url) if !url.trim().is_empty() => url.trim().trim_end_matches('/').into(),
                    _ => {
                        eprintln!(
                            "instantnotes check: {} is not set; pass --url",
                            config::PUBLIC_URL
                        );
                        return 2;
                    }
                },
            };
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    eprintln!("instantnotes check: cannot start runtime: {e}");
                    return 1;
                }
            };
            let (code, line) = report(&runtime.block_on(check(&data_dir, template, &url)));
            println!("{line}");
            code
        }
        _ => {
            eprintln!("usage: instantnotes usage [--json] | instantnotes check [--url <address>]");
            2
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn last_seen_reads_as_an_age() {
        assert_eq!(ago(None, 100), "never");
        assert_eq!(ago(Some(90), 100), "now");
        assert_eq!(ago(Some(0), 7200), "2h ago");
        assert_eq!(ago(Some(0), 3 * 86400), "3d ago");
    }

    #[test]
    fn a_failed_step_is_named_and_exits_one() {
        assert_eq!(
            report(&Err(("upload", "refused".into()))),
            (1, "failed at upload: refused".into())
        );
        let (code, line) = report(&Ok(vec![("info", 3), ("keys", 4)]));
        assert_eq!(code, 0);
        assert_eq!(line, "ok 7ms info=3ms keys=4ms");
    }
}
