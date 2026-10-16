use instantnotes_core::types::*;
use instantnotes_core::Store;

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

fn open(store: &mut Store, id: &str) {
    std::thread::sleep(std::time::Duration::from_millis(2));
    store.get_note(id, true).unwrap();
}

#[test]
fn recent_documents_are_the_last_opened_live_documents_newest_first() {
    let mut s = store();
    let older = create(&mut s, "Older");
    let pinned = create(&mut s, "Pinned");
    let newest = create(&mut s, "Newest");
    let _never = create(&mut s, "Never opened");
    let sheet = create(&mut s, "");
    let archived = create(&mut s, "Archived");
    let trashed = create(&mut s, "Trashed");
    s.update_note(
        &sheet.id,
        UpdateNotePatch {
            content_kind: Some(CONTENT_KIND_SHEET.into()),
            ..Default::default()
        },
    )
    .unwrap();
    for id in [
        &older.id,
        &pinned.id,
        &sheet.id,
        &archived.id,
        &trashed.id,
        &newest.id,
    ] {
        open(&mut s, id);
    }
    s.update_note(
        &pinned.id,
        UpdateNotePatch {
            is_pinned: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    s.update_note(
        &archived.id,
        UpdateNotePatch {
            is_archived: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    s.soft_delete_note(&trashed.id).unwrap();

    let recent = s.recent_documents(3).unwrap();
    let titles: Vec<_> = recent.iter().map(|n| n.title.as_str()).collect();
    assert_eq!(titles, ["Newest", "Pinned", "Older"]);
    assert_eq!(s.recent_documents(1).unwrap().len(), 1);
}

#[test]
fn append_paragraph_adds_a_paragraph_and_keeps_the_body() {
    let mut s = store();
    let n = create(&mut s, "Roadmap\nfirst line\n\n");
    let after = s
        .append_paragraph(&n.id, "  one more line #later ")
        .unwrap();
    assert_eq!(after.body, "Roadmap\nfirst line\n\none more line #later");
    assert_eq!(after.title, "Roadmap");
    assert_eq!(
        s.get_note(&n.id, false).unwrap().body,
        "Roadmap\nfirst line\n\none more line #later"
    );
}

#[test]
fn append_paragraph_fills_an_empty_note_and_refuses_blank_text() {
    let mut s = store();
    let n = create(&mut s, "   ");
    assert_eq!(s.append_paragraph(&n.id, "first").unwrap().body, "first");
    assert_eq!(
        s.append_paragraph(&n.id, " \n ").unwrap_err().code(),
        "VALIDATION_ERROR"
    );
}

#[test]
fn append_paragraph_refuses_a_sheet_and_a_trashed_note() {
    let mut s = store();
    let sheet = create(&mut s, "");
    s.update_note(
        &sheet.id,
        UpdateNotePatch {
            content_kind: Some(CONTENT_KIND_SHEET.into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        s.append_paragraph(&sheet.id, "x").unwrap_err().code(),
        "VALIDATION_ERROR"
    );
    let gone = create(&mut s, "Gone");
    s.soft_delete_note(&gone.id).unwrap();
    assert_eq!(
        s.append_paragraph(&gone.id, "x").unwrap_err().code(),
        "VALIDATION_ERROR"
    );
    assert_eq!(
        s.append_paragraph("nope", "x").unwrap_err().code(),
        "NOT_FOUND"
    );
}
