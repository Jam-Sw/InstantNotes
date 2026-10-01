//! The MCP server driven the way a client drives it: JSON-RPC lines in,
//! JSON-RPC lines out, against a real store.

use instantnotes_agents::{serve, ACCESS_KEY, ACTIVITY_KEY};
use instantnotes_core::types::CreateNoteInput;
use instantnotes_core::Store;
use serde_json::{json, Value};
use std::io::Cursor;

/// Send one session's worth of messages; return every reply.
fn session(store: &mut Store, messages: &[Value]) -> Vec<Value> {
    let input: String = messages.iter().map(|m| format!("{m}\n")).collect();
    raw_session(store, input.as_bytes())
}

/// The same over raw bytes, for input that is not valid JSON or UTF-8.
fn raw_session(store: &mut Store, input: &[u8]) -> Vec<Value> {
    let mut output = Vec::new();
    serve(store, None, Cursor::new(input.to_vec()), &mut output).unwrap();
    String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

/// A modern (2026-07-28) request: no handshake, the version on the request.
fn modern(id: i64, method: &str, mut params: Value) -> Value {
    params["_meta"] = json!({
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { "name": "codex", "version": "1" },
        "io.modelcontextprotocol/clientCapabilities": {}
    });
    json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
}

fn init() -> Value {
    json!({ "jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": { "name": "claude-code", "version": "1" }
    }})
}

fn call(id: i64, name: &str, arguments: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "method": "tools/call",
            "params": { "name": name, "arguments": arguments } })
}

/// A tool call's result: (is_error, text, parsed JSON when it is JSON).
fn result_of(reply: &Value) -> (bool, String, Value) {
    let result = &reply["result"];
    let text = result["content"][0]["text"].as_str().unwrap().to_string();
    let parsed = serde_json::from_str(&text).unwrap_or(Value::Null);
    (result["isError"].as_bool().unwrap(), text, parsed)
}

fn store_with(access: &str) -> Store {
    let mut store = Store::open_in_memory().unwrap();
    store.set_setting(ACCESS_KEY, json!(access)).unwrap();
    store
}

#[test]
fn initialize_negotiates_and_notifications_get_no_reply() {
    let mut store = store_with("off");
    let replies = session(
        &mut store,
        &[
            init(),
            json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
            json!({ "jsonrpc": "2.0", "id": 1, "method": "ping" }),
        ],
    );
    assert_eq!(replies.len(), 2, "the notification must not be answered");
    assert_eq!(replies[0]["result"]["protocolVersion"], "2025-06-18");
    assert_eq!(replies[0]["result"]["serverInfo"]["name"], "instantnotes");
    assert!(replies[0]["result"]["capabilities"]["tools"].is_object());
    assert_eq!(replies[1]["result"], json!({}));
}

#[test]
fn unknown_version_gets_the_newest_and_unknown_method_an_error() {
    let mut store = store_with("off");
    let replies = session(
        &mut store,
        &[
            json!({ "jsonrpc": "2.0", "id": 0, "method": "initialize",
                    "params": { "protocolVersion": "1999-01-01" } }),
            json!({ "jsonrpc": "2.0", "id": 1, "method": "resources/list" }),
            json!("not an object"),
        ],
    );
    assert_eq!(replies[0]["result"]["protocolVersion"], "2025-11-25");
    assert_eq!(replies[1]["error"]["code"], -32601);
    assert_eq!(replies[2]["error"]["code"], -32600);
}

#[test]
fn tools_list_describes_every_tool_with_a_schema() {
    let mut store = store_with("off");
    let replies = session(
        &mut store,
        &[
            init(),
            json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }),
        ],
    );
    let tools = replies[1]["result"]["tools"].as_array().unwrap();
    let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    for expected in [
        "search_notes",
        "get_note",
        "create_note",
        "update_note",
        "append_to_note",
    ] {
        assert!(names.contains(&expected), "missing {expected}");
    }
    assert!(
        !names.iter().any(|n| n.contains("delete")),
        "no permanent delete, ever"
    );
    for tool in tools {
        let name = tool["name"].as_str().unwrap();
        let schema = &tool["inputSchema"];
        assert_eq!(schema["type"], "object", "{name}");
        // The server rejects unknown arguments, so the schema must say so.
        assert_eq!(schema["additionalProperties"], false, "{name}");
        assert_ne!(schema["required"], json!([]), "{name}: omit, not empty");
        assert!(
            tool["title"].as_str().is_some_and(|t| !t.is_empty()),
            "{name}"
        );
        assert_eq!(tool["annotations"]["title"], tool["title"], "{name}");
        assert_eq!(tool["annotations"]["openWorldHint"], false, "{name}");
        // Destructive means it can remove or replace: never the additive ones.
        let destructive = matches!(
            name,
            "update_note" | "untag_note" | "remove_from_space" | "trash_note"
        );
        assert_eq!(
            tool["annotations"]["destructiveHint"], destructive,
            "{name}"
        );
    }
}

