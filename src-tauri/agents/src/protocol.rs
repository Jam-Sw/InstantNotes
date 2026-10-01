//! The MCP stdio transport: newline-delimited JSON-RPC 2.0, served in both
//! eras of the specification (a "dual-era" server, 2026-07-28 versioning.md):
//!
//! - Modern (2026-07-28): stateless. Every request names its protocol version
//!   in `params._meta`, `server/discover` describes the server, and every
//!   result carries `resultType`.
//! - Legacy (2025-11-25 back to 2024-11-05): an `initialize` handshake picks
//!   the version for the rest of the process. 2025-03-26 also lets a client
//!   send a batch (a JSON array of messages) on one line.
//!
//! A request is modern exactly when its `_meta` names a modern version. The
//! methods are few and stable, so this is written against `serde_json`
//! directly rather than pulling in an async SDK and its runtime.

use crate::tools::Tools;
use instantnotes_core::Store;
use serde_json::{json, Map, Value};
use std::io::{self, BufRead, Write};
use std::path::PathBuf;

/// Stateless revisions: the version travels on every request.
const MODERN_VERSIONS: &[&str] = &["2026-07-28"];
/// Handshake revisions, newest first. `initialize` asking for one of them
/// gets it back; any other gets the newest.
const LEGACY_VERSIONS: &[&str] = &["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const VERSION_META: &str = "io.modelcontextprotocol/protocolVersion";
const CLIENT_META: &str = "io.modelcontextprotocol/clientInfo";
const SERVER_META: &str = "io.modelcontextprotocol/serverInfo";

/// How long a client may keep `tools/list` and `server/discover`: both are
/// fixed for the life of this binary.
const CACHE_TTL_MS: u64 = 60 * 60 * 1000;

// JSON-RPC error codes, and the one MCP adds.
const PARSE_ERROR: i64 = -32700;
const INVALID_REQUEST: i64 = -32600;
const METHOD_NOT_FOUND: i64 = -32601;
const INVALID_PARAMS: i64 = -32602;
const UNSUPPORTED_PROTOCOL_VERSION: i64 = -32022;

const INSTRUCTIONS: &str = "You are connected to InstantNotes, the user's \
personal notes app: a place to park thoughts fast and trust they come back. \
The user sees what you read and change as you do it, highlighted in the app.

Library: notes, tags, and Spaces. A Space is a named collection for one \
effort; a note can be in several. A note's title is its first line unless set.

Formatting, as the editor renders it: Markdown with GitHub extensions. \
# headings, **bold**, *italic*, ~~strike~~, ==highlight==, `code`, fenced code \
blocks, > quotes, - lists (indent to nest), - [ ] tasks, [links](url), and \
images as ![](attachments/<file>). A #word in the text is a tag.

Working with notes: search or list before creating, so you add to an existing \
note instead of duplicating it. search_notes matches titles, so search a \
note's title to find it; its results already carry the id, spaces, and \
updatedAt. Prefer append_to_note to add to a note. To rewrite one, pass the \
updatedAt from search_notes, list_notes, or get_note to update_note; you do \
not need to read the note first unless you need its current text. A CONFLICT \
means the user changed it since; it includes the current note, so retry from \
that. Nothing you do \
deletes for good: trash_note is undoable by the user.

Open loops: list_notes with status \"revisit\" gives captures the user has \
not come back to, oldest first. That is the list to help close, in a Space or \
across the library. InstantNotes is not a task manager: do not add dates, \
reminders, or checklists the user did not ask for.";

/// Serve one client until stdin closes.
pub fn serve(
    store: &mut Store,
    attachments_dir: Option<PathBuf>,
    mut input: impl BufRead,
    mut output: impl Write,
) -> io::Result<()> {
    let mut tools = Tools::new(store, attachments_dir);
    let mut line = Vec::new();
    loop {
        line.clear();
        if input.read_until(b'\n', &mut line)? == 0 {
            return Ok(());
        }
        // A line that is not UTF-8 is one bad message, not a dead server.
        let reply = match std::str::from_utf8(&line) {
            Ok(text) if text.trim().is_empty() => continue,
            Ok(text) => handle_line(&mut tools, text),
            Err(_) => Some(error(Value::Null, PARSE_ERROR, "parse error")),
        };
        if let Some(reply) = reply {
            serde_json::to_writer(&mut output, &reply)?;
            output.write_all(b"\n")?;
            output.flush()?;
        }
    }
}

/// One line: a message or a batch of them, to at most one line back.
fn handle_line(tools: &mut Tools, line: &str) -> Option<Value> {
    match serde_json::from_str(line) {
        Err(_) => Some(error(Value::Null, PARSE_ERROR, "parse error")),
        Ok(Value::Array(batch)) if batch.is_empty() => {
            Some(error(Value::Null, INVALID_REQUEST, "empty batch"))
        }
        Ok(Value::Array(batch)) => {
            let replies: Vec<Value> = batch.into_iter().filter_map(|m| handle(tools, m)).collect();
            (!replies.is_empty()).then_some(Value::Array(replies))
        }
        Ok(message) => handle(tools, message),
    }
}

/// One message to at most one reply. Notifications, and responses (this
/// server sends no requests, so any response answers nothing), get none.
fn handle(tools: &mut Tools, message: Value) -> Option<Value> {
    let Value::Object(msg) = message else {
        return Some(error(Value::Null, INVALID_REQUEST, "invalid request"));
    };
    let method = msg.get("method").and_then(Value::as_str);
    if method.is_none() && (msg.contains_key("result") || msg.contains_key("error")) {
        return None;
    }
    let id = match msg.get("id") {
        None => None,
        Some(id @ (Value::String(_) | Value::Number(_))) => Some(id.clone()),
        // MCP request ids are strings or integers, never null.
        Some(_) => return Some(error(Value::Null, INVALID_REQUEST, "invalid request id")),
    };
    let well_formed = msg.get("jsonrpc").and_then(Value::as_str) == Some("2.0");
    let (Some(method), true) = (method, well_formed) else {
        return id.map(|id| error(id, INVALID_REQUEST, "invalid request"));
    };
    let id = id?;
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    Some(match request(tools, method, &params) {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(err) => json!({ "jsonrpc": "2.0", "id": id, "error": err }),
    })
}

/// A request's result, or its JSON-RPC error object.
fn request(tools: &mut Tools, method: &str, params: &Value) -> Result<Value, Value> {
    let modern = match params.get("_meta").and_then(|m| m.get(VERSION_META)) {
        None => false,
        Some(Value::String(v)) if MODERN_VERSIONS.contains(&v.as_str()) => true,
        // A legacy client that names its version anyway.
        Some(Value::String(v)) if LEGACY_VERSIONS.contains(&v.as_str()) => false,
        Some(requested) => {
            return Err(json!({
                "code": UNSUPPORTED_PROTOCOL_VERSION,
                "message": "Unsupported protocol version",
                "data": { "supported": supported_versions(), "requested": requested },
            }))
        }
    };
    if modern {
        let client = params.pointer(&format!("/_meta/{}/name", CLIENT_META.replace('/', "~1")));
        if let Some(name) = client.and_then(Value::as_str) {
            tools.set_client(name);
        }
    }
    let mut result = match method {
        // The probe a dual-era client sends first, so it answers in any era.
        "server/discover" => {
            return Ok(complete(json!({
                "supportedVersions": supported_versions(),
                "capabilities": capabilities(),
                "instructions": INSTRUCTIONS,
                "ttlMs": CACHE_TTL_MS,
                "cacheScope": "private",
            })))
        }
        "initialize" => {
            let client = params.pointer("/clientInfo/name").and_then(Value::as_str);
            tools.set_client(client.unwrap_or_default());
            initialize(params)
        }
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools.list() }),
        "tools/call" => call(tools, params)?,
        _ => return Err(error_object(METHOD_NOT_FOUND, "method not found")),
    };
    if modern {
        if method == "tools/list" {
            result["ttlMs"] = json!(CACHE_TTL_MS);
            result["cacheScope"] = json!("private");
        }
        result = complete(result);
    }
    Ok(result)
}

