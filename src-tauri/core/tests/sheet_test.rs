use instantnotes_core::sheet::{Sheet, DEFAULT_TITLE, MAX_ROWS};
use instantnotes_core::types::*;
use instantnotes_core::Store;

const GRID: &str = r##"{"v":1,"engine":"grid","data":{"cols":[{"w":120},{"w":120},{"w":80}],"rows":[["What","State","ms"],["flaky test","#bug","412"],["","",""]]}}"##;

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

fn new_sheet(store: &mut Store) -> Note {
    let n = create(store, "");
    store
        .update_note(
            &n.id,
            UpdateNotePatch {
                content_kind: Some(CONTENT_KIND_SHEET.into()),
                ..Default::default()
            },
        )
        .expect("convert to sheet")
}

fn save_grid(store: &mut Store, id: &str, grid: &str) -> Note {
    store
        .update_note(
            id,
            UpdateNotePatch {
                surface_data: Some(grid.into()),
                ..Default::default()
            },
        )
        .expect("save grid")
}

#[test]
fn a_new_sheet_holds_the_default_grid_with_a_frozen_name() {
    let mut s = store();
    let sheet = new_sheet(&mut s);
    assert_eq!(sheet.content_kind, CONTENT_KIND_SHEET);
    assert_eq!(sheet.title, DEFAULT_TITLE);
    assert!(!s.title_is_auto(&sheet.id).unwrap());
    assert_eq!(sheet.body, "");
    let grid = Sheet::parse(sheet.surface_data.as_deref().unwrap()).unwrap();
    assert_eq!(grid, Sheet::new_default());
}

#[test]
fn a_grid_save_derives_the_body_and_its_tags() {
    let mut s = store();
    let sheet = new_sheet(&mut s);
    let saved = save_grid(&mut s, &sheet.id, GRID);
    assert_eq!(
        saved.body,
        "| What | State | ms |\n| --- | --- | --- |\n| flaky test | #bug | 412 |"
    );
    assert_eq!(saved.surface_data.as_deref(), Some(GRID));
    let tags: Vec<String> = s
        .tags_for_note(&sheet.id)
        .unwrap()
        .into_iter()
        .map(|t| t.name)
        .collect();
    assert_eq!(tags, vec!["bug"]);
    assert_eq!(saved.title, DEFAULT_TITLE);
}

#[test]
fn a_body_sent_with_a_sheet_is_ignored() {
    let mut s = store();
    let sheet = new_sheet(&mut s);
    let saved = s
        .update_note(
            &sheet.id,
            UpdateNotePatch {
                body: Some("someone's words".into()),
                surface_data: Some(GRID.into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(saved.body.starts_with("| What |"), "{}", saved.body);
    let alone = s
        .update_note(
            &sheet.id,
            UpdateNotePatch {
                body: Some("someone's words".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(alone.body.starts_with("| What |"), "{}", alone.body);
}

#[test]
fn a_sheet_is_found_by_the_words_in_its_cells() {
    let mut s = store();
    let sheet = new_sheet(&mut s);
    save_grid(&mut s, &sheet.id, GRID);
    let hits = s.search_notes("flaky", 10).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].note_id, sheet.id);
}

#[test]
fn a_bad_grid_is_refused_and_changes_nothing() {
    let mut s = store();
    let sheet = new_sheet(&mut s);
    let err = s
        .update_note(
            &sheet.id,
            UpdateNotePatch {
                surface_data: Some(
                    r#"{"v":1,"engine":"grid","data":{"cols":[{"w":1}],"rows":[["a","b"]]}}"#
                        .into(),
                ),
                ..Default::default()
            },
        )
        .unwrap_err();
    assert_eq!(err.code(), "VALIDATION_ERROR");
    let tall = Sheet::empty(1, MAX_ROWS + 1).serialize();
    let err = s
        .update_note(
            &sheet.id,
            UpdateNotePatch {
                surface_data: Some(tall),
                ..Default::default()
            },
        )
        .unwrap_err();
    assert_eq!(err.code(), "VALIDATION_ERROR");
    let still = s.get_note(&sheet.id, false).unwrap();
    assert_eq!(still.updated_at, sheet.updated_at);
    assert_eq!(still.surface_data, sheet.surface_data);
}

#[test]
fn a_sheet_never_becomes_another_kind() {
    let mut s = store();
    let sheet = new_sheet(&mut s);
    for kind in [CONTENT_KIND_DOCUMENT, CONTENT_KIND_WHITEBOARD] {
        let err = s
            .update_note(
                &sheet.id,
                UpdateNotePatch {
                    content_kind: Some(kind.into()),
                    ..Default::default()
                },
            )
            .unwrap_err();
        assert_eq!(err.code(), "VALIDATION_ERROR");
    }
}

#[test]
fn list_rows_leave_the_grid_out_and_opening_brings_it() {
    let mut s = store();
    let sheet = new_sheet(&mut s);
    save_grid(&mut s, &sheet.id, GRID);
    let rows = s.list_notes(NoteFilter::default()).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].content_kind, CONTENT_KIND_SHEET);
    assert!(rows[0].surface_data.is_none());
    assert!(rows[0].body.starts_with("| What |"));
    assert_eq!(
        s.get_note(&sheet.id, false)
            .unwrap()
            .surface_data
            .as_deref(),
        Some(GRID)
    );
}

#[test]
fn a_sheet_with_the_version_check_conflicts_like_any_note() {
    let mut s = store();
    let sheet = new_sheet(&mut s);
    let saved = save_grid(&mut s, &sheet.id, GRID);
    let err = s
        .update_note(
            &sheet.id,
            UpdateNotePatch {
                surface_data: Some(GRID.into()),
                expected_updated_at: Some(sheet.updated_at.clone()),
                ..Default::default()
            },
        )
        .unwrap_err();
    assert_eq!(err.code(), "CONFLICT");
    s.update_note(
        &sheet.id,
        UpdateNotePatch {
            surface_data: Some(GRID.into()),
            expected_updated_at: Some(saved.updated_at),
            ..Default::default()
        },
    )
    .unwrap();
}

#[test]
fn a_capped_list_cuts_documents_and_leaves_sheets_whole() {
    let mut s = store();
    let doc = create(&mut s, &"caf\u{e9} \u{1f600} ".repeat(200));
    let sheet = new_sheet(&mut s);
    let rows: Vec<String> = (0..40)
        .map(|i| format!(r#"["row {i}","cell {i}"]"#))
        .collect();
    save_grid(
        &mut s,
        &sheet.id,
        &format!(
            r#"{{"v":1,"engine":"grid","data":{{"cols":[{{"w":1}},{{"w":1}}],"rows":[{}]}}}}"#,
            rows.join(",")
        ),
    );

    let full = s.list_notes(NoteFilter::default()).unwrap();
    let capped = s
        .list_notes(NoteFilter {
            body_chars: Some(300),
            ..Default::default()
        })
        .unwrap();
    let find = |notes: &[Note], id: &str| notes.iter().find(|n| n.id == id).unwrap().body.clone();

    assert_eq!(find(&capped, &doc.id).chars().count(), 300);
    assert!(find(&full, &doc.id).starts_with(&find(&capped, &doc.id)));
    assert_eq!(find(&capped, &sheet.id), find(&full, &sheet.id));
    assert!(find(&capped, &sheet.id).chars().count() > 300);

    let none = s
        .list_notes(NoteFilter {
            body_chars: Some(0),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(find(&none, &doc.id), "");
    assert_eq!(
        s.get_note(&doc.id, false).unwrap().body,
        find(&full, &doc.id)
    );
}
