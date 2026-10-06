//! The MCP server driven the way a client drives it: JSON-RPC lines in,
//! JSON-RPC lines out, against a real store.

use instantnotes_agents::{serve, ACCESS_KEY};
use instantnotes_core::store::activity::AgentActivity;
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

/// The trace, newest first.
fn trace(store: &Store) -> Vec<AgentActivity> {
    store.list_activity(100, 0).unwrap()
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
            json!({ "jsonrpc": "2.0", "id": 1, "method": "prompts/list" }),
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
    assert_eq!(trace(&store)[0].client, "codex");
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
    assert!(trace(&store).is_empty());
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
fn a_traced_call_keeps_the_whole_exchange_as_it_crossed_the_wire() {
    let mut store = store_with("read");
    let sent = [
        call(1, "search_notes", json!({ "query": "road" })),
        call(2, "get_note", json!({ "id": "missing" })),
    ];
    let replies = session(&mut store, &[init(), sent[0].clone(), sent[1].clone()]);
    let log = trace(&store);
    // Newest first: the failed get_note, then the search.
    for (row, (request, reply)) in log
        .iter()
        .zip([(&sent[1], &replies[2]), (&sent[0], &replies[1])])
    {
        let wire = store.activity_wire(row.seq).unwrap();
        let kept: Value = serde_json::from_str(wire.request.as_deref().unwrap()).unwrap();
        assert_eq!(&kept, request, "the request, whole");
        let kept: Value = serde_json::from_str(wire.response.as_deref().unwrap()).unwrap();
        assert_eq!(&kept, reply, "the response, whole, an error included");
    }
    assert!(store.activity_wire(9999).is_err());
}

#[test]
fn every_call_is_traced_for_the_app_newest_first_failures_included() {
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
            call(2, "search_notes", json!({ "query": "road" })),
            call(3, "get_note", json!({ "id": note.id })),
            call(4, "get_note", json!({ "id": "missing" })),
        ],
    );
    let log = trace(&store);
    assert_eq!(log.len(), 4, "every call, the failed one too");
    assert_eq!(log[0].tool, "get_note");
    assert_eq!(log[0].status, "error");
    assert!(log[0].error.as_deref().unwrap().contains("NOT_FOUND"));
    assert_eq!(log[0].note_ids, vec!["missing".to_string()]);
    assert!(!log[0].revertable);
    assert_eq!(log[1].tool, "get_note");
    assert_eq!(log[1].client, "claude-code");
    assert_eq!(log[1].kind, "read");
    assert_eq!(log[1].status, "ok");
    assert_eq!(log[1].note_ids, vec![note.id.clone()]);
    assert_eq!(log[1].titles, vec!["Roadmap".to_string()]);
    assert_eq!(log[2].tool, "search_notes");
    assert_eq!(log[2].kind, "search");
    assert_eq!(log[2].query.as_deref(), Some("road"));
    assert_eq!(log[3].tool, "list_notes");
    // One process, one session: every row shares it.
    assert!(log.iter().all(|e| e.session == log[0].session));
    assert!(!log[0].session.is_empty());
}

