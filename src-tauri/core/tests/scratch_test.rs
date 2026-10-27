use instantnotes_core::store::activity::{ClientSession, SCRATCH_CHARS, SCRATCH_KEEP};
use instantnotes_core::{AppError, Store};

fn store() -> Store {
    Store::open_in_memory().expect("open in-memory store")
}

fn texts(entries: &[instantnotes_core::store::activity::ScratchEntry]) -> Vec<&str> {
    entries.iter().map(|e| e.text.as_str()).collect()
}

#[test]
fn an_entry_is_trimmed_and_numbered_in_order() {
    let mut s = store();
    let first = s
        .write_scratch("s1", "claude-code", "plan", "  Look at the merge step  ")
        .unwrap();
    assert_eq!(first.seq, 1);
    assert_eq!(first.text, "Look at the merge step");
    assert_eq!(first.kind, "plan");
    let second = s
        .write_scratch("s1", "claude-code", "note", "done")
        .unwrap();
    assert_eq!(second.seq, 2);
    assert_eq!(s.latest_scratch_seq().unwrap(), 2);
    let listed = s.list_scratch("s1", 10).unwrap();
    assert_eq!(listed.iter().map(|e| e.seq).collect::<Vec<_>>(), [1, 2]);
    assert_eq!(texts(&s.list_scratch("s1", 1).unwrap()), ["done"]);
    assert!(s.list_scratch("other", 10).unwrap().is_empty());
    assert_eq!(s.count_scratch("s1").unwrap(), 2);
}

#[test]
fn only_the_newest_entries_are_kept() {
    let mut s = store();
    for i in 0..(SCRATCH_KEEP + 3) {
        s.write_scratch("s1", "codex", "note", &format!("entry {i}"))
            .unwrap();
    }
    let all = s.list_scratch("s1", 10_000).unwrap();
    assert_eq!(all.len() as i64, SCRATCH_KEEP);
    assert_eq!(all[0].seq, 4);
    assert_eq!(s.scratch_since(0, 1).unwrap()[0].seq, 4);
    assert_eq!(s.scratch_since(SCRATCH_KEEP + 2, 10).unwrap().len(), 1);
}

#[test]
fn a_bad_kind_an_empty_text_and_an_overlong_text_are_refused() {
    let mut s = store();
    assert!(matches!(
        s.write_scratch("s1", "codex", "todo", "x"),
        Err(AppError::Validation(m)) if m.contains("note, plan, memory, decision")
    ));
    assert!(matches!(
        s.write_scratch("s1", "codex", "note", "   "),
        Err(AppError::Validation(_))
    ));
    let long = "x".repeat(SCRATCH_CHARS + 1);
    assert!(matches!(
        s.write_scratch("s1", "codex", "note", &long),
        Err(AppError::Validation(_))
    ));
    assert!(s
        .write_scratch("s1", "codex", "note", &"y".repeat(SCRATCH_CHARS))
        .is_ok());
    assert_eq!(s.latest_scratch_seq().unwrap(), 1);
}

#[test]
fn clearing_the_activity_clears_the_scratchpad_too() {
    let mut s = store();
    s.write_scratch("s1", "codex", "decision", "ship it")
        .unwrap();
    s.clear_activity().unwrap();
    assert_eq!(s.latest_scratch_seq().unwrap(), 0);
    assert!(s.read_scratch("s1", 10).unwrap().is_empty());
}

#[test]
fn reading_follows_the_client_session_across_reconnects() {
    let mut s = store();
    let about = ClientSession {
        client_session: Some("abc".into()),
        ..Default::default()
    };
    s.open_agent_session("first", "claude-code").unwrap();
    s.describe_agent_session("first", &about).unwrap();
    s.write_scratch("first", "claude-code", "memory", "remember this")
        .unwrap();
    s.close_agent_session("first").unwrap();
    s.open_agent_session("second", "claude-code").unwrap();
    s.describe_agent_session("second", &about).unwrap();
    s.write_scratch("second", "claude-code", "note", "and this")
        .unwrap();
    assert_eq!(
        texts(&s.read_scratch("second", 10).unwrap()),
        ["remember this", "and this"]
    );
    assert_eq!(s.count_scratch("second").unwrap(), 2);
    assert_eq!(s.list_scratch("second", 10).unwrap().len(), 1);
    assert_eq!(texts(&s.read_scratch("second", 1).unwrap()), ["and this"]);

    s.open_agent_session("third", "codex").unwrap();
    s.describe_agent_session(
        "third",
        &ClientSession {
            client_session: Some("xyz".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(s.read_scratch("third", 10).unwrap().is_empty());
    assert_eq!(s.count_scratch("third").unwrap(), 0);

    s.open_agent_session("first", "codex").unwrap();
    assert_eq!(s.count_scratch("first").unwrap(), 2);
    let row = s
        .list_agent_sessions(10)
        .unwrap()
        .into_iter()
        .find(|r| r.session == "first")
        .unwrap();
    assert_eq!(row.client_session.as_deref(), Some("abc"));
    assert_eq!(row.client, "codex");
}
