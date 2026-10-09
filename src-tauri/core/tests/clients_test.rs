use instantnotes_core::clients::{
    current_in, elapsed_ms, identify_in, Client, ClientProcess, EXACT, INFERRED,
};
use std::path::Path;

fn process(pid: i64, cwd: &str, started_at: i64) -> ClientProcess {
    ClientProcess {
        pid,
        command: String::new(),
        cwd: Some(cwd.into()),
        started_at: Some(started_at),
    }
}

fn no_env(_: &str) -> Option<String> {
    None
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

#[test]
fn a_client_is_known_by_its_handshake_or_by_the_process_that_started_the_server() {
    assert_eq!(Client::from_name("claude-code"), Some(Client::ClaudeCode));
    assert_eq!(Client::from_name("codex-mcp-client"), Some(Client::Codex));
    assert_eq!(Client::from_name("hermes-agent"), Some(Client::Hermes));
    assert_eq!(
        Client::from_name("mcp"),
        None,
        "the SDK default names no one"
    );
    assert_eq!(
        Client::from_command("claude --plugin-dir /x"),
        Some(Client::ClaudeCode)
    );
    assert_eq!(
        Client::from_command("/opt/homebrew/Caskroom/codex/0.159.3/bin/codex exec hi"),
        Some(Client::Codex)
    );
    assert_eq!(
        Client::from_command("/Users/me/.hermes/tools/python-3.14/bin/python3 -I -c import sys"),
        Some(Client::Hermes)
    );
    assert_eq!(Client::from_command("/bin/zsh -l"), None);
}

#[test]
fn elapsed_time_reads_every_shape_ps_prints() {
    assert_eq!(elapsed_ms("00:07"), Some(7_000));
    assert_eq!(elapsed_ms("04:27"), Some(267_000));
    assert_eq!(elapsed_ms("01:02:03"), Some(3_723_000));
    assert_eq!(elapsed_ms("2-00:00:01"), Some(172_801_000));
    assert_eq!(elapsed_ms("soon"), None);
}

#[test]
fn claude_code_says_its_session_itself_and_a_rename_is_followed() {
    let home = tempfile::tempdir().unwrap();
    let file = home.path().join(".claude/sessions/42.json");
    write(
        &file,
        r#"{"pid":42,"sessionId":"resumed-id","name":" instantnotes-77 "}"#,
    );
    let env = |key: &str| match key {
        "CLAUDE_CODE_SESSION_ID" => Some("env-id".to_string()),
        "CLAUDE_PROJECT_DIR" => Some("/work".to_string()),
        _ => None,
    };
    let about = identify_in(
        Some(home.path()),
        Some(Client::ClaudeCode),
        Some(&process(42, "/elsewhere", 0)),
        &env,
    );
    assert_eq!(about.label.as_deref(), Some("instantnotes-77"));
    assert_eq!(
        about.client_session.as_deref(),
        Some("resumed-id"),
        "the file follows a resume"
    );
    assert_eq!(about.cwd.as_deref(), Some("/work"));
    assert_eq!(about.matched.as_deref(), Some(EXACT));

    write(&file, r#"{"pid":42,"sessionId":"resumed-id","name":"bob"}"#);
    let now = current_in(home.path(), Client::ClaudeCode, Some(42), None).unwrap();
    assert_eq!(now.label.as_deref(), Some("bob"));

    let bare = identify_in(
        Some(home.path()),
        Some(Client::ClaudeCode),
        Some(&process(7, "/w", 0)),
        &env,
    );
    assert_eq!(bare.client_session.as_deref(), Some("env-id"));
    assert_eq!(bare.label, None);
}

#[test]
fn a_codex_thread_is_the_one_its_process_began_in_that_folder() {
    let home = tempfile::tempdir().unwrap();
    let day = home.path().join(".codex/sessions/2026/10/02");
    let head = |id: &str, ts: &str, cwd: &str| {
        format!(
            r#"{{"timestamp":"{ts}","type":"session_meta","payload":{{"id":"{id}","timestamp":"{ts}","cwd":"{cwd}"}}}}"#
        )
    };
    write(
        &day.join("rollout-2026-10-02T09-00-00-old.jsonl"),
        &head("old", "2026-10-02T09:00:00.000Z", "/work"),
    );
    write(
        &day.join("rollout-2026-10-02T09-18-05-mine.jsonl"),
        &head("mine", "2026-10-02T09:18:05.014Z", "/work"),
    );
    write(
        &day.join("rollout-2026-10-02T09-18-06-other.jsonl"),
        &head("other", "2026-10-02T09:18:06.000Z", "/elsewhere"),
    );
    write(
        &home.path().join(".codex/session_index.jsonl"),
        "{\"id\":\"mine\",\"thread_name\":\"First name\"}\n{\"id\":\"mine\",\"thread_name\":\"Fix the build\"}\n",
    );
    let began = chrono::DateTime::parse_from_rfc3339("2026-10-02T09:18:04Z")
        .unwrap()
        .timestamp_millis();
    let about = identify_in(
        Some(home.path()),
        Some(Client::Codex),
        Some(&process(9, "/work", began)),
        &no_env,
    );
    assert_eq!(about.client_session.as_deref(), Some("mine"));
    assert_eq!(
        about.label.as_deref(),
        Some("Fix the build"),
        "the last name given wins"
    );
    assert_eq!(about.matched.as_deref(), Some(INFERRED));

    let late = identify_in(
        Some(home.path()),
        Some(Client::Codex),
        Some(&process(9, "/work", began + 60_000)),
        &no_env,
    );
    assert_eq!(late.client_session, None);
    assert_eq!(late.matched, None);

    let now = current_in(home.path(), Client::Codex, None, Some("mine")).unwrap();
    assert_eq!(now.label.as_deref(), Some("Fix the build"));
}

#[test]
fn a_hermes_session_is_the_open_one_its_process_began() {
    let home = tempfile::tempdir().unwrap();
    let db = home.path().join(".hermes/state.db");
    std::fs::create_dir_all(db.parent().unwrap()).unwrap();
    let conn = rusqlite::Connection::open(&db).unwrap();
    conn.execute_batch(
        "CREATE TABLE sessions (id TEXT PRIMARY KEY, started_at REAL NOT NULL, ended_at REAL, cwd TEXT, title TEXT);
         INSERT INTO sessions VALUES ('ended', 2000.0, 2100.0, '/work', 'Done already');
         INSERT INTO sessions VALUES ('before', 500.0, NULL, '/work', 'From an earlier run');
         INSERT INTO sessions VALUES ('mine', 1002.0, NULL, '/work', 'Configure InstantNotes');
         INSERT INTO sessions VALUES ('other', 1003.0, NULL, '/elsewhere', 'Someone else');",
    )
    .unwrap();
    drop(conn);
    let about = identify_in(
        Some(home.path()),
        Some(Client::Hermes),
        Some(&process(5, "/work", 1_000_000)),
        &no_env,
    );
    assert_eq!(about.client_session.as_deref(), Some("mine"));
    assert_eq!(about.label.as_deref(), Some("Configure InstantNotes"));
    assert_eq!(about.matched.as_deref(), Some(INFERRED));

    let conn = rusqlite::Connection::open(&db).unwrap();
    conn.execute("UPDATE sessions SET title = 'bob' WHERE id = 'mine'", [])
        .unwrap();
    drop(conn);
    let now = current_in(home.path(), Client::Hermes, None, Some("mine")).unwrap();
    assert_eq!(now.label.as_deref(), Some("bob"));
}

#[test]
fn a_session_said_outright_wins_and_an_unknown_client_claims_nothing() {
    let home = tempfile::tempdir().unwrap();
    let env = |key: &str| match key {
        "INSTANTNOTES_SESSION_ID" => Some("abc".to_string()),
        "INSTANTNOTES_SESSION_NAME" => Some("nightly import".to_string()),
        _ => None,
    };
    let about = identify_in(
        Some(home.path()),
        Some(Client::Codex),
        Some(&process(1, "/work", 0)),
        &env,
    );
    assert_eq!(about.client_session.as_deref(), Some("abc"));
    assert_eq!(about.label.as_deref(), Some("nightly import"));
    assert_eq!(about.matched.as_deref(), Some(EXACT));

    let unknown = identify_in(
        Some(home.path()),
        None,
        Some(&process(1, "/work", 0)),
        &no_env,
    );
    assert_eq!(unknown.client_session, None);
    assert_eq!(unknown.label, None);
    assert_eq!(
        unknown.cwd.as_deref(),
        Some("/work"),
        "where it runs is still known"
    );
}
