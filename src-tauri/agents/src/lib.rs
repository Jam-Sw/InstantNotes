mod access;
mod activity;
mod protocol;
mod tools;

pub use access::{Access, ACCESS_KEY, BLOCKED_KEY, TAGS_KEY};
pub use protocol::{new_session, serve, serve_as};

use instantnotes_core::store::activity::hold_session_lock;
use instantnotes_core::{AppError, Store};
use std::ffi::OsString;
use std::io::{stdin, stdout};
use std::path::PathBuf;

pub const SUBCOMMAND: &str = "mcp";

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
    let mut store = match Store::open_for_agent(&db) {
        Ok(store) => store,
        Err(e) => {
            eprintln!("instantnotes mcp: cannot open the library: {e}");
            return Some(1);
        }
    };
    let session = new_session();
    let _alive = hold_session_lock(&db, &session);
    match serve_as(
        &mut store,
        attachments,
        session,
        stdin().lock(),
        stdout().lock(),
    ) {
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

fn fail(e: AppError) -> String {
    match &e {
        AppError::NotFound(what) if what.starts_with("note ") => format!(
            "{}: {e}. search_notes or list_notes give note ids; a trashed note is found with status \"trash\"",
            e.code()
        ),
        _ => format!("{}: {e}", e.code()),
    }
}
