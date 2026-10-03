//! The agent activity trace: every call an agent made through the MCP
//! server, what it touched, and, for a write, the note as it was just before,
//! so the user can put it back.
//!
//! Rows are written by the MCP process (`instantnotes-agents`) and read by
//! the app, which also writes the one row kind of its own: a revert. The
//! trace lives in its own table rather than a settings blob so appending is
//! one INSERT, history is not capped at a handful of entries, and the app's
//! watcher can tell what is new from `seq` alone.
//!
//! Revert is symmetric: it records itself as an activity row carrying a
//! snapshot of the note as it was before the revert, so a revert can be
//! reverted. A note an agent created has no "before"; reverting its creation
//! moves it to the Trash, never deletes it for good.

use super::*;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// How many rows the trace keeps. Old rows are pruned on insert.
pub const ACTIVITY_KEEP: i64 = 2000;

/// One recorded call, as the app lists it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentActivity {
    /// Monotonic row id; the app's cursor.
    pub seq: i64,
    /// Epoch milliseconds.
    pub at: i64,
    /// The MCP process that made the call; groups a conversation's calls.
    pub session: String,
    /// The client's own name from the handshake ("claude-code", "cursor"),
    /// or "instantnotes" for a revert the user made in the app.
    pub client: String,
    pub tool: String,
    /// `read`, `search`, or `write`.
    pub kind: String,
    /// `ok` or `error`.
    pub status: String,
    /// What the tool refused with, when `status` is `error`.
    pub error: Option<String>,
    pub duration_ms: i64,
    pub note_ids: Vec<String>,
    pub note_count: i64,
    /// The first few touched notes' titles.
    pub titles: Vec<String>,
    pub space: Option<String>,
    pub tag: Option<String>,
    pub query: Option<String>,
    /// The note's `updated_at` after this write, so the app can tell whether
    /// it has been edited since.
    pub after_updated_at: Option<String>,
    /// Whether a snapshot exists to revert to (or the note was created and
    /// can be trashed).
    pub revertable: bool,
    /// Set once this row has been reverted; it cannot be reverted again.
    pub reverted_at: Option<i64>,
    /// The `seq` of the row this revert undid, for a revert row.
    pub reverts: Option<i64>,
}

/// What a write is about to replace: the note as it is, with its edges, so
/// `revert` can restore exactly this. `None` for a note that does not exist
/// yet (a create).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteSnapshot {
    pub id: String,
    pub title: String,
    pub title_is_auto: bool,
    pub body: String,
    pub is_pinned: bool,
    pub is_archived: bool,
    pub is_deleted: bool,
    pub deleted_at: Option<String>,
    pub updated_at: String,
    /// (tag name, source) for every tag edge.
    pub tags: Vec<(String, String)>,
    /// Space names.
    pub spaces: Vec<String>,
}

/// The raw exchange behind a call: the JSON-RPC message the agent sent and
/// the one it got back, as JSON text. `None` where none was kept (a row from
/// before they were, or the app's own revert).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActivityWire {
    pub request: Option<String>,
    pub response: Option<String>,
}

/// One agent connection: an MCP server process, from the moment it started
/// to the moment it ended.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub session: String,
    pub client: String,
    /// Epoch milliseconds.
    pub connected_at: i64,
    /// Set when the process ended, by itself on a clean exit or by the app
    /// once it finds the process gone.
    pub disconnected_at: Option<i64>,
    /// The name the client gives this session of its own ("bob", after
    /// Claude Code's `/rename bob`), when it has one.
    pub label: Option<String>,
    /// The client's own id for the session, to trace a change back to the
    /// exact conversation that made it.
    pub client_session: Option<String>,
    /// Where the client is running.
    pub cwd: Option<String>,
    /// The client's process, while it lives.
    pub client_pid: Option<i64>,
    /// How the session was identified: `exact` (the client said) or
    /// `inferred` (matched from the client's own records).
    pub matched: Option<String>,
}

/// What a client lets its server know about the session it belongs to.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ClientSession {
    pub label: Option<String>,
    pub client_session: Option<String>,
    pub cwd: Option<String>,
    pub client_pid: Option<i64>,
    pub matched: Option<String>,
}

/// How long an ended connection's row is kept.
const SESSION_KEEP_MS: i64 = 30 * 24 * 60 * 60 * 1000;