/// `tools/call`. A request that fails the call's own schema, or names a tool
/// that does not exist, is a protocol error; anything the tool itself
/// refuses is a result with `isError`, which the model sees and can fix.
fn call(tools: &mut Tools, params: &Value) -> Result<Value, Value> {
    let Some(name) = params.get("name").and_then(Value::as_str) else {
        return Err(error_object(INVALID_PARAMS, "tools/call needs a name"));
    };
    if !tools.knows(name) {
        return Err(error_object(
            INVALID_PARAMS,
            &format!("Unknown tool: {name}"),
        ));
    }
    let args = match params.get("arguments") {
        None | Some(Value::Null) => json!({}),
        Some(args @ Value::Object(_)) => args.clone(),
        Some(_) => return Err(error_object(INVALID_PARAMS, "arguments must be an object")),
    };
    Ok(tools.call(name, args))
}

fn initialize(params: &Value) -> Value {
    let requested = params.get("protocolVersion").and_then(Value::as_str);
    let version = requested
        .filter(|v| LEGACY_VERSIONS.contains(v))
        .unwrap_or(LEGACY_VERSIONS[0]);
    json!({
        "protocolVersion": version,
        "capabilities": capabilities(),
        "serverInfo": server_info(),
        "instructions": INSTRUCTIONS,
    })
}

/// A modern result: `resultType`, and who answered.
fn complete(mut result: Value) -> Value {
    let Value::Object(fields) = &mut result else {
        return result;
    };
    fields.insert("resultType".into(), json!("complete"));
    let meta = fields
        .entry("_meta")
        .or_insert_with(|| Value::Object(Map::new()));
    meta[SERVER_META] = server_info();
    result
}

fn supported_versions() -> Vec<&'static str> {
    MODERN_VERSIONS
        .iter()
        .chain(LEGACY_VERSIONS)
        .copied()
        .collect()
}

fn capabilities() -> Value {
    json!({ "tools": {} })
}

fn server_info() -> Value {
    json!({ "name": "instantnotes", "title": "InstantNotes", "version": env!("CARGO_PKG_VERSION") })
}

fn error_object(code: i64, message: &str) -> Value {
    json!({ "code": code, "message": message })
}

fn error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": error_object(code, message) })
}