#[test]
fn modern_clients_need_no_handshake() {
    let mut store = store_with("read");
    let note = store
        .create_note(CreateNoteInput {
            body: Some("Roadmap".into()),
            ..Default::default()
        })
        .unwrap();
    let replies = session(
        &mut store,
        &[
            modern(1, "server/discover", json!({})),
            modern(2, "tools/list", json!({})),
            modern(
                3,
                "tools/call",
                json!({ "name": "get_note", "arguments": { "id": note.id } }),
            ),
        ],
    );
    let discover = &replies[0]["result"];
    assert_eq!(discover["resultType"], "complete");
    let versions = discover["supportedVersions"].as_array().unwrap();
    assert_eq!(versions[0], "2026-07-28");
    assert!(
        versions.contains(&json!("2025-11-25")),
        "still serves legacy"
    );
    assert!(discover["capabilities"]["tools"].is_object());
    assert_eq!(
        discover["_meta"]["io.modelcontextprotocol/serverInfo"]["name"],
        "instantnotes"
    );

    let list = &replies[1]["result"];
    assert_eq!(list["resultType"], "complete");
    assert!(list["ttlMs"].as_u64().is_some());
    assert_eq!(list["cacheScope"], "private");

    let (is_error, _, read) = result_of(&replies[2]);
    assert!(!is_error);
    assert_eq!(read["title"], "Roadmap");
    assert_eq!(replies[2]["result"]["resultType"], "complete");
    // Who is acting comes from the request itself, not a handshake.
    let log = store.get_setting(ACTIVITY_KEY).unwrap().unwrap();
    assert_eq!(log[0]["client"], "codex");
}

#[test]
fn an_unsupported_version_names_the_supported_ones() {
    let mut store = store_with("read");
    let mut request = modern(1, "tools/list", json!({}));
    request["params"]["_meta"]["io.modelcontextprotocol/protocolVersion"] = json!("2099-01-01");
    let replies = session(&mut store, &[request]);
    let error = &replies[0]["error"];
    assert_eq!(error["code"], -32022);
    assert_eq!(error["data"]["requested"], "2099-01-01");
    assert_eq!(error["data"]["supported"][0], "2026-07-28");
}

#[test]
fn legacy_results_stay_legacy_shaped() {
    let mut store = store_with("read");
    let replies = session(
        &mut store,
        &[
            init(),
            json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }),
        ],
    );
    assert_eq!(replies[0]["result"]["serverInfo"]["title"], "InstantNotes");
    assert!(replies[1]["result"].get("resultType").is_none());
    assert!(replies[1]["result"].get("ttlMs").is_none());
}

#[test]
fn a_batch_gets_one_array_back_without_the_notifications() {
    let mut store = store_with("read");
    let batch = json!([
        init(),
        { "jsonrpc": "2.0", "method": "notifications/initialized" },
        { "jsonrpc": "2.0", "id": 1, "method": "tools/list" }
    ]);
    let replies = session(&mut store, &[batch, json!([])]);
    let answers = replies[0]
        .as_array()
        .expect("a batch is answered with an array");
    assert_eq!(answers.len(), 2);
    assert_eq!(answers[0]["id"], 0);
    assert_eq!(answers[1]["id"], 1);
    assert_eq!(
        replies[1]["error"]["code"], -32600,
        "an empty batch is invalid"
    );
}

#[test]
fn unknown_tools_and_malformed_calls_are_protocol_errors() {
    let mut store = store_with("write");
    let replies = session(
        &mut store,
        &[
            init(),
            call(1, "drop_database", json!({})),
            json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call",
                    "params": { "name": "get_note", "arguments": "id=1" } }),
            // A bad argument is the tool's error, which the model can fix.
            call(3, "get_note", json!({ "note": "x" })),
        ],
    );
    assert_eq!(replies[1]["error"]["code"], -32602);
    assert_eq!(
        replies[1]["error"]["message"],
        "Unknown tool: drop_database"
    );
    assert_eq!(replies[2]["error"]["code"], -32602);
    let (is_error, text, _) = result_of(&replies[3]);
    assert!(is_error);
    assert!(text.contains("invalid arguments"), "{text}");
}