/// The file an agent process holds locked for as long as it lives, beside
/// the library. The operating system lets go of the lock however the process
/// ends, which is what makes "connected" true after a crash too.
pub fn session_lock_path(db: &Path, session: &str) -> PathBuf {
    db.with_file_name("agent-sessions")
        .join(format!("{session}.lock"))
}

/// Take the session's lock, for the life of the returned file. `None` when
/// the file cannot be made or locked; the session then reads as ended.
pub fn hold_session_lock(db: &Path, session: &str) -> Option<std::fs::File> {
    let path = session_lock_path(db, session);
    std::fs::create_dir_all(path.parent()?).ok()?;
    let file = std::fs::File::create(&path).ok()?;
    file.try_lock().ok()?;
    Some(file)
}

/// Whether the process behind a session still holds its lock. A lock this
/// call can take belongs to no one: the process is gone, and its file is
/// cleared away.
pub fn session_alive(db: &Path, session: &str) -> bool {
    let path = session_lock_path(db, session);
    let Ok(file) = std::fs::File::open(&path) else {
        return false;
    };
    match file.try_lock() {
        Ok(()) => {
            let _ = file.unlock();
            drop(file);
            let _ = std::fs::remove_file(&path);
            false
        }
        Err(std::fs::TryLockError::WouldBlock) => true,
        // Cannot tell: say what the row says.
        Err(std::fs::TryLockError::Error(_)) => true,
    }
}

/// A call to record. Everything the server knows once the tool returned.
#[derive(Debug, Clone, Default)]
pub struct ActivityRecord {
    pub session: String,
    pub client: String,
    pub tool: String,
    pub kind: String,
    pub status: String,
    pub error: Option<String>,
    pub duration_ms: i64,
    pub note_ids: Vec<String>,
    pub note_count: i64,
    pub titles: Vec<String>,
    pub space: Option<String>,
    pub tag: Option<String>,
    pub query: Option<String>,
    pub after_updated_at: Option<String>,
    /// The note before the write, when it existed. `Some(None)` means "the
    /// note did not exist" (a create): revertable by trashing it.
    pub before: Option<Option<NoteSnapshot>>,
    pub reverts: Option<i64>,
}

const COLUMNS: &str = "seq, at, session, client, tool, kind, status, error, duration_ms, \
    note_ids, note_count, titles, space, tag, query, after_updated_at, \
    before IS NOT NULL, reverted_at, reverts";

