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

use crate::access::Access;
use crate::tools::{session_id, Tools, NOTE_URI_PREFIX};
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
const INTERNAL_ERROR: i64 = -32603;
const UNSUPPORTED_PROTOCOL_VERSION: i64 = -32022;
const RESOURCE_NOT_FOUND: i64 = -32002;

const INSTRUCTIONS: &str = "You are connected to InstantNotes, the user's \
personal notes app: a place to park thoughts fast and trust they come back. \
The user watches what you read and change, highlighted in the app as you go.

# Vocabulary
- Space: a named collection for one effort. A note can be in several Spaces.
- Note kinds: document (Markdown), sheet (a cell grid), whiteboard (a canvas). \
A document's title is its first line unless set.
- Document Markdown is what the editor renders: GitHub extensions, \
==highlight==, task items written \"- [ ] task\", and images written \
![](attachments/<file>). A #word in the text is a tag.

# Writing
- Write when the user asks for that change. For any other change, ask first.
- A thought, idea, or to-do the user asks you to save is a new note: call \
list_spaces, then create_note with the Space it belongs in. Add to an \
existing note only when the user names that note.
- Change the smallest part that does the job: append_to_note adds text at the \
end, edit_note replaces one passage, update_note rewrites the whole note.

# Reading
- Find notes with search_notes and two or three keywords. Its passages often \
answer the question; read with get_notes only the notes that matter.
- search_notes, list_notes, and suggest_space are paged: while hasMore is \
true and you need more, call again with offset set to nextOffset.
- Open loops are captures the user has never opened, older than three days: \
list_notes with status \"revisit\" lists them.

# Limits
- Sheets: append_sheet_rows adds rows; the user edits cells in the app.
- Whiteboards: agents read them; the user edits them in the app.
- Removing: trash_note moves a note to the Trash, where the user can restore \
it. No tool deletes a note for good.

# Scope
InstantNotes holds notes. Dates, reminders, and checklists go into a note's \
text when the user asks for them.";

/// Serve one client until stdin closes.
pub fn serve(
    store: &mut Store,
    attachments_dir: Option<PathBuf>,
    input: impl BufRead,
    output: impl Write,
) -> io::Result<()> {
    serve_as(store, attachments_dir, new_session(), input, output)
}

/// A name for this process's connection, for `serve_as`.
pub fn new_session() -> String {
    session_id()
}

/// `serve`, under a session id the caller already holds (the entry point
/// takes the session's lock before the first message is read).
pub fn serve_as(
    store: &mut Store,
    attachments_dir: Option<PathBuf>,
    session: String,
    mut input: impl BufRead,
    mut output: impl Write,
) -> io::Result<()> {
    let mut tools = Tools::new(store, attachments_dir, session);
    let mut line = Vec::new();
    loop {
        line.clear();
        if input.read_until(b'\n', &mut line)? == 0 {
            tools.disconnect();
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
///
/// A panic inside a request (a bug in one tool, a corrupt row) is caught and
/// answered as an internal error, so one bad call never takes the whole
/// connection, and the agent's conversation, down with it.
fn handle(tools: &mut Tools, message: Value) -> Option<Value> {
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        handle_unguarded(tools, message)
    })) {
        Ok(reply) => reply,
        Err(_) => match id {
            Value::String(_) | Value::Number(_) => {
                Some(error(id, INTERNAL_ERROR, "internal error"))
            }
            _ => None,
        },
    }
}

fn handle_unguarded(tools: &mut Tools, message: Value) -> Option<Value> {
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
    let reply = match request(tools, method, &params) {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(err) => json!({ "jsonrpc": "2.0", "id": id, "error": err }),
    };
    // The trace keeps the whole exchange, so the user can read exactly what
    // an agent sent and what it was told.
    if matches!(method, "tools/call" | "resources/list" | "resources/read") {
        if let (Ok(sent), Ok(answered)) =
            (serde_json::to_string(&msg), serde_json::to_string(&reply))
        {
            tools.record_wire(&sent, &answered);
        }
    }
    Some(reply)
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
        // Notes as resources, read-gated like the read tools. A client that
        // prefers resources to tool calls (Claude Desktop's picker) gets
        // the same notes the same way.
        "resources/list" => {
            tools
                .check(Access::Read)
                .map_err(|m| error_object(INVALID_PARAMS, &m))?;
            json!({ "resources": tools.resources().map_err(|m| error_object(INTERNAL_ERROR, &m))? })
        }
        "resources/templates/list" => json!({
            "resourceTemplates": [{
                "uriTemplate": format!("{NOTE_URI_PREFIX}{{id}}"),
                "name": "note",
                "title": "A note",
                "description": "One note's Markdown, by the id search_notes or list_notes return.",
                "mimeType": "text/markdown",
            }]
        }),
        "resources/read" => {
            tools
                .check(Access::Read)
                .map_err(|m| error_object(INVALID_PARAMS, &m))?;
            let uri = params
                .get("uri")
                .and_then(Value::as_str)
                .ok_or_else(|| error_object(INVALID_PARAMS, "resources/read needs a uri"))?;
            let contents = tools
                .resource(uri)
                .map_err(|m| error_object(RESOURCE_NOT_FOUND, &m))?;
            json!({ "contents": [contents] })
        }
        _ => return Err(error_object(METHOD_NOT_FOUND, "method not found")),
    };
    if modern {
        if method == "tools/list" || method == "resources/templates/list" {
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
    // Neither list changes while the process lives: no listChanged.
    json!({ "tools": {}, "resources": {} })
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