#[test]
fn a_write_keeps_the_note_as_it_was_and_the_app_can_revert_it() {
    let mut store = store_with("write");
    let note = store
        .create_note(CreateNoteInput {
            body: Some(
                "Plan
- one #work"
                    .into(),
            ),
            ..Default::default()
        })
        .unwrap();
    let replies = session(
        &mut store,
        &[
            init(),
            call(
                1,
                "append_to_note",
                json!({ "id": note.id, "text": "- two" }),
            ),
            call(2, "untag_note", json!({ "id": note.id, "tag": "work" })),
            call(3, "create_note", json!({ "body": "Fresh" })),
        ],
    );
    for r in &replies[1..] {
        assert!(!result_of(r).0, "{r}");
    }
    let (_, _, created) = result_of(&replies[3]);
    let created_id = created["id"].as_str().unwrap().to_string();

    let log = trace(&store);
    assert_eq!(log.len(), 3);
    assert!(log.iter().all(|e| e.kind == "write" && e.revertable));
    let appended = log.iter().find(|e| e.tool == "append_to_note").unwrap();
    // The untag came after, so the note has moved on since the append.
    assert!(appended.after_updated_at.is_some());
    let untagged = log.iter().find(|e| e.tool == "untag_note").unwrap();
    assert_eq!(
        untagged.after_updated_at.as_deref(),
        Some(store.get_note(&note.id, false).unwrap().updated_at.as_str()),
        "after_updated_at is the note's updatedAt once the write landed"
    );
    let before = store.activity_before(appended.seq).unwrap().unwrap();
    assert_eq!(
        before.body,
        "Plan
- one #work"
    );
    assert_eq!(
        before.tags,
        vec![("work".to_string(), "inline".to_string())]
    );

    // Revert the untag: the tag comes back with its original source.
    let untag = log.iter().find(|e| e.tool == "untag_note").unwrap();
    store.revert_activity(untag.seq).unwrap();
    let tags = store.tags_for_note(&note.id).unwrap();
    assert_eq!(tags.len(), 1);
    assert_eq!(tags[0].name, "work");
    // Then the append: the body is as it was, and the tag survives.
    store.revert_activity(appended.seq).unwrap();
    assert_eq!(
        store.get_note(&note.id, false).unwrap().body,
        "Plan
- one #work"
    );
    // A create is reverted by trashing, never deleting.
    let create = log.iter().find(|e| e.tool == "create_note").unwrap();
    assert!(store.activity_before(create.seq).unwrap().is_none());
    store.revert_activity(create.seq).unwrap();
    assert!(store.get_note(&created_id, false).unwrap().is_deleted);
    // Twice is refused.
    assert!(store.revert_activity(create.seq).is_err());

    // Each revert is itself a traced, revertable write, so it can be undone.
    let log = trace(&store);
    let reverts: Vec<&AgentActivity> = log.iter().filter(|e| e.tool == "revert").collect();
    assert_eq!(reverts.len(), 3);
    assert!(reverts
        .iter()
        .all(|e| e.client == "instantnotes" && e.revertable));
    assert_eq!(reverts[0].reverts, Some(create.seq));
    store.revert_activity(reverts[0].seq).unwrap();
    assert!(!store.get_note(&created_id, false).unwrap().is_deleted);
    // The reverted rows say so.
    assert!(log
        .iter()
        .find(|e| e.seq == create.seq)
        .unwrap()
        .reverted_at
        .is_some());
}

#[test]
fn notes_are_also_resources_behind_the_same_access_gate() {
    let mut store = store_with("off");
    let note = store
        .create_note(CreateNoteInput {
            body: Some(
                "Roadmap
Q4"
                .into(),
            ),
            ..Default::default()
        })
        .unwrap();
    let replies = session(
        &mut store,
        &[
            init(),
            json!({ "jsonrpc": "2.0", "id": 1, "method": "resources/list" }),
        ],
    );
    assert!(replies[0]["result"]["capabilities"]["resources"].is_object());
    assert_eq!(replies[1]["error"]["code"], -32602, "off: refused");

    store.set_setting(ACCESS_KEY, json!("read")).unwrap();
    let uri = format!("instantnotes://notes/{}", note.id);
    let replies = session(
        &mut store,
        &[
            init(),
            json!({ "jsonrpc": "2.0", "id": 1, "method": "resources/list" }),
            json!({ "jsonrpc": "2.0", "id": 2, "method": "resources/templates/list" }),
            json!({ "jsonrpc": "2.0", "id": 3, "method": "resources/read", "params": { "uri": uri } }),
            json!({ "jsonrpc": "2.0", "id": 4, "method": "resources/read",
                    "params": { "uri": "instantnotes://notes/nope" } }),
        ],
    );
    let listed = replies[1]["result"]["resources"].as_array().unwrap();
    assert_eq!(listed[0]["uri"], json!(uri));
    assert_eq!(listed[0]["title"], "Roadmap");
    assert_eq!(listed[0]["mimeType"], "text/markdown");
    let templates = replies[2]["result"]["resourceTemplates"]
        .as_array()
        .unwrap();
    assert_eq!(templates[0]["uriTemplate"], "instantnotes://notes/{id}");
    let contents = &replies[3]["result"]["contents"][0];
    assert_eq!(
        contents["text"],
        "Roadmap
Q4"
    );
    assert_eq!(contents["uri"], json!(uri));
    assert_eq!(replies[4]["error"]["code"], -32002);
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

#[test]
fn a_connection_is_on_record_from_its_start_to_its_goodbye() {
    let mut store = store_with("read");
    session(&mut store, &[init(), call(1, "list_notes", json!({}))]);
    let sessions = store.list_agent_sessions(10).unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].client, "claude-code", "named by the handshake");
    assert!(
        sessions[0].disconnected_at.is_some(),
        "stdin closed: it said goodbye"
    );
    // The trace's rows carry the same session, so the two line up.
    assert_eq!(trace(&store)[0].session, sessions[0].session);
    // Clearing the history forgets ended connections with it.
    store.clear_activity().unwrap();
    assert!(store.list_agent_sessions(10).unwrap().is_empty());
}