fn row_to_activity(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentActivity> {
    let ids: String = row.get(9)?;
    let titles: String = row.get(11)?;
    Ok(AgentActivity {
        seq: row.get(0)?,
        at: row.get(1)?,
        session: row.get(2)?,
        client: row.get(3)?,
        tool: row.get(4)?,
        kind: row.get(5)?,
        status: row.get(6)?,
        error: row.get(7)?,
        duration_ms: row.get(8)?,
        note_ids: serde_json::from_str(&ids).unwrap_or_default(),
        note_count: row.get(10)?,
        titles: serde_json::from_str(&titles).unwrap_or_default(),
        space: row.get(12)?,
        tag: row.get(13)?,
        query: row.get(14)?,
        after_updated_at: row.get(15)?,
        revertable: row.get::<_, i64>(16)? != 0,
        reverted_at: row.get(17)?,
        reverts: row.get(18)?,
    })
}

/// The note with its edges, inside the caller's connection. `Ok(None)` when
/// there is no such note.
fn snapshot(conn: &Connection, id: &str) -> Result<Option<NoteSnapshot>> {
    let head = conn
        .query_row(
            "SELECT title, title_is_auto, body, is_pinned, is_archived, is_deleted, \
             deleted_at, updated_at FROM notes WHERE id = ?1",
            params![id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)? != 0,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)? != 0,
                    r.get::<_, i64>(4)? != 0,
                    r.get::<_, i64>(5)? != 0,
                    r.get::<_, Option<String>>(6)?,
                    r.get::<_, String>(7)?,
                ))
            },
        )
        .optional()?;
    let Some((
        title,
        title_is_auto,
        body,
        is_pinned,
        is_archived,
        is_deleted,
        deleted_at,
        updated_at,
    )) = head
    else {
        return Ok(None);
    };
    let mut stmt = conn.prepare(
        "SELECT t.name, nt.source FROM note_tags nt JOIN tags t ON t.id = nt.tag_id \
         WHERE nt.note_id = ?1 ORDER BY t.name",
    )?;
    let tags = stmt
        .query_map(params![id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<Vec<(String, String)>>>()?;
    let mut stmt = conn.prepare(
        "SELECT w.name FROM note_workspaces nw JOIN workspaces w ON w.id = nw.workspace_id \
         WHERE nw.note_id = ?1 ORDER BY w.name COLLATE NOCASE",
    )?;
    let spaces = stmt
        .query_map(params![id], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(Some(NoteSnapshot {
        id: id.to_string(),
        title,
        title_is_auto,
        body,
        is_pinned,
        is_archived,
        is_deleted,
        deleted_at,
        updated_at,
        tags,
        spaces,
    }))
}

/// Make the note match `snap` exactly: fields, tags with their sources, and
/// Spaces. Tags and Spaces named in the snapshot are created if they are
/// gone. Runs inside the caller's transaction.
fn restore(tx: &Connection, snap: &NoteSnapshot) -> Result<()> {
    let now = now_iso();
    let changed = tx.execute(
        "UPDATE notes SET title = ?1, title_is_auto = ?2, body = ?3, is_pinned = ?4, \
         is_archived = ?5, is_deleted = ?6, deleted_at = ?7, updated_at = ?8 WHERE id = ?9",
        params![
            snap.title,
            i64::from(snap.title_is_auto),
            snap.body,
            i64::from(snap.is_pinned),
            i64::from(snap.is_archived),
            i64::from(snap.is_deleted),
            snap.deleted_at,
            now,
            snap.id
        ],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!(
            "note {} no longer exists, so there is nothing to revert",
            snap.id
        )));
    }
    tx.execute("DELETE FROM note_tags WHERE note_id = ?1", params![snap.id])?;
    for (name, source) in &snap.tags {
        let tag = tag_get_or_create(tx, name)?;
        attach_tag(tx, &snap.id, &tag.id, source)?;
    }
    tx.execute(
        "DELETE FROM note_workspaces WHERE note_id = ?1",
        params![snap.id],
    )?;
    for name in &snap.spaces {
        let ws = workspace_get_or_create(tx, name)?;
        tx.execute(
            "INSERT OR IGNORE INTO note_workspaces (note_id, workspace_id, created_at) \
             VALUES (?1, ?2, ?3)",
            params![snap.id, ws.id, now],
        )?;
    }
    Ok(())
}

impl Store {
    /// The note as it is right now, for a write about to replace it. `None`
    /// when no such note exists.
    pub fn snapshot_note(&self, id: &str) -> Result<Option<NoteSnapshot>> {
        snapshot(&self.conn, id)
    }

