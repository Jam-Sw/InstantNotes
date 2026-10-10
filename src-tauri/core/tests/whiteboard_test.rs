use instantnotes_core::types::*;
use instantnotes_core::Store;

const BOARD: &str =
    r#"{"v":1,"engine":"excalidraw","data":{"elements":[],"appState":{},"files":{}}}"#;

fn store() -> Store {
    Store::open_in_memory().expect("open in-memory store")
}

fn create(store: &mut Store, body: &str) -> Note {
    store
        .create_note(CreateNoteInput {
            body: Some(body.to_string()),
            ..Default::default()
        })
        .expect("create note")
}

fn convert(store: &mut Store, id: &str) -> Note {
    store
        .update_note(
            id,
            UpdateNotePatch {
                content_kind: Some(CONTENT_KIND_WHITEBOARD.into()),
                surface_data: Some(BOARD.into()),
                ..Default::default()
            },
        )
        .expect("convert to whiteboard")
}

#[test]
fn new_notes_are_documents_without_a_board() {
    let mut s = store();
    let n = create(&mut s, "plain");
    assert_eq!(n.content_kind, CONTENT_KIND_DOCUMENT);
    assert!(n.surface_data.is_none());
}

#[test]
fn converting_sets_the_kind_and_board_and_keeps_the_body() {
    let mut s = store();
    let n = create(&mut s, "planning notes");
    let wb = convert(&mut s, &n.id);
    assert_eq!(wb.content_kind, CONTENT_KIND_WHITEBOARD);
    assert_eq!(wb.surface_data.as_deref(), Some(BOARD));
    assert_eq!(wb.body, "planning notes");
}

#[test]
fn converting_freezes_an_auto_title() {
    let mut s = store();
    let n = create(&mut s, "Roadmap\nsecond line");
    convert(&mut s, &n.id);
    let after = s
        .update_note(
            &n.id,
            UpdateNotePatch {
                body: Some("Some sticky note\nRoadmap".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(after.title, "Roadmap");
    assert!(!s.title_is_auto(&n.id).unwrap());
}

#[test]
fn a_board_save_updates_body_and_board_together() {
    let mut s = store();
    let n = create(&mut s, "x");
    convert(&mut s, &n.id);
    let next = BOARD.replace("\"elements\":[]", "\"elements\":[{\"id\":\"a\"}]");
    let saved = s
        .update_note(
            &n.id,
            UpdateNotePatch {
                body: Some("text on the board #ideas".into()),
                surface_data: Some(next.clone()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(saved.surface_data.as_deref(), Some(next.as_str()));
    assert_eq!(saved.body, "text on the board #ideas");
    let tags: Vec<String> = s
        .tags_for_note(&n.id)
        .unwrap()
        .into_iter()
        .map(|t| t.name)
        .collect();
    assert_eq!(tags, vec!["ideas"]);
}

#[test]
fn a_whiteboard_cannot_become_a_document_again() {
    let mut s = store();
    let n = create(&mut s, "x");
    convert(&mut s, &n.id);
    let err = s
        .update_note(
            &n.id,
            UpdateNotePatch {
                content_kind: Some(CONTENT_KIND_DOCUMENT.into()),
                ..Default::default()
            },
        )
        .unwrap_err();
    assert_eq!(err.code(), "VALIDATION_ERROR");
}

#[test]
fn a_document_cannot_hold_a_board() {
    let mut s = store();
    let n = create(&mut s, "x");
    let err = s
        .update_note(
            &n.id,
            UpdateNotePatch {
                surface_data: Some(BOARD.into()),
                ..Default::default()
            },
        )
        .unwrap_err();
    assert_eq!(err.code(), "VALIDATION_ERROR");
    assert!(s.get_note(&n.id, false).unwrap().surface_data.is_none());
}

#[test]
fn an_unknown_kind_is_rejected() {
    let mut s = store();
    let n = create(&mut s, "x");
    let err = s
        .update_note(
            &n.id,
            UpdateNotePatch {
                content_kind: Some("canvas".into()),
                ..Default::default()
            },
        )
        .unwrap_err();
    assert_eq!(err.code(), "VALIDATION_ERROR");
}

#[test]
fn list_rows_carry_the_kind_but_not_the_board() {
    let mut s = store();
    let n = create(&mut s, "x");
    convert(&mut s, &n.id);
    let row = s
        .list_notes(Default::default())
        .unwrap()
        .into_iter()
        .find(|r| r.id == n.id)
        .unwrap();
    assert_eq!(row.content_kind, CONTENT_KIND_WHITEBOARD);
    assert!(row.surface_data.is_none());
    assert_eq!(
        s.get_note(&n.id, false).unwrap().surface_data.as_deref(),
        Some(BOARD)
    );
}

#[test]
fn text_on_a_board_is_searchable() {
    let mut s = store();
    let n = create(&mut s, "x");
    convert(&mut s, &n.id);
    s.update_note(
        &n.id,
        UpdateNotePatch {
            body: Some("quarterly flywheel".into()),
            surface_data: Some(BOARD.into()),
            ..Default::default()
        },
    )
    .unwrap();
    let hits = s.search_notes("flywheel", 10).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].note_id, n.id);
}