#[test]
fn malformed_messages_are_refused_and_the_server_keeps_going() {
    let mut store = store_with("read");
    let mut input = Vec::new();
    // No jsonrpc member.
    input.extend_from_slice(b"{\"id\":1,\"method\":\"ping\"}\n");
    // A null id, which MCP forbids.
    input.extend_from_slice(b"{\"jsonrpc\":\"2.0\",\"id\":null,\"method\":\"ping\"}\n");
    // A response to nothing: never answered.
    input.extend_from_slice(b"{\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{}}\n");
    // Bytes that are not UTF-8.
    input.extend_from_slice(b"\xff\xfe\n");
    input.extend_from_slice(b"{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"ping\"}\n");
    let replies = raw_session(&mut store, &input);
    assert_eq!(replies.len(), 4, "{replies:?}");
    assert_eq!(replies[0]["error"]["code"], -32600);
    assert_eq!(replies[0]["id"], 1);
    assert_eq!(replies[1]["error"]["code"], -32600);
    assert_eq!(replies[1]["id"], Value::Null);
    assert_eq!(replies[2]["error"]["code"], -32700);
    assert_eq!(replies[3]["result"], json!({}), "still serving");
}

#[test]
fn a_result_carries_its_json_structured_and_as_text() {
    let mut store = store_with("read");
    let replies = session(&mut store, &[init(), call(1, "list_tags", json!({}))]);
    let (is_error, _, parsed) = result_of(&replies[1]);
    assert!(!is_error);
    assert_eq!(replies[1]["result"]["structuredContent"], parsed);
}

#[test]
fn access_off_refuses_everything_and_leaves_no_trace() {
    let mut store = store_with("off");
    let replies = session(&mut store, &[init(), call(1, "list_notes", json!({}))]);
    let (is_error, text, _) = result_of(&replies[1]);
    assert!(is_error);
    assert!(text.contains("Settings > Agents"));
    assert_eq!(store.get_setting(ACTIVITY_KEY).unwrap(), None);
}

#[test]
fn read_only_reads_but_refuses_writes() {
    let mut store = store_with("read");
    let note = store
        .create_note(CreateNoteInput {
            body: Some("Fix the #sync bug".into()),
            ..Default::default()
        })
        .unwrap();
    let replies = session(
        &mut store,
        &[
            init(),
            call(1, "get_note", json!({ "id": note.id })),
            call(2, "append_to_note", json!({ "id": note.id, "text": "no" })),
        ],
    );
    let (is_error, _, read) = result_of(&replies[1]);
    assert!(!is_error);
    assert_eq!(read["body"], "Fix the #sync bug");
    assert_eq!(read["tags"], json!(["sync"]));
    let (is_error, text, _) = result_of(&replies[2]);
    assert!(is_error);
    assert!(text.contains("read only"));

    // Reading never marks the note as opened: it stays in Revisit.
    let after = store.get_note(&note.id, false).unwrap();
    assert_eq!(after.last_opened_at, None);
    assert_eq!(after.body, "Fix the #sync bug");
}

#[test]
fn write_creates_files_and_appends_through_the_core_rules() {
    let mut store = store_with("write");
    let replies = session(
        &mut store,
        &[
            init(),
            call(
                1,
                "create_note",
                json!({
                    "body": "Agent idea\nwith a #plan", "space": "Ideas", "tags": ["later"]
                }),
            ),
        ],
    );
    let (is_error, text, created) = result_of(&replies[1]);
    assert!(!is_error, "{text}");
    assert_eq!(created["title"], "Agent idea");
    assert_eq!(created["spaces"], json!(["Ideas"]));
    let mut tags: Vec<String> = serde_json::from_value(created["tags"].clone()).unwrap();
    tags.sort();
    assert_eq!(tags, ["later", "plan"]);

    let id = created["id"].as_str().unwrap().to_string();
    let replies = session(
        &mut store,
        &[
            init(),
            call(
                1,
                "append_to_note",
                json!({ "id": id, "text": "- step one" }),
            ),
            call(2, "list_notes", json!({ "space": "ideas" })),
            call(3, "search_notes", json!({ "query": "step" })),
        ],
    );
    let (_, _, appended) = result_of(&replies[1]);
    assert_eq!(appended["body"], "Agent idea\nwith a #plan\n- step one");
    let (_, _, listed) = result_of(&replies[2]);
    assert_eq!(listed["notes"][0]["id"], json!(id));
    let (_, _, found) = result_of(&replies[3]);
    assert_eq!(found["results"][0]["id"], json!(id));
    assert!(!found["results"][0]["excerpt"]
        .as_str()
        .unwrap()
        .contains('\u{1}'));
}

