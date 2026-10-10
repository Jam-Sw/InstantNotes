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

fn file(s: &mut Store, body: &str, space: &str) -> Note {
    let n = create(s, body);
    let ws = s.get_or_create_workspace(space).unwrap();
    s.add_note_to_workspace(&n.id, &ws.id).unwrap();
    n
}

fn library(s: &mut Store) {
    file(s, "Tomato ragu: simmer the sauce slowly #pasta", "Recipes");
    file(s, "Carbonara needs guanciale, not bacon #pasta", "Recipes");
    file(s, "Risotto: toast the rice, add stock slowly", "Recipes");
    file(s, "Sprint review notes: velocity dropped #work", "Work");
    file(
        s,
        "Quarterly roadmap draft for the platform team #work",
        "Work",
    );
    file(s, "Interview loop for the backend role", "Work");
}

#[test]
fn nothing_is_suggested_until_two_spaces_hold_notes() {
    let mut s = store();
    file(&mut s, "Tomato ragu #pasta", "Recipes");
    create(&mut s, "Another ragu #pasta");
    assert!(s.space_suggestions().unwrap().is_empty());
    s.get_or_create_workspace("Work").unwrap();
    assert!(s.space_suggestions().unwrap().is_empty());
}

#[test]
fn a_shared_tag_files_a_note_and_is_the_reason() {
    let mut s = store();
    library(&mut s);
    let n = create(&mut s, "Lasagne for Sunday #pasta");

    let out = s.space_suggestions().unwrap();

    assert_eq!(out.len(), 1);
    let got = &out[0];
    assert_eq!(got.note_id, n.id);
    assert_eq!(got.note_title, n.title);
    assert_eq!(got.space_name, "Recipes");
    assert!(
        got.probability >= 0.5 && got.probability <= 1.0,
        "{}",
        got.probability
    );
    assert_eq!(got.reasons[0].label, "#pasta");
    assert_eq!(got.reasons[0].kind, "tag");
}

#[test]
fn shared_words_file_a_note_and_are_the_reasons() {
    let mut s = store();
    library(&mut s);
    create(&mut s, "Let the sauce simmer, then toast the bread");

    let out = s.space_suggestions().unwrap();

    assert_eq!(out.len(), 1);
    assert_eq!(out[0].space_name, "Recipes");
    let labels: Vec<&str> = out[0].reasons.iter().map(|r| r.label.as_str()).collect();
    assert!(labels.contains(&"simmer"), "{labels:?}");
    assert!(labels.contains(&"sauce"), "{labels:?}");
    assert!(out[0].reasons.iter().all(|r| r.kind == "word"));
    assert!(out[0].reasons.len() <= 3);
}

#[test]
fn a_note_sharing_nothing_gets_no_suggestion() {
    let mut s = store();
    library(&mut s);
    create(&mut s, "Call the dentist");
    assert!(s.space_suggestions().unwrap().is_empty());
}

#[test]
fn a_tag_written_in_the_text_outweighs_one_added_later() {
    let mut s = store();
    file(&mut s, "first #alpha", "A");
    file(&mut s, "second #alpha", "A");
    file(&mut s, "third #beta", "B");
    file(&mut s, "fourth #beta", "B");
    let n = create(&mut s, "something #alpha");
    s.add_tag_to_note(&n.id, "beta").unwrap();

    let out = s.space_suggestions().unwrap();

    assert_eq!(out.len(), 1);
    assert_eq!(out[0].space_name, "A");
    assert_eq!(out[0].reasons[0].label, "#alpha");
}

#[test]
fn a_big_space_does_not_win_on_size_alone() {
    let mut s = store();
    for i in 0..10 {
        file(&mut s, &format!("alpha thought {i}"), "Big");
    }
    file(&mut s, "beta thought", "Small");
    create(&mut s, "a beta idea");

    let out = s.space_suggestions().unwrap();

    assert_eq!(out.len(), 1);
    assert_eq!(out[0].space_name, "Small");
}

#[test]
fn newest_notes_come_first_and_filed_notes_are_left_alone() {
    let mut s = store();
    library(&mut s);
    let older = create(&mut s, "Pesto with basil #pasta");
    let newer = create(&mut s, "Bolognese ragu #pasta");
    s.update_note(
        &newer.id,
        UpdateNotePatch {
            body: Some("Bolognese ragu, simmer long #pasta".into()),
            ..Default::default()
        },
    )
    .unwrap();

    let out = s.space_suggestions().unwrap();
    let ids: Vec<&str> = out.iter().map(|x| x.note_id.as_str()).collect();
    assert_eq!(ids, vec![newer.id.as_str(), older.id.as_str()]);

    let ws = s.find_workspace("Recipes").unwrap().unwrap();
    s.add_note_to_workspace(&newer.id, &ws.id).unwrap();
    let out = s.space_suggestions().unwrap();
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].note_id, older.id);
}

