//! Integration tests against real SQLite (tempfile / in-memory).
//! Synthetic fixtures only, per TEST_PLAN.md §5.

use instantnotes_core::types::*;
use instantnotes_core::{AppError, Store};

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

// ---- create ----

#[test]
fn create_sets_defaults_per_data_model() {
    let mut s = store();
    let n = create(&mut s, "Buy milk and coffee");
    assert!(!n.id.is_empty());
    assert_eq!(n.title, "Buy milk and coffee");
    assert_eq!(n.version, 1);
    assert_eq!(n.sync_state, "local_only");
    assert!(!n.is_pinned && !n.is_archived && !n.is_deleted);
    assert!(!n.created_at.is_empty());
    assert_eq!(n.created_at, n.updated_at);
}

#[test]
fn create_with_explicit_title_keeps_it() {
    let mut s = store();
    let n = s
        .create_note(CreateNoteInput {
            title: Some("Groceries".into()),
            body: Some("Buy milk".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(n.title, "Groceries");
}

#[test]
fn create_extracts_inline_tags() {
    let mut s = store();
    let n = create(&mut s, "Idea: local-first app #idea #project-x");
    let tags = s.tags_for_note(&n.id).unwrap();
    let names: Vec<_> = tags.iter().map(|t| t.name.as_str()).collect();
    assert!(names.contains(&"idea"));
    assert!(names.contains(&"project-x"));
}

#[test]
fn create_attaches_explicit_tags_normalized() {
    let mut s = store();
    let n = s
        .create_note(CreateNoteInput {
            body: Some("travel checklist".into()),
            tags: vec!["  #Travel ".into()],
            ..Default::default()
        })
        .unwrap();
    let tags = s.tags_for_note(&n.id).unwrap();
    assert_eq!(tags.len(), 1);
    assert_eq!(tags[0].name, "travel");
}

// ---- get ----

#[test]
fn get_missing_note_is_not_found() {
    let mut s = store();
    let err = s.get_note("nope", false).unwrap_err();
    assert_eq!(err.code(), "NOT_FOUND");
}

#[test]
fn get_with_touch_sets_last_opened_at() {
    let mut s = store();
    let n = create(&mut s, "Recipe: tomato soup");
    assert!(n.last_opened_at.is_none());
    let opened = s.get_note(&n.id, true).unwrap();
    assert!(opened.last_opened_at.is_some());
}

// ---- update ----

#[test]
fn update_body_increments_version() {
    let mut s = store();
    let n = create(&mut s, "draft one");
    let u = s
        .update_note(
            &n.id,
            UpdateNotePatch {
                body: Some("draft two".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(u.version, 2);
    assert_eq!(u.body, "draft two");
}

#[test]
fn update_body_attaches_new_inline_tags() {
    let mut s = store();
    let n = create(&mut s, "plain note");
    s.update_note(
        &n.id,
        UpdateNotePatch {
            body: Some("now with #newtag".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let names: Vec<String> = s
        .tags_for_note(&n.id)
        .unwrap()
        .into_iter()
        .map(|t| t.name)
        .collect();
    assert!(names.contains(&"newtag".to_string()));
}

#[test]
fn auto_derived_title_follows_body_updates() {
    let mut s = store();
    let n = create(&mut s, "original wording here");
    assert_eq!(n.title, "original wording here");
    let u = s
        .update_note(
            &n.id,
            UpdateNotePatch {
                body: Some("completely replaced text".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(u.title, "completely replaced text");
}

#[test]
fn explicit_title_at_create_survives_body_updates() {
    let mut s = store();
    let n = s
        .create_note(CreateNoteInput {
            title: Some("Fixed Title".into()),
            body: Some("first draft".into()),
            ..Default::default()
        })
        .unwrap();
    let u = s
        .update_note(
            &n.id,
            UpdateNotePatch {
                body: Some("second draft".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(u.title, "Fixed Title");
}

#[test]
fn explicit_title_via_update_stops_rederive() {
    let mut s = store();
    let n = create(&mut s, "derived from body");
    s.update_note(
        &n.id,
        UpdateNotePatch {
            title: Some("Manual Title".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let u = s
        .update_note(
            &n.id,
            UpdateNotePatch {
                body: Some("totally new content".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(u.title, "Manual Title");
}

#[test]
fn update_pin_and_archive_flags() {
    let mut s = store();
    let n = create(&mut s, "pin me");
    let u = s
        .update_note(
            &n.id,
            UpdateNotePatch {
                is_pinned: Some(true),
                is_archived: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(u.is_pinned && u.is_archived);
}

#[test]
fn update_missing_note_is_not_found() {
    let mut s = store();
    let err = s
        .update_note("ghost", UpdateNotePatch::default())
        .unwrap_err();
    assert_eq!(err.code(), "NOT_FOUND");
}

// ---- delete / restore ----

#[test]
fn soft_delete_hides_from_default_list_and_restore_brings_back() {
    let mut s = store();
    let n = create(&mut s, "Meeting notes for project alpha");
    let d = s.soft_delete_note(&n.id).unwrap();
    assert!(d.is_deleted && d.deleted_at.is_some());

    let listed = s.list_notes(NoteFilter::default()).unwrap();
    assert!(listed.is_empty());

    let trash = s
        .list_notes(NoteFilter {
            is_deleted: Some(true),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(trash.len(), 1);

    let r = s.restore_note(&n.id).unwrap();
    assert!(!r.is_deleted && r.deleted_at.is_none());
    assert_eq!(s.list_notes(NoteFilter::default()).unwrap().len(), 1);
}

#[test]
fn permanent_delete_requires_confirmation() {
    let mut s = store();
    let n = create(&mut s, "ephemeral");
    let err = s.permanently_delete_note(&n.id, false).unwrap_err();
    assert_eq!(err.code(), "VALIDATION_ERROR");
    assert!(s.get_note(&n.id, false).is_ok());
}

#[test]
fn permanent_delete_removes_note_and_associations() {
    let mut s = store();
    let n = create(&mut s, "to be purged #gone");
    s.permanently_delete_note(&n.id, true).unwrap();
    assert_eq!(s.get_note(&n.id, false).unwrap_err().code(), "NOT_FOUND");
    // tag survives but unused
    let tags = s.list_tags().unwrap();
    let gone = tags.iter().find(|t| t.tag.name == "gone").unwrap();
    assert_eq!(gone.usage_count, 0);
    // and search no longer finds it
    assert!(s.search_notes("purged", 10).unwrap().is_empty());
}

// ---- list ----

#[test]
fn list_excludes_archived_by_default() {
    let mut s = store();
    let _a = create(&mut s, "active note");
    let b = create(&mut s, "archived note");
    s.update_note(
        &b.id,
        UpdateNotePatch {
            is_archived: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    let listed = s.list_notes(NoteFilter::default()).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].title, "active note");

    let archived = s
        .list_notes(NoteFilter {
            is_archived: Some(true),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(archived.len(), 1);
    assert_eq!(archived[0].title, "archived note");
}

#[test]
fn list_filters_by_pinned() {
    let mut s = store();
    let a = create(&mut s, "pinned one");
    let _b = create(&mut s, "not pinned");
    s.update_note(
        &a.id,
        UpdateNotePatch {
            is_pinned: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    let pinned = s
        .list_notes(NoteFilter {
            is_pinned: Some(true),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(pinned.len(), 1);
    assert_eq!(pinned[0].title, "pinned one");
}

#[test]
fn list_filters_by_tag() {
    let mut s = store();
    let _a = create(&mut s, "about rust #rust");
    let _b = create(&mut s, "about svelte #svelte");
    let rust_tag = s.get_or_create_tag("rust").unwrap();
    let filtered = s
        .list_notes(NoteFilter {
            tag_ids: vec![rust_tag.id],
            ..Default::default()
        })
        .unwrap();
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].title, "about rust rust");
}

#[test]
fn list_supports_limit_offset_and_title_sort() {
    let mut s = store();
    create(&mut s, "banana");
    create(&mut s, "apple");
    create(&mut s, "cherry");
    let page = s
        .list_notes(NoteFilter {
            sort_by: Some("title".into()),
            sort_order: Some("asc".into()),
            limit: Some(2),
            offset: Some(1),
            ..Default::default()
        })
        .unwrap();
    let titles: Vec<_> = page.iter().map(|n| n.title.as_str()).collect();
    assert_eq!(titles, vec!["banana", "cherry"]);
}

// ---- search ----

#[test]
fn search_finds_by_body_word() {
    let mut s = store();
    let n = create(&mut s, "Travel checklist\npassport tickets sunscreen");
    create(&mut s, "Recipe: tomato soup");
    let hits = s.search_notes("passport", 10).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].note_id, n.id);
    assert!(!hits[0].excerpt.is_empty());
}

#[test]
fn search_prefix_matches() {
    let mut s = store();
    create(&mut s, "brainstorming session notes");
    let hits = s.search_notes("brainst", 10).unwrap();
    assert_eq!(hits.len(), 1);
}

#[test]
fn search_excludes_deleted_notes() {
    let mut s = store();
    let n = create(&mut s, "secret travel plans");
    s.soft_delete_note(&n.id).unwrap();
    assert!(s.search_notes("travel", 10).unwrap().is_empty());
}

#[test]
fn search_reflects_updates() {
    let mut s = store();
    let n = create(&mut s, "original wording here");
    s.update_note(
        &n.id,
        UpdateNotePatch {
            body: Some("completely replaced text".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(s.search_notes("wording", 10).unwrap().is_empty());
    assert_eq!(s.search_notes("replaced", 10).unwrap().len(), 1);
}

#[test]
fn search_special_characters_do_not_error() {
    let mut s = store();
    create(&mut s, "plain note");
    for q in ["\"quoted\"", "a*b", "(paren", "tag:", "-minus", "  "] {
        let r = s.search_notes(q, 10);
        assert!(r.is_ok(), "query {:?} errored: {:?}", q, r.err());
    }
}

// ---- tags ----

#[test]
fn get_or_create_tag_is_idempotent_and_normalized() {
    let mut s = store();
    let a = s.get_or_create_tag("#Project Alpha").unwrap();
    let b = s.get_or_create_tag("project   alpha").unwrap();
    assert_eq!(a.id, b.id);
    assert_eq!(a.name, "project alpha");
}

#[test]
fn get_or_create_rejects_empty() {
    let mut s = store();
    assert_eq!(
        s.get_or_create_tag("##  ").unwrap_err().code(),
        "VALIDATION_ERROR"
    );
}

#[test]
fn list_tags_includes_usage_counts() {
    let mut s = store();
    create(&mut s, "one #shared");
    create(&mut s, "two #shared #solo");
    let tags = s.list_tags().unwrap();
    let shared = tags.iter().find(|t| t.tag.name == "shared").unwrap();
    let solo = tags.iter().find(|t| t.tag.name == "solo").unwrap();
    assert_eq!(shared.usage_count, 2);
    assert_eq!(solo.usage_count, 1);
}

#[test]
fn deleted_notes_do_not_count_toward_tag_usage() {
    let mut s = store();
    let n = create(&mut s, "tagged #temp");
    s.soft_delete_note(&n.id).unwrap();
    let tags = s.list_tags().unwrap();
    let temp = tags.iter().find(|t| t.tag.name == "temp").unwrap();
    assert_eq!(temp.usage_count, 0);
}

#[test]
fn rename_tag_normalizes_and_conflicts_error() {
    let mut s = store();
    let a = s.get_or_create_tag("alpha").unwrap();
    let _b = s.get_or_create_tag("beta").unwrap();
    let renamed = s.update_tag(&a.id, Some("#Gamma".into()), None).unwrap();
    assert_eq!(renamed.name, "gamma");
    let err = s.update_tag(&renamed.id, Some("beta".into()), None).unwrap_err();
    assert_eq!(err.code(), "CONFLICT");
}

#[test]
fn delete_tag_removes_associations_but_not_notes() {
    let mut s = store();
    let n = create(&mut s, "keep me #doomed");
    let tag = s.get_or_create_tag("doomed").unwrap();
    s.delete_tag(&tag.id).unwrap();
    assert!(s.get_note(&n.id, false).is_ok());
    assert!(s.tags_for_note(&n.id).unwrap().is_empty());
}

#[test]
fn add_and_remove_tag_on_note() {
    let mut s = store();
    let n = create(&mut s, "manual tagging");
    let t = s.add_tag_to_note(&n.id, "Manual Tag").unwrap();
    assert_eq!(t.name, "manual tag");
    assert_eq!(s.tags_for_note(&n.id).unwrap().len(), 1);
    s.remove_tag_from_note(&n.id, &t.id).unwrap();
    assert!(s.tags_for_note(&n.id).unwrap().is_empty());
}

// ---- settings ----

#[test]
fn settings_roundtrip_json() {
    let mut s = store();
    assert!(s.get_setting("appearance.theme").unwrap().is_none());
    s.set_setting("appearance.theme", serde_json::json!("dark"))
        .unwrap();
    assert_eq!(
        s.get_setting("appearance.theme").unwrap(),
        Some(serde_json::json!("dark"))
    );
    s.set_setting("appearance.theme", serde_json::json!("light"))
        .unwrap();
    assert_eq!(
        s.get_setting("appearance.theme").unwrap(),
        Some(serde_json::json!("light"))
    );
    s.delete_setting("appearance.theme").unwrap();
    assert!(s.get_setting("appearance.theme").unwrap().is_none());
}

// ---- persistence across reopen (restart simulation) ----

#[test]
fn notes_survive_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notes.db");
    let id = {
        let mut s = Store::open(&path).unwrap();
        create(&mut s, "Idea: build a local-first note app #idea").id
    };
    let mut s2 = Store::open(&path).unwrap();
    let n = s2.get_note(&id, false).unwrap();
    assert_eq!(n.title, "Idea: build a local-first note app idea");
    assert_eq!(s2.search_notes("local-first", 10).unwrap().len(), 1);
    let names: Vec<String> = s2
        .tags_for_note(&id)
        .unwrap()
        .into_iter()
        .map(|t| t.name)
        .collect();
    assert_eq!(names, vec!["idea".to_string()]);
}

// keep AppError import used even if individual asserts change
#[allow(dead_code)]
fn _uses(_: AppError) {}

// ---- workspaces ----

#[test]
fn get_or_create_workspace_is_idempotent_by_name() {
    let mut s = store();
    let a = s.get_or_create_workspace("  Project X  ").unwrap();
    let b = s.get_or_create_workspace("Project X").unwrap();
    assert_eq!(a.id, b.id);
    assert_eq!(a.name, "Project X");
}

#[test]
fn create_workspace_rejects_empty_name() {
    let mut s = store();
    let err = s.get_or_create_workspace("   ").unwrap_err();
    assert!(matches!(err, AppError::Validation(_)));
}

#[test]
fn list_workspaces_counts_exclude_deleted_notes() {
    let mut s = store();
    let ws = s.get_or_create_workspace("Inbox").unwrap();
    let n1 = create(&mut s, "first");
    let n2 = create(&mut s, "second");
    s.add_note_to_workspace(&n1.id, &ws.id).unwrap();
    s.add_note_to_workspace(&n2.id, &ws.id).unwrap();
    s.soft_delete_note(&n2.id).unwrap();
    let listed = s.list_workspaces().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].note_count, 1);
}

#[test]
fn rename_workspace_updates_name_and_rejects_clash() {
    let mut s = store();
    let a = s.get_or_create_workspace("Alpha").unwrap();
    let _b = s.get_or_create_workspace("Beta").unwrap();
    let renamed = s.rename_workspace(&a.id, "Gamma").unwrap();
    assert_eq!(renamed.name, "Gamma");
    let err = s.rename_workspace(&a.id, "Beta").unwrap_err();
    assert!(matches!(err, AppError::Conflict(_)));
    let err = s.rename_workspace("missing", "Any").unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)));
}

#[test]
fn delete_workspace_keeps_notes() {
    let mut s = store();
    let ws = s.get_or_create_workspace("Doomed").unwrap();
    let n = create(&mut s, "survivor");
    s.add_note_to_workspace(&n.id, &ws.id).unwrap();
    s.delete_workspace(&ws.id).unwrap();
    assert!(s.list_workspaces().unwrap().is_empty());
    assert_eq!(s.get_note(&n.id, false).unwrap().id, n.id);
    let err = s.delete_workspace(&ws.id).unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)));
}

#[test]
fn workspace_membership_roundtrip() {
    let mut s = store();
    let ws = s.get_or_create_workspace("Research").unwrap();
    let n = create(&mut s, "a note");
    s.add_note_to_workspace(&n.id, &ws.id).unwrap();
    // idempotent
    s.add_note_to_workspace(&n.id, &ws.id).unwrap();
    let memberships = s.workspaces_for_note(&n.id).unwrap();
    assert_eq!(memberships.len(), 1);
    assert_eq!(memberships[0].name, "Research");
    s.remove_note_from_workspace(&n.id, &ws.id).unwrap();
    assert!(s.workspaces_for_note(&n.id).unwrap().is_empty());
}

#[test]
fn add_note_to_missing_workspace_or_note_fails() {
    let mut s = store();
    let n = create(&mut s, "lonely");
    let err = s.add_note_to_workspace(&n.id, "missing-ws").unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)));
    let ws = s.get_or_create_workspace("Real").unwrap();
    let err = s.add_note_to_workspace("missing-note", &ws.id).unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)));
}

#[test]
fn list_notes_filters_by_workspace() {
    let mut s = store();
    let ws = s.get_or_create_workspace("Focus").unwrap();
    let inside = create(&mut s, "inside note");
    let _outside = create(&mut s, "outside note");
    s.add_note_to_workspace(&inside.id, &ws.id).unwrap();
    let filter = NoteFilter {
        workspace_id: Some(ws.id.clone()),
        ..Default::default()
    };
    let notes = s.list_notes(filter).unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].id, inside.id);
}

#[test]
fn pinned_notes_float_to_top_of_list() {
    let mut s = store();
    let older = create(&mut s, "older but pinned");
    let _newer = create(&mut s, "newer unpinned");
    s.update_note(
        &older.id,
        UpdateNotePatch {
            is_pinned: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    let notes = s.list_notes(NoteFilter::default()).unwrap();
    assert_eq!(notes[0].id, older.id, "pinned note should sort first");
}

#[test]
fn workspaces_survive_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notes.db");
    let (ws_id, note_id) = {
        let mut s = Store::open(&path).unwrap();
        let ws = s.get_or_create_workspace("Persistent").unwrap();
        let n = create(&mut s, "kept note");
        s.add_note_to_workspace(&n.id, &ws.id).unwrap();
        (ws.id, n.id)
    };
    let s2 = Store::open(&path).unwrap();
    let listed = s2.list_workspaces().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].workspace.id, ws_id);
    let members = s2.workspaces_for_note(&note_id).unwrap();
    assert_eq!(members.len(), 1);
}
