//! Which session of which client an agent connection belongs to.
//!
//! An MCP server is started by its client as a child process, and none of
//! Claude Code, Codex or Hermes names its session in the handshake, so each
//! has an adapter here behind one question, "which session is this?":
//!
//! - Claude Code puts its session id and project folder in the server's
//!   environment and keeps `~/.claude/sessions/<pid>.json` for each running
//!   instance, with the session's name (what `/rename` sets). Exact.
//! - Codex gives a server nothing. Its sessions are on disk: a rollout file
//!   per thread under `~/.codex/sessions`, whose first line says where it
//!   runs and when it began, and `session_index.jsonl` with thread names.
//!   The thread is the one this Codex process began. Inferred.
//! - Hermes gives a server nothing, and calls itself `mcp`. Its sessions are
//!   rows in `~/.hermes/state.db`, with a title. The session is the one this
//!   Hermes process began. Inferred.
//!
//! A client, or a wrapper around one, that wants to say outright can set
//! `INSTANTNOTES_SESSION_ID` and `INSTANTNOTES_SESSION_NAME` in the server's
//! environment; that wins over every adapter.
//!
//! These files belong to the clients, not to us. Every read is best effort:
//! a missing file or an unfamiliar shape is "unknown", never an error, and
//! nothing here ever writes to them.

use crate::store::activity::ClientSession;
#[cfg(unix)]
use crate::store::now_ms;
use std::path::{Path, PathBuf};

/// How a session was identified: told outright, or matched from the outside.
pub const EXACT: &str = "exact";
pub const INFERRED: &str = "inferred";

/// How far before a client process's own start one of its sessions may
/// claim to have begun: clocks and the order of startup work are not exact.
const START_SLACK_MS: i64 = 5_000;
const NAME_CHARS: usize = 80;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Client {
    ClaudeCode,
    Codex,
    Hermes,
}

impl Client {
    /// The name the trace files this client's calls under.
    pub fn as_str(self) -> &'static str {
        match self {
            Client::ClaudeCode => "claude-code",
            Client::Codex => "codex",
            Client::Hermes => "hermes",
        }
    }

    /// From the name a client gives in the handshake (or the one stored).
    pub fn from_name(name: &str) -> Option<Client> {
        let name = name.to_ascii_lowercase();
        if name.starts_with("claude-code") {
            Some(Client::ClaudeCode)
        } else if name.starts_with("codex") {
            Some(Client::Codex)
        } else if name.starts_with("hermes") {
            Some(Client::Hermes)
        } else {
            None
        }
    }

    /// From the command line of the process that started the server, for a
    /// client whose handshake name says nothing (Hermes sends `mcp`).
    pub fn from_command(command: &str) -> Option<Client> {
        let command = command.to_ascii_lowercase();
        let program = command.split_whitespace().next().unwrap_or_default();
        let base = program.rsplit(['/', '\\']).next().unwrap_or_default();
        if base == "claude" || base.starts_with("claude-code") {
            Some(Client::ClaudeCode)
        } else if base == "codex" || base.starts_with("codex-") {
            Some(Client::Codex)
        } else if base == "hermes" || command.contains("/.hermes/") || command.contains("hermes") {
            Some(Client::Hermes)
        } else {
            None
        }
    }
}

/// The process that started this server: the client.
#[derive(Debug, Clone, PartialEq)]
pub struct ClientProcess {
    pub pid: i64,
    pub command: String,
    pub cwd: Option<String>,
    /// Epoch milliseconds.
    pub started_at: Option<i64>,
}

/// This process's parent, as the operating system describes it. Unix only;
/// elsewhere there is no cheap, dependency-free way to ask.
pub fn parent_process() -> Option<ClientProcess> {
    #[cfg(unix)]
    {
        describe_process(i64::from(std::os::unix::process::parent_id()))
    }
    #[cfg(not(unix))]
    {
        None
    }
}