#[test]
fn trashed_and_archived_notes_neither_teach_nor_get_suggestions() {
    let mut s = store();
    library(&mut s);
    let trashed = create(&mut s, "Gnocchi #pasta");
    s.soft_delete_note(&trashed.id).unwrap();
    let archived = create(&mut s, "Orecchiette #pasta");
    s.update_note(
        &archived.id,
        UpdateNotePatch {
            is_archived: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    let stale = file(&mut s, "Old lunch order #pasta", "Work");
    s.update_note(
        &stale.id,
        UpdateNotePatch {
            is_archived: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    let live = create(&mut s, "Tagliatelle #pasta");

    let out = s.space_suggestions().unwrap();

    assert_eq!(out.len(), 1);
    assert_eq!(out[0].note_id, live.id);
    assert_eq!(out[0].space_name, "Recipes");
}

#[test]
fn a_dismissed_suggestion_stays_away() {
    let mut s = store();
    library(&mut s);
    let n = create(&mut s, "Lasagne for Sunday #pasta");
    let recipes = s.find_workspace("Recipes").unwrap().unwrap();

    s.dismiss_space_suggestion(&n.id, &recipes.id).unwrap();

    assert!(s.space_suggestions().unwrap().is_empty());
    let saved = s.get_setting("graph.dismissed").unwrap().unwrap();
    assert_eq!(saved[&n.id], serde_json::json!([recipes.id]));
    s.dismiss_space_suggestion(&n.id, &recipes.id).unwrap();
    let saved = s.get_setting("graph.dismissed").unwrap().unwrap();
    assert_eq!(saved[&n.id].as_array().unwrap().len(), 1);
}

#[test]
fn dismissing_needs_a_real_note_and_space() {
    let mut s = store();
    library(&mut s);
    let n = create(&mut s, "Lasagne #pasta");
    let recipes = s.find_workspace("Recipes").unwrap().unwrap();
    assert!(matches!(
        s.dismiss_space_suggestion("ghost", &recipes.id),
        Err(instantnotes_core::AppError::NotFound(_))
    ));
    assert!(matches!(
        s.dismiss_space_suggestion(&n.id, "ghost"),
        Err(instantnotes_core::AppError::NotFound(_))
    ));
}

#[test]
fn dismissals_of_destroyed_notes_are_dropped() {
    let mut s = store();
    library(&mut s);
    let gone = create(&mut s, "Lasagne #pasta");
    let kept = create(&mut s, "Pesto #pasta");
    let recipes = s.find_workspace("Recipes").unwrap().unwrap();
    s.dismiss_space_suggestion(&gone.id, &recipes.id).unwrap();
    s.permanently_delete_note(&gone.id, true).unwrap();

    s.dismiss_space_suggestion(&kept.id, &recipes.id).unwrap();

    let saved = s.get_setting("graph.dismissed").unwrap().unwrap();
    assert!(saved.get(&gone.id).is_none());
    assert!(saved.get(&kept.id).is_some());
}

#[test]
fn a_malformed_dismissal_record_dismisses_nothing() {
    let mut s = store();
    library(&mut s);
    create(&mut s, "Lasagne #pasta");
    s.set_setting("graph.dismissed", serde_json::json!("oops"))
        .unwrap();
    assert_eq!(s.space_suggestions().unwrap().len(), 1);
}

#[test]
fn restoring_a_dismissal_brings_the_suggestion_back() {
    let mut s = store();
    library(&mut s);
    let n = create(&mut s, "Lasagne for Sunday #pasta");
    let recipes = s.find_workspace("Recipes").unwrap().unwrap();
    s.dismiss_space_suggestion(&n.id, &recipes.id).unwrap();
    assert!(s.space_suggestions().unwrap().is_empty());

    s.restore_space_suggestion(&n.id, &recipes.id).unwrap();

    assert_eq!(s.space_suggestions().unwrap().len(), 1);
    assert!(s
        .get_setting("graph.dismissed")
        .unwrap()
        .unwrap()
        .as_object()
        .unwrap()
        .is_empty());
    s.restore_space_suggestion(&n.id, &recipes.id).unwrap();
}

#[test]
fn a_dismissal_survives_renames_and_goes_with_the_space() {
    let mut s = store();
    library(&mut s);
    let n = create(&mut s, "Lasagne for Sunday #pasta");
    let recipes = s.find_workspace("Recipes").unwrap().unwrap();
    s.dismiss_space_suggestion(&n.id, &recipes.id).unwrap();

    s.rename_workspace(&recipes.id, "Cooking").unwrap();
    s.update_note(
        &n.id,
        UpdateNotePatch {
            title: Some("Sunday lasagne".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(s.space_suggestions().unwrap().is_empty());

    s.delete_workspace(&recipes.id).unwrap();
    let saved = s.get_setting("graph.dismissed").unwrap().unwrap();
    assert!(saved.as_object().unwrap().is_empty(), "{saved}");
}

#[test]
fn a_note_gets_the_tag_its_words_share_with_tagged_notes() {
    let mut s = store();
    library(&mut s);
    let n = create(&mut s, "Let the sauce simmer slowly");

    let got = s.tag_suggestion(&n.id).unwrap().unwrap();
    assert_eq!(got.tag, "pasta");
    assert!(got.probability >= 0.5);
    assert!(
        got.reasons.contains(&"simmer".to_string()),
        "{:?}",
        got.reasons
    );
}

#[test]
fn tag_suggestions_follow_the_setting() {
    let mut s = store();
    library(&mut s);
    let n = create(&mut s, "Let the sauce simmer slowly");

    s.set_setting(
        "suggest.tags",
        serde_json::json!({ "enabled": false, "showAt": 0.5 }),
    )
    .unwrap();
    assert!(s.tag_suggestion(&n.id).unwrap().is_none());

    s.set_setting(
        "suggest.tags",
        serde_json::json!({ "enabled": true, "showAt": 0.5 }),
    )
    .unwrap();
    assert!(s.tag_suggestion(&n.id).unwrap().is_some());
}

#[test]
fn a_tag_the_note_already_has_is_never_suggested() {
    let mut s = store();
    library(&mut s);
    let n = create(&mut s, "Let the sauce simmer slowly #pasta");

    assert!(s
        .tag_suggestion(&n.id)
        .unwrap()
        .is_none_or(|got| got.tag != "pasta"));
    let other = create(&mut s, "Call the dentist");
    assert_eq!(s.tag_suggestion(&other.id).unwrap(), None);
}
