use instantnotes_core::types::*;
use instantnotes_core::{AppError, Store};

fn create(store: &mut Store, body: &str) -> Note {
    store
        .create_note(CreateNoteInput {
            body: Some(body.to_string()),
            ..Default::default()
        })
        .expect("create note")
}

fn body_patch(body: &str, expected: Option<&str>) -> UpdateNotePatch {
    UpdateNotePatch {
        body: Some(body.to_string()),
        expected_updated_at: expected.map(str::to_string),
        ..Default::default()
    }
}

#[test]
fn update_with_current_version_applies() {
    let mut s = Store::open_in_memory().unwrap();
    let n = create(&mut s, "first");
    let updated = s
        .update_note(&n.id, body_patch("second", Some(&n.updated_at)))
        .unwrap();
    assert_eq!(updated.body, "second");
}

#[test]
fn update_with_stale_version_conflicts_and_changes_nothing() {
    let mut s = Store::open_in_memory().unwrap();
    let n = create(&mut s, "first");
    s.update_note(&n.id, body_patch("someone else", None))
        .unwrap();

    let err = s
        .update_note(&n.id, body_patch("mine", Some(&n.updated_at)))
        .unwrap_err();
    assert!(matches!(err, AppError::Conflict(_)), "got {err:?}");
    assert_eq!(err.code(), "CONFLICT");
    assert_eq!(s.get_note(&n.id, false).unwrap().body, "someone else");
}

#[test]
fn two_stores_on_one_file_see_each_other_and_data_version_moves() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("instantnotes.db");
    let mut app = Store::open(&path).unwrap();
    let mut agent = Store::open(&path).unwrap();

    let before = app.data_version().unwrap();
    let n = create(&mut app, "from the app");
    assert_eq!(app.data_version().unwrap(), before);

    let seen = agent.get_note(&n.id, false).unwrap();
    agent
        .update_note(&n.id, body_patch("agent edit", Some(&seen.updated_at)))
        .unwrap();

    assert_ne!(app.data_version().unwrap(), before);
    assert_eq!(app.get_note(&n.id, false).unwrap().body, "agent edit");

    let err = app
        .update_note(&n.id, body_patch("stale", Some(&n.updated_at)))
        .unwrap_err();
    assert_eq!(err.code(), "CONFLICT");
}

#[test]
fn a_reader_sees_the_writers_commits_and_cannot_write() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.db");
    let mut writer = Store::open(&path).unwrap();
    let reader = Store::open_reader(&path).unwrap();
    assert!(reader.list_notes(NoteFilter::default()).unwrap().is_empty());

    let n = create(&mut writer, "first");
    let listed = reader.list_notes(NoteFilter::default()).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, n.id);

    writer
        .update_note(&n.id, body_patch("second", None))
        .unwrap();
    assert_eq!(
        reader.list_notes(NoteFilter::default()).unwrap()[0].body,
        "second"
    );

    let mut reader = reader;
    assert!(reader
        .create_note(CreateNoteInput {
            body: Some("nope".to_string()),
            ..Default::default()
        })
        .is_err());
}