#[cfg(unix)]
fn describe_process(pid: i64) -> Option<ClientProcess> {
    use std::process::Command;
    let run = |program: &str, args: &[&str]| {
        let out = Command::new(program).args(args).output().ok()?;
        out.status
            .success()
            .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
    };
    let pid_arg = pid.to_string();
    let command = run("ps", &["-o", "command=", "-p", &pid_arg]).filter(|c| !c.is_empty())?;
    let started_at = run("ps", &["-o", "etime=", "-p", &pid_arg])
        .and_then(|e| elapsed_ms(&e))
        .map(|elapsed| now_ms() - elapsed);
    // Linux says where a process runs in /proc; macOS needs lsof.
    let cwd = std::fs::read_link(format!("/proc/{pid}/cwd"))
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
        .or_else(|| {
            run("lsof", &["-a", "-d", "cwd", "-p", &pid_arg, "-Fn"])?
                .lines()
                .find_map(|l| l.strip_prefix('n').map(str::to_string))
        });
    Some(ClientProcess {
        pid,
        command,
        cwd,
        started_at,
    })
}

/// `ps -o etime`: `[[dd-]hh:]mm:ss`, as milliseconds.
pub fn elapsed_ms(etime: &str) -> Option<i64> {
    let etime = etime.trim();
    let (days, clock) = match etime.split_once('-') {
        Some((d, rest)) => (d.parse::<i64>().ok()?, rest),
        None => (0, etime),
    };
    let mut seconds = 0i64;
    for part in clock.split(':') {
        seconds = seconds * 60 + part.parse::<i64>().ok()?;
    }
    Some((days * 86_400 + seconds) * 1000)
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn clean(name: &str) -> Option<String> {
    let name = name.trim();
    (!name.is_empty()).then(|| name.chars().take(NAME_CHARS).collect())
}

/// What a session is called and which one it is.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Found {
    pub label: Option<String>,
    pub id: Option<String>,
}

/// Which session this connection belongs to, asked once when the server
/// starts. `env` reads the server's own environment.
pub fn identify(
    client: Option<Client>,
    process: Option<&ClientProcess>,
    env: &dyn Fn(&str) -> Option<String>,
) -> ClientSession {
    identify_in(home().as_deref(), client, process, env)
}

/// `identify`, with the clients' files looked for under a given home.
pub fn identify_in(
    home: Option<&Path>,
    client: Option<Client>,
    process: Option<&ClientProcess>,
    env: &dyn Fn(&str) -> Option<String>,
) -> ClientSession {
    let mut about = ClientSession {
        cwd: process.and_then(|p| p.cwd.clone()),
        client_pid: process.map(|p| p.pid),
        ..Default::default()
    };
    let said_id = env("INSTANTNOTES_SESSION_ID");
    let said_name = env("INSTANTNOTES_SESSION_NAME").and_then(|n| clean(&n));
    if said_id.is_some() || said_name.is_some() {
        about.client_session = said_id;
        about.label = said_name;
        about.matched = Some(EXACT.into());
        return about;
    }
    match client {
        Some(Client::ClaudeCode) => {
            about.client_session = env("CLAUDE_CODE_SESSION_ID");
            about.cwd = env("CLAUDE_PROJECT_DIR").or(about.cwd);
            let file = home.zip(process).and_then(|(h, p)| claude_code(h, p.pid));
            if let Some(found) = file {
                about.label = found.label;
                // The file follows a resumed session; the environment does not.
                about.client_session = found.id.or(about.client_session);
            }
            if about.client_session.is_some() {
                about.matched = Some(EXACT.into());
            }
        }
        Some(Client::Codex) => {
            if let Some(found) = home.zip(process).and_then(|(h, p)| codex_thread(h, p)) {
                about.label = found.label;
                about.client_session = found.id;
                about.matched = Some(INFERRED.into());
            }
        }
        Some(Client::Hermes) => {
            if let Some(found) = home.zip(process).and_then(|(h, p)| hermes_session(h, p)) {
                about.label = found.label;
                about.client_session = found.id;
                about.matched = Some(INFERRED.into());
            }
        }
        None => {}
    }
    about
}

/// The session's name as it is now: a client may rename its session at any
/// time. `None` when there is nothing newer to say.
pub fn current(client: Client, pid: Option<i64>, session: Option<&str>) -> Option<Found> {
    current_in(&home()?, client, pid, session)
}

/// `current`, under a given home.
pub fn current_in(
    home: &Path,
    client: Client,
    pid: Option<i64>,
    session: Option<&str>,
) -> Option<Found> {
    match client {
        Client::ClaudeCode => claude_code(home, pid?),
        Client::Codex => {
            let id = session?;
            Some(Found {
                label: codex_thread_name(home, id),
                id: Some(id.to_string()),
            })
        }
        Client::Hermes => {
            let id = session?;
            Some(Found {
                label: hermes_title(home, id),
                id: Some(id.to_string()),
            })
        }
    }
}