    /// Append one call to the trace; returns its `seq`. Prunes the oldest
    /// rows past `ACTIVITY_KEEP`.
    pub fn record_activity(&mut self, rec: ActivityRecord) -> Result<i64> {
        let before = match &rec.before {
            None => None,
            Some(snap) => Some(
                serde_json::to_string(snap)
                    .map_err(|e| AppError::Storage(format!("cannot encode snapshot: {e}")))?,
            ),
        };
        let note_ids = serde_json::to_string(&rec.note_ids).unwrap_or_else(|_| "[]".into());
        let titles = serde_json::to_string(&rec.titles).unwrap_or_else(|_| "[]".into());
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO agent_activity (at, session, client, tool, kind, status, error, \
             duration_ms, note_ids, note_count, titles, space, tag, query, after_updated_at, \
             before, reverts) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, \
             ?14, ?15, ?16, ?17)",
            params![
                now_ms(),
                rec.session,
                rec.client,
                rec.tool,
                rec.kind,
                rec.status,
                rec.error,
                rec.duration_ms,
                note_ids,
                rec.note_count,
                titles,
                rec.space,
                rec.tag,
                rec.query,
                rec.after_updated_at,
                before,
                rec.reverts,
            ],
        )?;
        let seq = tx.last_insert_rowid();
        tx.execute(
            "DELETE FROM agent_activity WHERE seq <= ?1",
            params![seq - ACTIVITY_KEEP],
        )?;
        tx.commit()?;
        Ok(seq)
    }

    /// Rows newer than `after_seq`, oldest first: what the app's watcher
    /// announces.
    pub fn activity_since(&self, after_seq: i64, limit: i64) -> Result<Vec<AgentActivity>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {COLUMNS} FROM agent_activity WHERE seq > ?1 ORDER BY seq ASC LIMIT ?2"
        ))?;
        let rows = stmt.query_map(params![after_seq, limit.clamp(1, 5000)], row_to_activity)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// The trace, newest first.
    pub fn list_activity(&self, limit: i64, offset: i64) -> Result<Vec<AgentActivity>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {COLUMNS} FROM agent_activity ORDER BY seq DESC LIMIT ?1 OFFSET ?2"
        ))?;
        let rows = stmt.query_map(
            params![limit.clamp(1, 5000), offset.max(0)],
            row_to_activity,
        )?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Attach the raw exchange to a row already recorded: the request as it
    /// came in and the response as it went out.
    pub fn set_activity_wire(&mut self, seq: i64, request: &str, response: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE agent_activity SET request = ?1, response = ?2 WHERE seq = ?3",
            params![request, response, seq],
        )?;
        Ok(())
    }

    /// The raw exchange a row holds.
    pub fn activity_wire(&self, seq: i64) -> Result<ActivityWire> {
        self.conn
            .query_row(
                "SELECT request, response FROM agent_activity WHERE seq = ?1",
                params![seq],
                |r| {
                    Ok(ActivityWire {
                        request: r.get(0)?,
                        response: r.get(1)?,
                    })
                },
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("activity {seq} not found")))
    }

    /// The newest `seq`, or 0 for an empty trace. One indexed lookup: cheap
    /// enough to poll.
    pub fn latest_activity_seq(&self) -> Result<i64> {
        Ok(self.conn.query_row(
            "SELECT COALESCE(MAX(seq), 0) FROM agent_activity",
            [],
            |r| r.get(0),
        )?)
    }

    /// The snapshot a write row carries, for a preview of what a revert
    /// would restore.
    pub fn activity_before(&self, seq: i64) -> Result<Option<NoteSnapshot>> {
        let raw: Option<Option<String>> = self
            .conn
            .query_row(
                "SELECT before FROM agent_activity WHERE seq = ?1",
                params![seq],
                |r| r.get(0),
            )
            .optional()?;
        match raw {
            None => Err(AppError::NotFound(format!("activity {seq} not found"))),
            Some(None) => Ok(None),
            // The column holds `Option<NoteSnapshot>` as JSON: `null` is a
            // create, which has no before.
            Some(Some(json)) => serde_json::from_str::<Option<NoteSnapshot>>(&json)
                .map_err(|e| AppError::Storage(format!("corrupt snapshot: {e}"))),
        }
    }

    /// Undo a write: put the note back as the row's snapshot has it, or, for a
    /// create, move the new note to the Trash. Records the revert as its own
    /// row (client `instantnotes`, tool `revert`) with the state it replaced,
    /// so it can be reverted in turn. Returns that row's `seq`.
    pub fn revert_activity(&mut self, seq: i64) -> Result<i64> {
        let (before, reverted_at, note_ids): (Option<String>, Option<i64>, String) = self
            .conn
            .query_row(
                "SELECT before, reverted_at, note_ids FROM agent_activity WHERE seq = ?1",
                params![seq],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("activity {seq} not found")))?;
        if reverted_at.is_some() {
            return Err(AppError::Conflict(format!(
                "activity {seq} was already reverted"
            )));
        }
        let Some(before) = before else {
            return Err(AppError::Validation(
                "this call changed nothing, so there is nothing to revert".into(),
            ));
        };
        let snap: Option<NoteSnapshot> = serde_json::from_str(&before)
            .map_err(|e| AppError::Storage(format!("corrupt snapshot: {e}")))?;
        let ids: Vec<String> = serde_json::from_str(&note_ids).unwrap_or_default();
        let id = snap
            .as_ref()
            .map(|s| s.id.clone())
            .or_else(|| ids.first().cloned())
            .ok_or_else(|| AppError::Validation("the call named no note".into()))?;

        let started = std::time::Instant::now();
        let tx = self.conn.transaction()?;
        let current = snapshot(&tx, &id)?
            .ok_or_else(|| AppError::NotFound(format!("note {id} no longer exists")))?;
        match &snap {
            Some(s) => restore(&tx, s)?,
            // A created note: nothing to go back to, so it goes to the Trash.
            None => {
                let now = now_iso();
                tx.execute(
                    "UPDATE notes SET is_deleted = 1, deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
                    params![now, id],
                )?;
            }
        }
        let after: String = tx.query_row(
            "SELECT updated_at FROM notes WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )?;
        let now = now_ms();
        tx.execute(
            "UPDATE agent_activity SET reverted_at = ?1 WHERE seq = ?2",
            params![now, seq],
        )?;
        let before_json = serde_json::to_string(&Some(&current))
            .map_err(|e| AppError::Storage(format!("cannot encode snapshot: {e}")))?;
        tx.execute(
            "INSERT INTO agent_activity (at, session, client, tool, kind, status, error, \
             duration_ms, note_ids, note_count, titles, space, tag, query, after_updated_at, \
             before, reverts) VALUES (?1, 'app', 'instantnotes', 'revert', 'write', 'ok', NULL, \
             ?2, ?3, 1, ?4, NULL, NULL, NULL, ?5, ?6, ?7)",
            params![
                now,
                started.elapsed().as_millis() as i64,
                serde_json::to_string(&[&id]).unwrap_or_else(|_| "[]".into()),
                serde_json::to_string(&[&current.title]).unwrap_or_else(|_| "[]".into()),
                after,
                before_json,
                seq,
            ],
        )?;
        let new_seq = tx.last_insert_rowid();
        tx.commit()?;
        Ok(new_seq)
    }

    /// Forget the trace, and the connections that have ended. Notes are
    /// untouched.
    pub fn clear_activity(&mut self) -> Result<()> {
        self.conn.execute("DELETE FROM agent_activity", [])?;
        self.conn.execute(
            "DELETE FROM agent_sessions WHERE disconnected_at IS NOT NULL",
            [],
        )?;
        Ok(())
    }

    /// An agent process started. Also drops rows of connections long ended.
    pub fn open_agent_session(&mut self, session: &str, client: &str) -> Result<()> {
        let now = now_ms();
        self.conn.execute(
            "INSERT OR REPLACE INTO agent_sessions (session, client, connected_at, disconnected_at) \
             VALUES (?1, ?2, ?3, NULL)",
            params![session, client, now],
        )?;
        self.conn.execute(
            "DELETE FROM agent_sessions WHERE disconnected_at < ?1",
            params![now - SESSION_KEEP_MS],
        )?;
        Ok(())
    }

    /// What the client told its server about the session it belongs to. Only
    /// what is given is written: a later call with less never erases more.
    pub fn describe_agent_session(&mut self, session: &str, about: &ClientSession) -> Result<()> {
        self.conn.execute(
            "UPDATE agent_sessions SET label = COALESCE(?1, label), \
             client_session = COALESCE(?2, client_session), cwd = COALESCE(?3, cwd), \
             client_pid = COALESCE(?4, client_pid), matched = COALESCE(?5, matched) \
             WHERE session = ?6",
            params![
                about.label,
                about.client_session,
                about.cwd,
                about.client_pid,
                about.matched,
                session
            ],
        )?;
        Ok(())
    }

    /// The client said who it is.
    pub fn name_agent_session(&mut self, session: &str, client: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE agent_sessions SET client = ?1 WHERE session = ?2 AND client <> ?1",
            params![client, session],
        )?;
        Ok(())
    }

    /// The agent process ended. Keeps the first time it was said.
    pub fn close_agent_session(&mut self, session: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE agent_sessions SET disconnected_at = ?1 \
             WHERE session = ?2 AND disconnected_at IS NULL",
            params![now_ms(), session],
        )?;
        Ok(())
    }

    /// Connections, newest first.
    pub fn list_agent_sessions(&self, limit: i64) -> Result<Vec<AgentSession>> {
        let mut stmt = self.conn.prepare(
            "SELECT session, client, connected_at, disconnected_at, label, client_session, \
             cwd, client_pid, matched FROM agent_sessions \
             ORDER BY connected_at DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit.clamp(1, 5000)], |r| {
            Ok(AgentSession {
                session: r.get(0)?,
                client: r.get(1)?,
                connected_at: r.get(2)?,
                disconnected_at: r.get(3)?,
                label: r.get(4)?,
                client_session: r.get(5)?,
                cwd: r.get(6)?,
                client_pid: r.get(7)?,
                matched: r.get(8)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }
}
