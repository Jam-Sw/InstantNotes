//! The library graph (SEQUENCE.md unit 13): notes, tags, and Spaces, and the
//! links between them, derived from the existing tables on every read.
//! Nothing about the graph is stored.

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

fn links(g: &LibraryGraph) -> Vec<(String, String, String)> {
    let mut out: Vec<_> = g
        .links
        .iter()
        .map(|l| (l.note_id.clone(), l.target_id.clone(), l.kind.clone()))
        .collect();
    out.sort();
    out
}

#[test]
fn notes_link_to_their_tags_and_spaces() {
    let mut s = store();
    let a = create(&mut s, "alpha #ideas");
    let b = create(&mut s, "beta #ideas #later");
    let ws = s.get_or_create_workspace("Research").unwrap();
    s.add_note_to_workspace(&a.id, &ws.id).unwrap();

    let g = s.library_graph().unwrap();

    let tag = |name: &str| g.tags.iter().find(|t| t.name == name).unwrap().id.clone();
    let mut expected = vec![
        (a.id.clone(), tag("ideas"), "tag".to_string()),
        (b.id.clone(), tag("ideas"), "tag".to_string()),
        (b.id.clone(), tag("later"), "tag".to_string()),
        (a.id.clone(), ws.id.clone(), "space".to_string()),
    ];
    expected.sort();
    assert_eq!(links(&g), expected);
    assert_eq!(g.spaces.len(), 1);
    assert_eq!(g.spaces[0].name, "Research");
}

#[test]
fn trashed_and_archived_notes_are_left_out_with_their_links() {
    let mut s = store();
    let live = create(&mut s, "live #kept");
    let trashed = create(&mut s, "trashed #kept");
    s.soft_delete_note(&trashed.id).unwrap();
    let archived = create(&mut s, "archived #kept");
    s.update_note(
        &archived.id,
        UpdateNotePatch {
            is_archived: Some(true),
            ..Default::default()
        },
    )
    .unwrap();

    let g = s.library_graph().unwrap();

    assert_eq!(
        g.notes.iter().map(|n| n.id.clone()).collect::<Vec<_>>(),
        vec![live.id.clone()]
    );
    assert!(g.links.iter().all(|l| l.note_id == live.id));
}

#[test]
fn a_note_with_no_tags_or_spaces_is_listed_without_links() {
    let mut s = store();
    let n = create(&mut s, "loose thought");
    let g = s.library_graph().unwrap();
    assert_eq!(g.notes.len(), 1);
    assert_eq!(g.notes[0].id, n.id);
    assert_eq!(g.notes[0].title, "loose thought");
    assert!(g.links.is_empty());
}

#[test]
fn nodes_carry_what_the_graph_draws() {
    let mut s = store();
    let n = create(&mut s, "board #plans");
    s.update_note(
        &n.id,
        UpdateNotePatch {
            is_pinned: Some(true),
            content_kind: Some(CONTENT_KIND_WHITEBOARD.into()),
            surface_data: Some("{}".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let tag = s.tags_for_note(&n.id).unwrap().remove(0);
    s.update_tag(&tag.id, None, Some("#ff8800".into())).unwrap();

    let g = s.library_graph().unwrap();

    assert!(g.notes[0].is_pinned);
    assert_eq!(g.notes[0].content_kind, CONTENT_KIND_WHITEBOARD);
    assert_eq!(g.tags[0].color.as_deref(), Some("#ff8800"));
}

#[test]
fn a_tag_link_says_whether_it_was_written_or_added() {
    let mut s = store();
    let n = create(&mut s, "written #inline");
    s.add_tag_to_note(&n.id, "added").unwrap();
    let ws = s.get_or_create_workspace("Research").unwrap();
    s.add_note_to_workspace(&n.id, &ws.id).unwrap();

    let g = s.library_graph().unwrap();

    let source = |kind: &str, target: &str| {
        g.links
            .iter()
            .find(|l| l.kind == kind && l.target_id == target)
            .unwrap()
            .source
            .clone()
    };
    let tag = |name: &str| g.tags.iter().find(|t| t.name == name).unwrap().id.clone();
    assert_eq!(source("tag", &tag("inline")).as_deref(), Some("inline"));
    assert_eq!(source("tag", &tag("added")).as_deref(), Some("manual"));
    assert_eq!(source("space", &ws.id), None);
}