fn claude_code(home: &Path, pid: i64) -> Option<Found> {
    let path = home
        .join(".claude")
        .join("sessions")
        .join(format!("{pid}.json"));
    let file: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    let text = |key: &str| file.get(key).and_then(serde_json::Value::as_str);
    Some(Found {
        label: text("name").and_then(clean),
        id: text("sessionId").and_then(clean),
    })
}

/// The Codex thread this Codex process began: the newest rollout that runs
/// in the same folder and began no earlier than the process did.
fn codex_thread(home: &Path, process: &ClientProcess) -> Option<Found> {
    let since = process.started_at? - START_SLACK_MS;
    let cwd = process.cwd.as_deref()?;
    let mut best: Option<(i64, String)> = None;
    for file in recent_rollouts(&home.join(".codex").join("sessions")) {
        let Some((id, began, ran_in)) = rollout_head(&file) else {
            continue;
        };
        if ran_in == cwd && began >= since && best.as_ref().is_none_or(|(b, _)| began > *b) {
            best = Some((began, id));
        }
    }
    let (_, id) = best?;
    Some(Found {
        label: codex_thread_name(home, &id),
        id: Some(id),
    })
}

/// Rollout files of the two most recent days Codex has any for.
fn recent_rollouts(sessions: &Path) -> Vec<PathBuf> {
    let newest = |dir: &Path, take: usize| -> Vec<PathBuf> {
        let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .collect();
        entries.sort();
        entries.into_iter().rev().take(take).collect()
    };
    let mut days = Vec::new();
    for year in newest(sessions, 2) {
        for month in newest(&year, 2) {
            days.extend(newest(&month, 2));
        }
    }
    days.sort();
    days.into_iter()
        .rev()
        .take(2)
        .flat_map(|day| newest(&day, usize::MAX))
        .filter(|p| p.extension().is_some_and(|e| e == "jsonl"))
        .collect()
}

/// A rollout's first line: (thread id, when it began in epoch ms, where).
fn rollout_head(file: &Path) -> Option<(String, i64, String)> {
    use std::io::BufRead;
    let mut line = String::new();
    std::io::BufReader::new(std::fs::File::open(file).ok()?)
        .read_line(&mut line)
        .ok()?;
    let head: serde_json::Value = serde_json::from_str(&line).ok()?;
    let payload = head.get("payload")?;
    let text = |key: &str| payload.get(key).and_then(serde_json::Value::as_str);
    let began = chrono::DateTime::parse_from_rfc3339(text("timestamp")?)
        .ok()?
        .timestamp_millis();
    Some((text("id")?.to_string(), began, text("cwd")?.to_string()))
}

/// A thread's name, from Codex's index: the last line that names it wins.
fn codex_thread_name(home: &Path, id: &str) -> Option<String> {
    let index = std::fs::read_to_string(home.join(".codex").join("session_index.jsonl")).ok()?;
    index
        .lines()
        .rev()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .find(|row| row.get("id").and_then(serde_json::Value::as_str) == Some(id))
        .and_then(|row| row.get("thread_name")?.as_str().and_then(clean))
}

fn hermes_db(home: &Path) -> Option<rusqlite::Connection> {
    let path = home.join(".hermes").join("state.db");
    path.exists().then_some(())?;
    rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok()
}

/// The Hermes session this Hermes process began: the newest one still open
/// that began no earlier than the process did, in the same folder when the
/// session says where it runs.
fn hermes_session(home: &Path, process: &ClientProcess) -> Option<Found> {
    let since = (process.started_at? - START_SLACK_MS) as f64 / 1000.0;
    let conn = hermes_db(home)?;
    let (id, title): (String, Option<String>) = conn
        .query_row(
            "SELECT id, title FROM sessions WHERE ended_at IS NULL AND started_at >= ?1 \
             AND (cwd IS NULL OR ?2 IS NULL OR cwd = ?2) ORDER BY started_at DESC LIMIT 1",
            rusqlite::params![since, process.cwd],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok()?;
    Some(Found {
        label: title.as_deref().and_then(clean),
        id: Some(id),
    })
}

fn hermes_title(home: &Path, id: &str) -> Option<String> {
    hermes_db(home)?
        .query_row(
            "SELECT title FROM sessions WHERE id = ?1",
            rusqlite::params![id],
            |r| r.get::<_, Option<String>>(0),
        )
        .ok()?
        .as_deref()
        .and_then(clean)
}
