use instantnotes_core::store::RELATED_SUGGEST_SETTING;
use instantnotes_core::types::*;
use instantnotes_core::Store;
use serde_json::json;

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

fn ids(list: &[RelatedNote]) -> Vec<&str> {
    list.iter().map(|r| r.note_id.as_str()).collect()
}

#[test]
fn related_notes_follow_the_paragraph_under_the_cursor() {
    let mut s = store();
    let orchard = create(
        &mut s,
        "Orchard notes\nGrafting heirloom cider apples onto dwarf rootstock in February #orchard",
    );
    let bakery = create(
        &mut s,
        "Sourdough log\nHydration schedule for rye levain fermentation at room temperature #baking",
    );
    let unrelated = create(&mut s, "Tax receipts\nQuarterly VAT filing spreadsheet");

    let active = create(
        &mut s,
        "Weekend plans\n\nCheck dwarf rootstock scions before grafting cider trees.\n\nRefresh the rye levain starter before fermentation peaks.",
    );

    let orchard_focus = s
        .related_notes(
            &active.id,
            Some("Check dwarf rootstock scions before grafting cider trees."),
            3,
        )
        .unwrap();
    assert!(!orchard_focus.is_empty());
    assert_eq!(orchard_focus[0].note_id, orchard.id);
    assert!(orchard_focus[0].excerpt.contains("rootstock"));
    assert!(
        !ids(&orchard_focus).contains(&unrelated.id.as_str()),
        "unrelated note should not surface"
    );

    let baking_focus = s
        .related_notes(
            &active.id,
            Some("Refresh the rye levain starter before fermentation peaks."),
            3,
        )
        .unwrap();
    assert!(!baking_focus.is_empty());
    assert_eq!(baking_focus[0].note_id, bakery.id);
}

#[test]
fn the_setting_and_symmetric_dismissals_gate_results() {
    let mut s = store();
    let a = create(
        &mut s,
        " Bioluminescent dinoflagellate culture medium salinity notes #marine",
    );
    let b = create(
        &mut s,
        "Checking dinoflagellate salinity for bioluminescent culture jars #marine",
    );

    assert_eq!(s.related_notes(&a.id, None, 3).unwrap().len(), 1);

    s.set_setting(
        RELATED_SUGGEST_SETTING,
        json!({ "enabled": false, "showAt": 0.5 }),
    )
    .unwrap();
    assert!(s.related_notes(&a.id, None, 3).unwrap().is_empty());
    assert_eq!(s.find_related_notes(&a.id, None, 3).unwrap().len(), 1);

    s.set_setting(
        RELATED_SUGGEST_SETTING,
        json!({ "enabled": true, "showAt": 0.5 }),
    )
    .unwrap();

    s.dismiss_related_note(&a.id, &b.id).unwrap();
    assert!(s.related_notes(&a.id, None, 3).unwrap().is_empty());
    assert!(s.related_notes(&b.id, None, 3).unwrap().is_empty());
    assert!(s.related_pairs(10).unwrap().is_empty());

    s.restore_related_note(&b.id, &a.id).unwrap();
    assert_eq!(s.related_notes(&a.id, None, 3).unwrap().len(), 1);
    assert_eq!(s.related_pairs(10).unwrap().len(), 1);
}

#[test]
fn edits_archives_and_tags_reach_the_shared_corpus() {
    let mut s = store();
    let current = create(
        &mut s,
        "Beekeeping log\nVarroa mite count after oxalic treatment",
    );
    let fragment = create(
        &mut s,
        "Hive inspection\nQueen cells spotted near the brood frames",
    );
    let other = create(&mut s, "Ferry timetable\nWeekend crossings leave at nine");

    assert!(s.related_notes(&current.id, None, 3).unwrap().is_empty());

    s.update_note(
        &fragment.id,
        UpdateNotePatch {
            body: Some("Hive inspection\nVarroa mite count dropped after oxalic dribble".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        ids(&s.related_notes(&current.id, None, 3).unwrap()),
        vec![fragment.id.as_str()]
    );

    s.set_notes_flags(std::slice::from_ref(&fragment.id), None, Some(true))
        .unwrap();
    assert!(s.related_notes(&current.id, None, 3).unwrap().is_empty());

    s.add_tag_to_note(&other.id, "apiary").unwrap();
    s.add_tag_to_note(&current.id, "apiary").unwrap();
    s.update_note(
        &other.id,
        UpdateNotePatch {
            body: Some("Ferry timetable\nVarroa mite count on the island hives".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let related = s.related_notes(&current.id, None, 3).unwrap();
    assert_eq!(ids(&related), vec![other.id.as_str()]);
    assert!(related[0].reasons.contains(&"#apiary".to_string()));
}

#[test]
fn tag_and_space_suggestions_read_the_same_corpus() {
    let mut s = store();
    for body in [
        "Sourdough starter feeding schedule",
        "Sourdough crumb and oven spring",
        "Sourdough levain hydration",
    ] {
        let n = create(&mut s, body);
        s.add_tag_to_note(&n.id, "baking").unwrap();
    }
    for body in [
        "Quarterly invoices and receipts",
        "Invoices overdue from the printer",
        "Receipts scanned for the accountant",
    ] {
        let n = create(&mut s, body);
        s.add_tag_to_note(&n.id, "money").unwrap();
    }
    let open = create(&mut s, "Sourdough discard pancakes with levain");
    assert_eq!(
        s.tag_suggestion(&open.id).unwrap().map(|t| t.tag),
        Some("baking".into())
    );

    s.update_note(
        &open.id,
        UpdateNotePatch {
            body: Some("Receipts and invoices for the bakery accountant".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        s.tag_suggestion(&open.id).unwrap().map(|t| t.tag),
        Some("money".into())
    );
}
