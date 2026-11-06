use instantnotes_core::types::*;
use instantnotes_core::Store;

fn store() -> Store {
    Store::open_in_memory().expect("open in-memory store")
}

fn create(s: &mut Store, body: &str) -> Note {
    s.create_note(CreateNoteInput {
        body: Some(body.to_string()),
        ..Default::default()
    })
    .unwrap()
}

#[test]
fn fold_notes_merges_prose_custom_titles_tags_spaces_archives_sources_and_undoes() {
    let mut s = store();
    let target = create(&mut s, " Lantern design\nBrass chimney ventilation sketch");
    let auto_src = create(&mut s, "Wick trimming angle reduces soot #craft");
    let custom_src = s
        .create_note(CreateNoteInput {
            title: Some("Field test in rain".into()),
            body: Some("Baffle held steady in 25 knot gusts".into()),
            tags: vec!["outdoor".into()],
        })
        .unwrap();

    let ws_workshop = s.get_or_create_workspace("Workshop").unwrap();
    let ws_camping = s.get_or_create_workspace("Camping").unwrap();
    s.add_note_to_workspace(&auto_src.id, &ws_workshop.id)
        .unwrap();
    s.add_note_to_workspace(&custom_src.id, &ws_camping.id)
        .unwrap();

    let outcome = s
        .fold_notes(&target.id, &[auto_src.id.clone(), custom_src.id.clone()])
        .unwrap();

    assert_eq!(
        outcome.folded_ids,
        vec![auto_src.id.clone(), custom_src.id.clone()]
    );
    assert!(outcome
        .note
        .body
        .contains("Brass chimney ventilation sketch"));
    assert!(outcome
        .note
        .body
        .contains("Wick trimming angle reduces soot #craft"));
    assert!(
        outcome
            .note
            .body
            .contains("## Field test in rain\n\nBaffle held steady in 25 knot gusts"),
        "custom non-auto title should be preserved as a section heading: {}",
        outcome.note.body
    );

    let tag_names: Vec<String> = s
        .tags_for_note(&target.id)
        .unwrap()
        .into_iter()
        .map(|t| t.name)
        .collect();
    assert!(tag_names.contains(&"craft".to_string()));
    assert!(tag_names.contains(&"outdoor".to_string()));

    let ws_names: Vec<String> = s
        .workspaces_for_note(&target.id)
        .unwrap()
        .into_iter()
        .map(|w| w.name)
        .collect();
    assert!(ws_names.contains(&"Workshop".to_string()));
    assert!(ws_names.contains(&"Camping".to_string()));

    let src1 = s.get_note(&auto_src.id, false).unwrap();
    let src2 = s.get_note(&custom_src.id, false).unwrap();
    assert!(src1.is_archived && !src1.is_deleted);
    assert!(src2.is_archived && !src2.is_deleted);

    let restored = s.undo_fold(&outcome.before).unwrap();
    assert_eq!(restored.body, target.body);
    assert!(!s.get_note(&auto_src.id, false).unwrap().is_archived);
    assert!(!s.get_note(&custom_src.id, false).unwrap().is_archived);
    assert!(s.workspaces_for_note(&target.id).unwrap().is_empty());
}

#[test]
fn fold_notes_refuses_trashed_or_surface_notes() {
    let mut s = store();
    let doc = create(&mut s, "Plain note");
    let trashed = create(&mut s, "Trashed fragment");
    s.soft_delete_note(&trashed.id).unwrap();
    assert!(s.fold_notes(&doc.id, &[trashed.id]).is_err());

    let board = create(&mut s, "Board");
    s.update_note(
        &board.id,
        UpdateNotePatch {
            content_kind: Some("whiteboard".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(s
        .fold_notes(&board.id, std::slice::from_ref(&doc.id))
        .is_err());
    assert!(s.fold_notes(&doc.id, &[board.id]).is_err());
}