#[test]
fn update_with_a_stale_version_is_a_conflict() {
    let mut store = store_with("write");
    let note = store
        .create_note(CreateNoteInput {
            body: Some("v1".into()),
            ..Default::default()
        })
        .unwrap();
    let replies = session(
        &mut store,
        &[
            init(),
            call(
                1,
                "update_note",
                json!({
                    "id": note.id, "expectedUpdatedAt": note.updated_at, "body": "v2"
                }),
            ),
            // The version it read is now stale.
            call(
                2,
                "update_note",
                json!({
                    "id": note.id, "expectedUpdatedAt": note.updated_at, "body": "v3"
                }),
            ),
        ],
    );
    assert!(!result_of(&replies[1]).0);
    let (is_error, text, _) = result_of(&replies[2]);
    assert!(is_error);
    assert!(text.starts_with("CONFLICT"), "{text}");
    assert_eq!(store.get_note(&note.id, false).unwrap().body, "v2");
}

#[test]
fn whiteboard_text_is_refused() {
    let mut store = store_with("write");
    let note = store.create_note(CreateNoteInput::default()).unwrap();
    store
        .update_note(
            &note.id,
            instantnotes_core::types::UpdateNotePatch {
                content_kind: Some("whiteboard".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let replies = session(
        &mut store,
        &[
            init(),
            call(1, "append_to_note", json!({ "id": note.id, "text": "x" })),
        ],
    );
    let (is_error, text, _) = result_of(&replies[1]);
    assert!(is_error);
    assert!(text.contains("whiteboard"));
}

#[test]
fn revisit_lists_only_fresh_captures_once_they_are_old_enough() {
    let mut store = store_with("read");
    let fresh = store
        .create_note(CreateNoteInput {
            body: Some("just captured".into()),
            ..Default::default()
        })
        .unwrap();
    let replies = session(
        &mut store,
        &[
            init(),
            call(1, "list_notes", json!({ "status": "revisit" })),
            call(2, "list_notes", json!({})),
        ],
    );
    // A capture from moments ago is not yet an open loop; it is a live note.
    let (is_error, text, open) = result_of(&replies[1]);
    assert!(!is_error, "{text}");
    assert_eq!(open["notes"], json!([]));
    let (_, _, all) = result_of(&replies[2]);
    assert_eq!(all["notes"][0]["id"], json!(fresh.id));
}

#[test]
fn every_successful_call_is_recorded_for_the_app_newest_first() {
    let mut store = store_with("read");
    let note = store
        .create_note(CreateNoteInput {
            body: Some("Roadmap".into()),
            ..Default::default()
        })
        .unwrap();
    session(
        &mut store,
        &[
            init(),
            call(1, "list_notes", json!({})),
            call(2, "get_note", json!({ "id": note.id })),
            call(3, "get_note", json!({ "id": "missing" })),
        ],
    );
    let log = store.get_setting(ACTIVITY_KEY).unwrap().unwrap();
    let log = log.as_array().unwrap();
    assert_eq!(log.len(), 2, "the failed call is not recorded");
    assert_eq!(log[0]["tool"], "get_note");
    assert_eq!(log[0]["client"], "claude-code");
    assert_eq!(log[0]["kind"], "read");
    assert_eq!(log[0]["noteIds"], json!([note.id]));
    assert_eq!(log[0]["titles"], json!(["Roadmap"]));
    assert_eq!(log[1]["tool"], "list_notes");
}

#[test]
fn a_titled_note_is_found_by_its_title_and_rewritten_without_a_read() {
    let mut store = store_with("write");
    let note = store
        .create_note(CreateNoteInput {
            title: Some("Install InstantNotes on CachyOS/Arch".into()),
            body: Some("hello world".into()),
            ..Default::default()
        })
        .unwrap();
    let ws = store.get_or_create_workspace("Instant Notes").unwrap();
    store.add_note_to_workspace(&note.id, &ws.id).unwrap();

    let replies = session(
        &mut store,
        &[
            init(),
            call(
                1,
                "search_notes",
                json!({ "query": "Install InstantNotes on CachyOS/Arch" }),
            ),
        ],
    );
    let (_, _, found) = result_of(&replies[1]);
    let hit = &found["results"][0];
    assert_eq!(hit["id"], json!(note.id));
    assert_eq!(hit["spaces"], json!(["Instant Notes"]));

    let replies = session(
        &mut store,
        &[
            init(),
            call(
                1,
                "update_note",
                json!({ "id": note.id, "expectedUpdatedAt": hit["updatedAt"], "body": "steps" }),
            ),
            // Stale now: the conflict carries the current note.
            call(
                2,
                "update_note",
                json!({ "id": note.id, "expectedUpdatedAt": hit["updatedAt"], "body": "again" }),
            ),
        ],
    );
    let (is_error, text, written) = result_of(&replies[1]);
    assert!(!is_error, "{text}");
    assert!(written.get("body").is_none(), "{text}");
    let (is_error, text, _) = result_of(&replies[2]);
    assert!(is_error);
    assert!(
        text.starts_with("CONFLICT") && text.contains("\"body\": \"steps\""),
        "{text}"
    );
}
