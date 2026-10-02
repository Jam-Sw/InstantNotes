//! Agent access: InstantNotes as a Model Context Protocol server.
//!
//! Any agent or coding CLI (Claude Code, Codex, Cursor, Claude Desktop)
//! reads and writes the library by launching the app's own binary in a
//! second mode:
//!
//! ```text
//! instantnotes mcp --db <library.db> [--attachments <dir>]
//! ```
//!
//! That process opens the same SQLite file through `instantnotes-core`, so
//! every business rule (titles, inline tags, trash) is the app's own, and
//! speaks MCP on stdin/stdout. It does not need the app to be running; when
//! the app is running, it notices the writes through SQLite's `data_version`
//! (see `src-tauri/src/shell/agents.rs`).
//!
//! Layout: `protocol` is the JSON-RPC loop, `tools` is the tool surface,
//! `access` is the permission gate in front of it, `activity` is the trace
//! the app reads back, and this file is the command-line entry point. The
//! crate never touches Tauri, so it is tested without a window.
//!
//! Invariants:
//! - stdout carries protocol messages only; stderr carries nothing that
//!   includes note content (openspec/project.md: content never in logs).
//! - Every call is traced in the library's `agent_activity` table, writes
//!   with the note as it was, so the app can show and revert them.
//! - Access is off until the user turns it on in Settings > Agents, and is
//!   re-read on every call, so turning it off applies immediately.
//! - The store is opened with `Store::open`, never `open_or_recover`: an agent
//!   process must never be the one to set a library aside.

mod access;
mod activity;
mod protocol;
mod tools;

pub use access::{Access, ACCESS_KEY};
pub use protocol::serve;

use instantnotes_core::{AppError, Store};
use std::ffi::OsString;
use std::io::{stdin, stdout};
use std::path::PathBuf;

/// The subcommand that selects this mode.
pub const SUBCOMMAND: &str = "mcp";

/// Entry point for `main()`: returns `None` when the arguments do not ask
/// for the MCP server, so the app starts as usual, and the exit code when
/// they do.
pub fn run_from_args(mut args: impl Iterator<Item = OsString>) -> Option<i32> {
    if args.next().as_deref() != Some(SUBCOMMAND.as_ref()) {
        return None;
    }
    let mut db: Option<PathBuf> = None;
    let mut attachments: Option<PathBuf> = None;
    while let Some(flag) = args.next() {
        let value = args.next().map(PathBuf::from);
        match (flag.to_str(), value) {
            (Some("--db"), Some(v)) => db = Some(v),
            (Some("--attachments"), Some(v)) => attachments = Some(v),
            _ => return Some(usage()),
        }
    }
    let Some(db) = db else {
        return Some(usage());
    };
    let mut store = match Store::open(&db) {
        Ok(store) => store,
        Err(e) => {
            // The error names the file, never a note.
            eprintln!("instantnotes mcp: cannot open the library: {e}");
            return Some(1);
        }
    };
    match serve(&mut store, attachments, stdin().lock(), stdout().lock()) {
        Ok(()) => Some(0),
        Err(e) => {
            eprintln!("instantnotes mcp: {e}");
            Some(1)
        }
    }
}

fn usage() -> i32 {
    eprintln!("usage: instantnotes mcp --db <library.db> [--attachments <dir>]");
    2
}

/// A store error as the agent sees it: the stable code first, so a model
/// can branch on `CONFLICT` or `NOT_FOUND`.
fn fail(e: AppError) -> String {
    format!("{}: {e}", e.code())
}
