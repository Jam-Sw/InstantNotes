use instantnotes_core::store::MIGRATIONS;
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

#[test]
fn create_sets_defaults_per_data_model() {
    let mut s = store();
    let n = create(&mut s, "Buy milk and coffee");
    assert!(!n.id.is_empty());
    assert_eq!(n.title, "Buy milk and coffee");
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

#[test]
fn update_body_persists_new_body() {
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
fn removing_inline_token_detaches_tag_but_keeps_tag_row() {
    let mut s = store();
    let n = create(&mut s, "notes on #alpha and #beta");
    s.update_note(
        &n.id,
        UpdateNotePatch {
            body: Some("notes on #beta only".into()),
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
    assert_eq!(names, vec!["beta".to_string()]);
    let alpha = s
        .list_tags()
        .unwrap()
        .into_iter()
        .find(|t| t.tag.name == "alpha")
        .expect("alpha tag row should survive detachment");
    assert_eq!(alpha.usage_count, 0);

    s.update_note(
        &n.id,
        UpdateNotePatch {
            body: Some("no tags anymore".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(s.tags_for_note(&n.id).unwrap().is_empty());
}

#[test]
fn manually_added_tag_survives_body_edits() {
    let mut s = store();
    let n = create(&mut s, "plain body");
    s.add_tag_to_note(&n.id, "pinned").unwrap();
    s.update_note(
        &n.id,
        UpdateNotePatch {
            body: Some("edited body, still no tokens".into()),
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
    assert_eq!(names, vec!["pinned".to_string()]);
}

#[test]
fn explicit_add_promotes_inline_tag_past_token_removal() {
    let mut s = store();
    let n = create(&mut s, "working on #keeper today");
    s.add_tag_to_note(&n.id, "keeper").unwrap();
    s.update_note(
        &n.id,
        UpdateNotePatch {
            body: Some("token removed from body".into()),
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
    assert_eq!(names, vec!["keeper".to_string()]);
}

#[test]
fn empty_patch_does_not_bump_updated_at() {
    let mut s = store();
    let n = create(&mut s, "leave me alone");
    let u = s.update_note(&n.id, UpdateNotePatch::default()).unwrap();
    assert_eq!(u.updated_at, n.updated_at);
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
    let tags = s.list_tags().unwrap();
    let gone = tags.iter().find(|t| t.tag.name == "gone").unwrap();
    assert_eq!(gone.usage_count, 0);
    assert!(s.search_notes("purged", 10).unwrap().is_empty());
}

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

#[test]
fn list_breaks_sort_ties_by_id_so_paging_is_stable() {
    let mut s = store();
    let mut ids: Vec<String> = (0..20)
        .map(|i| create(&mut s, &format!("note {i}")).id)
        .collect();
    s.set_notes_flags(&ids, Some(false), None).unwrap();
    ids.sort();

    let all = s.list_notes(NoteFilter::default()).unwrap();
    let listed: Vec<String> = all.into_iter().map(|n| n.id).collect();
    assert_eq!(listed, ids, "tied rows are not ordered by id");

    let mut paged = Vec::new();
    for offset in (0..20).step_by(2) {
        let page = s
            .list_notes(NoteFilter {
                limit: Some(2),
                offset: Some(offset),
                ..Default::default()
            })
            .unwrap();
        paged.extend(page.into_iter().map(|n| n.id));
    }
    assert_eq!(paged, ids);
}

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

#[test]
fn search_excerpt_brackets_the_matched_term_with_sentinels() {
    let mut s = store();
    create(&mut s, "Travel checklist\npassport tickets sunscreen");
    let hits = s.search_notes("passport", 10).unwrap();
    assert_eq!(hits.len(), 1);
    let excerpt = &hits[0].excerpt;
    let start = excerpt
        .find('\u{1}')
        .unwrap_or_else(|| panic!("missing start sentinel in {excerpt:?}"));
    let end = excerpt
        .find('\u{2}')
        .unwrap_or_else(|| panic!("missing end sentinel in {excerpt:?}"));
    assert!(
        start < end,
        "start sentinel should precede end: {excerpt:?}"
    );
    let hit_text = &excerpt[start + '\u{1}'.len_utf8()..end];
    assert_eq!(hit_text.to_lowercase(), "passport");
}

#[test]
fn search_excerpt_marks_every_term_in_a_multi_word_query() {
    let mut s = store();
    create(
        &mut s,
        "Travel checklist\npassport tickets sunscreen and a boarding pass",
    );
    let hits = s.search_notes("passport tickets", 10).unwrap();
    assert_eq!(hits.len(), 1);
    let excerpt = &hits[0].excerpt;
    assert_eq!(
        excerpt.matches('\u{1}').count(),
        2,
        "expected both query terms marked: {excerpt:?}"
    );
    assert_eq!(excerpt.matches('\u{2}').count(), 2);
}

#[test]
fn search_excerpt_sentinels_are_always_balanced() {
    let mut s = store();
    create(
        &mut s,
        "brainstorming session notes: more brainstorming, then a brainstorming recap",
    );
    let hits = s.search_notes("brainstorming", 10).unwrap();
    assert_eq!(hits.len(), 1);
    let excerpt = &hits[0].excerpt;
    let starts = excerpt.matches('\u{1}').count();
    let ends = excerpt.matches('\u{2}').count();
    assert!(starts > 0, "expected at least one match: {excerpt:?}");
    assert_eq!(starts, ends, "sentinels should be balanced: {excerpt:?}");
}

#[test]
fn search_title_matches_are_bracketed_with_sentinels() {
    let mut s = store();
    create(&mut s, "Travel checklist\npassport tickets sunscreen");
    let hits = s.search_notes("travel", 10).unwrap();
    assert_eq!(hits.len(), 1);
    let title = &hits[0].title;
    let start = title
        .find('\u{1}')
        .unwrap_or_else(|| panic!("missing start sentinel in {title:?}"));
    let end = title
        .find('\u{2}')
        .unwrap_or_else(|| panic!("missing end sentinel in {title:?}"));
    assert!(start < end, "start sentinel should precede end: {title:?}");
    let hit_text = &title[start + '\u{1}'.len_utf8()..end];
    assert_eq!(hit_text.to_lowercase(), "travel");
}

#[test]
fn search_title_without_a_match_carries_no_sentinels() {
    let mut s = store();
    create(&mut s, "Travel checklist\npassport tickets sunscreen");
    let hits = s.search_notes("passport", 10).unwrap();
    assert_eq!(hits.len(), 1);
    assert!(
        !hits[0].title.contains('\u{1}') && !hits[0].title.contains('\u{2}'),
        "unmatched title should be marker-free: {:?}",
        hits[0].title
    );
    assert_eq!(hits[0].title, "Travel checklist");
}

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
    let err = s
        .update_tag(&renamed.id, Some("beta".into()), None)
        .unwrap_err();
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

#[test]
fn migrate_refuses_user_version_above_known_migrations() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("future.db");
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.pragma_update(None, "user_version", (MIGRATIONS.len() + 1) as i64)
            .unwrap();
    }
    let err = match Store::open(&path) {
        Ok(_) => panic!("open should refuse a future schema version"),
        Err(e) => e,
    };
    assert_eq!(err.code(), "MIGRATION_ERROR");
    assert!(err.is_schema_too_new());
}

#[test]
fn open_or_recover_does_not_treat_a_future_schema_as_corruption() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("future.db");
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.pragma_update(None, "user_version", (MIGRATIONS.len() + 1) as i64)
            .unwrap();
    }
    let err = match Store::open_or_recover(&path) {
        Ok(_) => panic!("open_or_recover should refuse a future schema version, not recover it"),
        Err(e) => e,
    };
    assert!(err.is_schema_too_new());
    assert!(path.exists());
    let mut moved_aside = path.as_os_str().to_os_string();
    moved_aside.push(".corrupt-1");
    assert!(!std::path::Path::new(&moved_aside).exists());
}

#[test]
fn open_migrates_v1_schema_and_leaves_backup() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("legacy.db");
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch(MIGRATIONS[0]).unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
    }
    let mut s = Store::open(&path).unwrap();
    s.get_or_create_workspace("Migrated").unwrap();
    assert_eq!(s.list_workspaces().unwrap().len(), 1);
    let backup = dir.path().join("legacy.db.backup-v1");
    assert!(
        backup.exists(),
        "expected pre-migration backup at {backup:?}"
    );
}

#[test]
fn open_or_recover_sets_corrupt_file_aside_and_starts_fresh() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("garbage.db");
    std::fs::write(&path, b"\x7f not a sqlite database \x00\x01\x02garbage").unwrap();
    assert!(
        Store::open(&path).is_err(),
        "garbage must not open normally"
    );

    let (mut s, recovered) = Store::open_or_recover(&path).unwrap();
    assert!(recovered);
    let n = create(&mut s, "fresh start");
    assert_eq!(s.get_note(&n.id, false).unwrap().id, n.id);
    assert!(dir.path().join("garbage.db.corrupt-1").exists());
}

#[allow(dead_code)]
fn _uses(_: AppError) {}

#[test]
fn create_note_stays_fast_enough_for_capture() {
    let mut s = store();
    for i in 0..200 {
        create(&mut s, &format!("warmup note {i} #tag{}", i % 7));
    }
    let start = std::time::Instant::now();
    create(&mut s, "capture perf probe #loop");
    let elapsed = start.elapsed();
    assert!(
        elapsed < std::time::Duration::from_millis(250),
        "single capture write took {elapsed:?}"
    );
}

#[test]
fn never_opened_filter_releases_notes_once_touched() {
    let mut s = store();
    let seen = create(&mut s, "capture that got read");
    let unseen = create(&mut s, "capture still waiting");
    s.get_note(&seen.id, true).unwrap();

    let filter = NoteFilter {
        never_opened: Some(true),
        ..Default::default()
    };
    let loops = s.list_notes(filter).unwrap();
    let ids: Vec<_> = loops.iter().map(|n| n.id.as_str()).collect();
    assert_eq!(ids, vec![unseen.id.as_str()]);

    s.get_note(&unseen.id, false).unwrap();
    let filter = NoteFilter {
        never_opened: Some(true),
        ..Default::default()
    };
    assert_eq!(s.list_notes(filter).unwrap().len(), 1);
}

#[test]
fn created_before_filter_is_a_strict_cutoff() {
    let mut s = store();
    let n = create(&mut s, "old enough");
    let far_future = "2099-01-01T00:00:00Z".to_string();
    let far_past = "2000-01-01T00:00:00Z".to_string();

    let hits = s
        .list_notes(NoteFilter {
            created_before: Some(far_future),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, n.id);

    let hits = s
        .list_notes(NoteFilter {
            created_before: Some(far_past),
            ..Default::default()
        })
        .unwrap();
    assert!(hits.is_empty());
}

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
fn delete_workspace_returns_every_member_id_for_undo() {
    let mut s = store();
    let ws = s.get_or_create_workspace("Disbanded").unwrap();
    let live = create(&mut s, "live member");
    let archived = create(&mut s, "archived member");
    let trashed = create(&mut s, "trashed member");
    for n in [&live, &archived, &trashed] {
        s.add_note_to_workspace(&n.id, &ws.id).unwrap();
    }
    s.update_note(
        &archived.id,
        UpdateNotePatch {
            is_archived: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    s.soft_delete_note(&trashed.id).unwrap();

    let mut member_ids = s.delete_workspace(&ws.id).unwrap();
    member_ids.sort();
    let mut expected = vec![live.id.clone(), archived.id.clone(), trashed.id.clone()];
    expected.sort();
    assert_eq!(member_ids, expected);

    let again = s.get_or_create_workspace("Disbanded").unwrap();
    for id in &member_ids {
        s.add_note_to_workspace(id, &again.id).unwrap();
    }
    assert_eq!(s.workspaces_for_note(&trashed.id).unwrap().len(), 1);
    assert_eq!(s.workspaces_for_note(&archived.id).unwrap().len(), 1);
}

#[test]
fn list_workspace_tags_scopes_counts_to_visible_members() {
    let mut s = store();
    let ws = s.get_or_create_workspace("To do").unwrap();
    let school = create(&mut s, "essay draft #school");
    let car = create(&mut s, "oil change #car");
    let gone = create(&mut s, "old chore #car");
    let _outside = create(&mut s, "unrelated #school");
    for n in [&school, &car, &gone] {
        s.add_note_to_workspace(&n.id, &ws.id).unwrap();
    }
    s.soft_delete_note(&gone.id).unwrap();

    let tags = s.list_workspace_tags(&ws.id).unwrap();
    let summary: Vec<(&str, i64)> = tags
        .iter()
        .map(|t| (t.tag.name.as_str(), t.usage_count))
        .collect();
    assert_eq!(summary, vec![("car", 1), ("school", 1)]);

    s.update_note(
        &car.id,
        UpdateNotePatch {
            is_archived: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    let tags = s.list_workspace_tags(&ws.id).unwrap();
    assert_eq!(tags.len(), 1);
    assert_eq!(tags[0].tag.name, "school");

    let err = s.list_workspace_tags("missing-ws").unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)));
}

#[test]
fn workspace_membership_roundtrip() {
    let mut s = store();
    let ws = s.get_or_create_workspace("Research").unwrap();
    let n = create(&mut s, "a note");
    s.add_note_to_workspace(&n.id, &ws.id).unwrap();
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

#[test]
fn bulk_soft_delete_then_restore_roundtrip() {
    let mut s = store();
    let a = create(&mut s, "a");
    let b = create(&mut s, "b");
    let ids = vec![a.id.clone(), b.id.clone()];
    s.soft_delete_notes(&ids).unwrap();
    assert!(s.get_note(&a.id, false).unwrap().is_deleted);
    assert!(s.get_note(&b.id, false).unwrap().is_deleted);
    s.restore_notes(&ids).unwrap();
    assert!(!s.get_note(&a.id, false).unwrap().is_deleted);
    assert!(!s.get_note(&b.id, false).unwrap().is_deleted);
}

#[test]
fn bulk_set_flags_updates_all() {
    let mut s = store();
    let a = create(&mut s, "a");
    let b = create(&mut s, "b");
    let ids = vec![a.id.clone(), b.id.clone()];
    s.set_notes_flags(&ids, Some(true), None).unwrap();
    assert!(s.get_note(&a.id, false).unwrap().is_pinned);
    assert!(s.get_note(&b.id, false).unwrap().is_pinned);
    assert!(!s.get_note(&a.id, false).unwrap().is_archived);
}

#[test]
fn bulk_destroy_requires_confirm() {
    let mut s = store();
    let a = create(&mut s, "a");
    let ids = vec![a.id.clone()];
    assert!(s.destroy_notes(&ids, false).is_err());
    assert!(s.get_note(&a.id, false).is_ok());
    s.destroy_notes(&ids, true).unwrap();
    assert!(s.get_note(&a.id, false).is_err());
}

#[test]
fn title_is_auto_true_for_a_derived_title() {
    let mut s = store();
    let n = create(&mut s, "Buy milk and coffee");
    assert!(s.title_is_auto(&n.id).unwrap());
}

#[test]
fn title_is_auto_false_once_a_title_is_set_explicitly() {
    let mut s = store();
    let n = s
        .create_note(CreateNoteInput {
            title: Some("Groceries".into()),
            body: Some("Buy milk".into()),
            ..Default::default()
        })
        .unwrap();
    assert!(!s.title_is_auto(&n.id).unwrap());
}

#[test]
fn title_is_auto_flips_false_after_an_explicit_title_update() {
    let mut s = store();
    let n = create(&mut s, "Buy milk");
    assert!(s.title_is_auto(&n.id).unwrap());
    s.update_note(
        &n.id,
        UpdateNotePatch {
            title: Some("Renamed".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(!s.title_is_auto(&n.id).unwrap());
}

#[test]
fn title_is_auto_missing_note_is_not_found() {
    let s = store();
    assert!(matches!(
        s.title_is_auto("missing"),
        Err(AppError::NotFound(_))
    ));
}

mod vault_export {
    use super::*;
    use instantnotes_core::vault::{collect_from_store, export_vault, parse_note, VaultNote};
    use std::collections::HashSet;
    use std::fs;

    fn read_all_md(dir: &std::path::Path) -> Vec<String> {
        let mut out = Vec::new();
        for entry in fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            if path.is_dir() {
                out.extend(read_all_md(&path));
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) == Some("md") {
                out.push(fs::read_to_string(&path).unwrap());
            }
        }
        out
    }

    #[test]
    fn round_trips_a_real_library_through_export() {
        let mut s = store();

        let explicit = s
            .create_note(CreateNoteInput {
                title: Some("Groceries".into()),
                body: Some("Buy milk and #errands".into()),
                ..Default::default()
            })
            .unwrap();
        let engineering = s.get_or_create_workspace("Engineering").unwrap();
        s.add_note_to_workspace(&explicit.id, &engineering.id)
            .unwrap();

        let derived = create(&mut s, "Buy eggs\nand bacon");
        s.update_note(
            &derived.id,
            UpdateNotePatch {
                is_pinned: Some(true),
                ..Default::default()
            },
        )
        .unwrap();

        let archived = create(&mut s, "Archived thought");
        s.update_note(
            &archived.id,
            UpdateNotePatch {
                is_archived: Some(true),
                ..Default::default()
            },
        )
        .unwrap();

        let trashed = create(&mut s, "Old draft");
        s.soft_delete_note(&trashed.id).unwrap();

        let (notes, manifest) = collect_from_store(&s).unwrap();
        assert_eq!(notes.len(), 4);
        let explicit_collected = notes.iter().find(|n| n.id == explicit.id).unwrap();
        assert_eq!(explicit_collected.tags, vec!["errands".to_string()]);
        assert_eq!(explicit_collected.spaces, vec!["Engineering".to_string()]);

        let dir = tempfile::tempdir().unwrap();
        export_vault(&notes, &manifest, dir.path()).unwrap();

        let texts = read_all_md(dir.path());
        assert_eq!(texts.len(), 4);

        let collected_by_id: std::collections::HashMap<String, VaultNote> =
            notes.into_iter().map(|n| (n.id.clone(), n)).collect();
        let mut seen_ids: HashSet<String> = HashSet::new();
        for text in &texts {
            let parsed = parse_note(text).unwrap();
            let expected = collected_by_id.get(&parsed.id).unwrap_or_else(|| {
                panic!(
                    "exported a file for an id not in collect_from_store's output: {}",
                    parsed.id
                )
            });
            assert_eq!(&parsed, expected, "field mismatch for note {}", parsed.id);
            seen_ids.insert(parsed.id);
        }
        assert_eq!(
            seen_ids,
            HashSet::from([
                explicit.id.clone(),
                derived.id.clone(),
                archived.id.clone(),
                trashed.id.clone(),
            ])
        );

        assert!(manifest.spaces.iter().any(|sp| sp.name == "Engineering"));
    }

    #[test]
    fn collects_more_notes_than_a_single_list_notes_page() {
        let mut s = store();
        for i in 0..520 {
            create(&mut s, &format!("note {i}"));
        }
        let (notes, _manifest) = collect_from_store(&s).unwrap();
        assert_eq!(notes.len(), 520);
    }
}