#[test]
fn a_held_lock_reads_as_alive_and_a_dropped_one_as_gone() {
    use instantnotes_core::store::activity::{hold_session_lock, session_alive, session_lock_path};
    let dir = std::env::temp_dir().join(format!("instantnotes-lock-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db = dir.join("library.db");
    assert!(!session_alive(&db, "s1"), "no lock file: not connected");
    let held = hold_session_lock(&db, "s1").expect("the lock is free");
    assert!(session_alive(&db, "s1"), "held: connected");
    // However the process ends, the lock goes with it.
    drop(held);
    assert!(!session_alive(&db, "s1"));
    assert!(
        !session_lock_path(&db, "s1").exists(),
        "and its file is cleared"
    );
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_connection_carries_what_its_client_says_about_its_session() {
    use instantnotes_core::store::activity::ClientSession;
    let mut store = store_with("read");
    session(&mut store, &[init()]);
    let id = store.list_agent_sessions(1).unwrap()[0].session.clone();
    store
        .describe_agent_session(
            &id,
            &ClientSession {
                label: Some("bob".into()),
                client_session: Some("ec23c3e6".into()),
                cwd: Some("/work".into()),
                client_pid: Some(42),
                matched: Some("inferred".into()),
            },
        )
        .unwrap();
    // A rename alone keeps the rest.
    store
        .describe_agent_session(
            &id,
            &ClientSession {
                label: Some("alice".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let row = &store.list_agent_sessions(1).unwrap()[0];
    assert_eq!(row.label.as_deref(), Some("alice"));
    assert_eq!(row.client_session.as_deref(), Some("ec23c3e6"));
    assert_eq!(row.cwd.as_deref(), Some("/work"));
}

fn note(store: &mut Store, body: &str) -> String {
    store
        .create_note(CreateNoteInput {
            body: Some(body.into()),
            ..Default::default()
        })
        .unwrap()
        .id
}

#[test]
fn search_shows_where_the_words_are_and_how_much_is_left() {
    let mut store = store_with("read");
    let taxes = note(
        &mut store,
        "Taxes\n\nGather the forms.\nThe deadline is April 30.\nAsk about the refund.\n\nUnrelated line.\nSecond deadline: the extension, in October.",
    );
    note(&mut store, "Groceries\n\nMilk, eggs.");
    let renew = note(&mut store, "Passport\n\nRenew before the trip.");

    let replies = session(
        &mut store,
        &[
            init(),
            call(1, "search_notes", json!({ "query": "deadline" })),
            // Every word, by default: no note has both.
            call(2, "search_notes", json!({ "query": "deadline renew" })),
            call(
                3,
                "search_notes",
                json!({ "query": "deadline renew", "match": "any", "limit": 1 }),
            ),
            call(
                4,
                "search_notes",
                json!({ "query": "deadline renew", "match": "any", "limit": 1, "offset": 1 }),
            ),
        ],
    );
    let (_, _, found) = result_of(&replies[1]);
    assert_eq!(found["total"], 1);
    assert_eq!(found["hasMore"], false);
    let hit = &found["results"][0];
    assert_eq!(hit["id"], taxes);
    assert_eq!(hit["matchingLines"], 2);
    // The matching line with the lines around it, and where it is.
    assert_eq!(hit["passages"][0]["line"], 4);
    assert_eq!(
        hit["passages"][0]["text"],
        "Gather the forms.\nThe deadline is April 30.\nAsk about the refund."
    );
    assert_eq!(hit["passages"][1]["line"], 8);
    assert!(hit["createdAt"].is_string() && hit["updatedAt"].is_string());

    assert_eq!(result_of(&replies[2]).2["total"], 0);

    let (_, _, first) = result_of(&replies[3]);
    assert_eq!(first["total"], 2, "any of the words: both notes");
    assert_eq!(first["results"].as_array().unwrap().len(), 1);
    assert_eq!(first["hasMore"], true);
    assert_eq!(first["nextOffset"], 1);
    let (_, _, second) = result_of(&replies[4]);
    assert_eq!(second["hasMore"], false);
    let seen = [
        first["results"][0]["id"].clone(),
        second["results"][0]["id"].clone(),
    ];
    assert!(
        seen.contains(&json!(taxes)) && seen.contains(&json!(renew)),
        "no note skipped or repeated"
    );
}

#[test]
fn search_narrows_by_space_tag_status_and_date() {
    let mut store = store_with("write");
    let plan = note(&mut store, "Plan the launch #work");
    let old = note(&mut store, "Launch retro");
    session(
        &mut store,
        &[
            init(),
            call(
                1,
                "add_to_space",
                json!({ "id": plan, "space": "Projects" }),
            ),
        ],
    );
    store
        .set_notes_flags(std::slice::from_ref(&old), None, Some(true))
        .unwrap();

    let ids = |reply: &Value| -> Vec<String> {
        result_of(reply).2["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["id"].as_str().unwrap().to_string())
            .collect()
    };
    let replies = session(
        &mut store,
        &[
            init(),
            call(1, "search_notes", json!({ "query": "launch" })),
            call(
                2,
                "search_notes",
                json!({ "query": "launch", "status": "all" }),
            ),
            call(
                3,
                "search_notes",
                json!({ "query": "launch", "status": "archived" }),
            ),
            call(
                4,
                "search_notes",
                json!({ "query": "launch", "status": "all", "space": "projects" }),
            ),
            call(
                5,
                "search_notes",
                json!({ "query": "launch", "status": "all", "tag": "#work" }),
            ),
            call(
                6,
                "search_notes",
                json!({ "query": "launch", "updatedAfter": "2999-01-01" }),
            ),
            call(
                7,
                "search_notes",
                json!({ "query": "launch", "updatedBefore": "2999-01-01" }),
            ),
            call(
                8,
                "search_notes",
                json!({ "query": "launch", "updatedAfter": "last week" }),
            ),
        ],
    );
    assert_eq!(
        ids(&replies[1]),
        vec![plan.clone()],
        "archived notes stay out by default"
    );
    assert_eq!(ids(&replies[2]).len(), 2);
    assert_eq!(ids(&replies[3]), vec![old.clone()]);
    assert_eq!(ids(&replies[4]), vec![plan.clone()]);
    assert_eq!(ids(&replies[5]), vec![plan.clone()]);
    assert!(ids(&replies[6]).is_empty());
    assert_eq!(ids(&replies[7]), vec![plan.clone()]);
    let (is_error, text, _) = result_of(&replies[8]);
    assert!(is_error && text.contains("not a date"), "{text}");
}

#[test]
fn several_notes_are_read_in_one_call_and_a_list_says_what_is_left() {
    let mut store = store_with("read");
    let a = note(&mut store, "Alpha\n\nfirst body");
    let b = note(&mut store, "Beta\n\nsecond body");
    note(&mut store, "Gamma");
    let replies = session(
        &mut store,
        &[
            init(),
            call(1, "get_notes", json!({ "ids": [b, "nope", a] })),
            call(2, "get_notes", json!({ "ids": [] })),
            call(3, "list_notes", json!({ "limit": 2 })),
            call(4, "list_notes", json!({ "limit": 2, "offset": 2 })),
        ],
    );
    let (_, _, read) = result_of(&replies[1]);
    let notes = read["notes"].as_array().unwrap();
    assert_eq!(notes.len(), 2);
    assert_eq!(notes[0]["id"], b, "in the order asked");
    assert_eq!(notes[0]["body"], "Beta\n\nsecond body");
    assert_eq!(notes[1]["id"], a);
    assert_eq!(read["missing"], json!(["nope"]));
    assert!(
        result_of(&replies[2]).0,
        "no ids is an error the model can fix"
    );

    let (_, _, page) = result_of(&replies[3]);
    assert_eq!(page["total"], 3);
    assert_eq!(page["hasMore"], true);
    assert_eq!(page["nextOffset"], 2);
    let (_, _, rest) = result_of(&replies[4]);
    assert_eq!(rest["notes"].as_array().unwrap().len(), 1);
    assert_eq!(rest["hasMore"], false);
    assert!(rest.get("nextOffset").is_none());

    // One trace row for the batch read, naming the notes it read.
    let read_row = trace(&store)
        .into_iter()
        .find(|e| e.tool == "get_notes" && e.status == "ok")
        .unwrap();
    assert_eq!(read_row.note_count, 2);
}

#[test]
fn suggest_space_answers_from_the_graphs_model_and_files_nothing() {
    let mut store = store_with("read");
    let mut file = |body: &str, space: &str| {
        let n = store
            .create_note(CreateNoteInput {
                body: Some(body.into()),
                ..Default::default()
            })
            .unwrap();
        let ws = store.get_or_create_workspace(space).unwrap();
        store.add_note_to_workspace(&n.id, &ws.id).unwrap();
    };
    file("Tomato ragu: simmer the sauce #pasta", "Recipes");
    file("Carbonara needs guanciale #pasta", "Recipes");
    file("Sprint review: velocity dropped #work", "Work");
    file("Quarterly roadmap draft #work", "Work");
    let unfiled = store
        .create_note(CreateNoteInput {
            body: Some("Lasagne for Sunday #pasta".into()),
            ..Default::default()
        })
        .unwrap();
    let loose = store
        .create_note(CreateNoteInput {
            body: Some("Call the dentist".into()),
            ..Default::default()
        })
        .unwrap();

    let replies = session(
        &mut store,
        &[
            init(),
            call(1, "suggest_space", json!({})),
            call(2, "suggest_space", json!({ "id": unfiled.id })),
            call(3, "suggest_space", json!({ "id": loose.id })),
        ],
    );
    let (is_error, _, all) = result_of(&replies[1]);
    assert!(!is_error);
    let list = all["suggestions"].as_array().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0]["id"], unfiled.id);
    assert_eq!(list[0]["space"], "Recipes");
    assert!(list[0]["probability"].as_f64().unwrap() >= 0.5);
    assert_eq!(list[0]["reasons"][0], "#pasta");
    let (_, _, one) = result_of(&replies[2]);
    assert_eq!(one["suggestions"].as_array().unwrap().len(), 1);
    let (_, _, none) = result_of(&replies[3]);
    assert_eq!(none["suggestions"], json!([]));

    // A read: traced as one, and the note is still in no Space.
    let rows = trace(&store);
    assert_eq!(rows[0].tool, "suggest_space");
    assert_eq!(rows[0].kind, "read");
    assert!(store.workspaces_for_note(&unfiled.id).unwrap().is_empty());
}

#[test]
fn a_note_with_no_space_is_refused_and_the_spaces_are_named() {
    let mut store = store_with("write");
    store.get_or_create_workspace("Hardware").unwrap();
    store.get_or_create_workspace("Job Hunt").unwrap();
    let replies = session(
        &mut store,
        &[
            init(),
            call(1, "create_note", json!({ "body": "Orphan" })),
            call(2, "create_note", json!({ "body": "Blank", "space": "  " })),
            call(
                3,
                "create_note",
                json!({ "body": "Filed", "space": "Hardware" }),
            ),
        ],
    );
    for i in [1, 2] {
        let (is_error, text, _) = result_of(&replies[i]);
        assert!(is_error, "{text}");
        assert!(
            text.contains("Hardware") && text.contains("Job Hunt"),
            "{text}"
        );
    }
    let (is_error, _, created) = result_of(&replies[3]);
    assert!(!is_error);
    assert_eq!(created["spaces"], json!(["Hardware"]));
    // Only the filed note was saved.
    let notes = store.list_notes(Default::default()).unwrap();
    assert_eq!(notes.len(), 1);
}

#[test]
fn a_library_with_no_spaces_still_takes_an_unfiled_note() {
    let mut store = store_with("write");
    let replies = session(
        &mut store,
        &[init(), call(1, "create_note", json!({ "body": "First" }))],
    );
    assert!(!result_of(&replies[1]).0, "{}", replies[1]);
}
