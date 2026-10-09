use instantnotes_core::types::*;
use instantnotes_core::vault::{
    collect_from_store, export_vault, parse_manifest, parse_note, VaultNote,
};
use instantnotes_core::Store;
use std::fs;
use std::path::Path;
use tempfile::TempDir;

fn mirrored() -> (Store, TempDir) {
    let mut s = Store::open_in_memory().expect("open in-memory store");
    let dir = tempfile::tempdir().unwrap();
    s.configure_vault(Some(dir.path())).unwrap();
    (s, dir)
}

fn flush(s: &mut Store) {
    let out = s.flush_vault(10_000).expect("flush");
    assert!(out.errors.is_empty(), "flush errors: {:?}", out.errors);
    assert_eq!(out.remaining, 0);
}

fn create(s: &mut Store, body: &str) -> Note {
    s.create_note(CreateNoteInput {
        body: Some(body.to_string()),
        ..Default::default()
    })
    .unwrap()
}

fn create_titled(s: &mut Store, title: &str, body: &str) -> Note {
    s.create_note(CreateNoteInput {
        title: Some(title.to_string()),
        body: Some(body.to_string()),
        ..Default::default()
    })
    .unwrap()
}

fn retitle(s: &mut Store, id: &str, title: &str) {
    s.update_note(
        id,
        UpdateNotePatch {
            title: Some(title.to_string()),
            ..Default::default()
        },
    )
    .unwrap();
}

fn md_files(dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".md") && !n.starts_with('.'))
        .collect();
    names.sort();
    names
}

fn read_note(path: &Path) -> VaultNote {
    parse_note(&fs::read_to_string(path).unwrap()).unwrap()
}

fn pending(s: &Store) -> i64 {
    s.vault_status().unwrap().pending
}

#[test]
fn flush_writes_a_created_note_that_parses_back_to_the_note() {
    let (mut s, dir) = mirrored();
    let n = create_titled(&mut s, "Plan", "hello #idea");
    flush(&mut s);
    assert_eq!(md_files(dir.path()), vec!["Plan.md"]);
    assert_eq!(
        read_note(&dir.path().join("Plan.md")),
        s.vault_note(&n.id).unwrap()
    );
}

#[test]
fn every_note_write_leaves_the_note_pending_until_flushed() {
    let (mut s, _dir) = mirrored();
    let n = create(&mut s, "first");
    assert_eq!(pending(&s), 1);
    flush(&mut s);
    assert_eq!(pending(&s), 0);
    s.update_note(
        &n.id,
        UpdateNotePatch {
            body: Some("second".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(pending(&s), 1);
}

#[test]
fn opening_a_note_does_not_dirty_the_vault() {
    let (mut s, _dir) = mirrored();
    let n = create(&mut s, "read me");
    flush(&mut s);
    s.get_note(&n.id, true).unwrap();
    assert_eq!(pending(&s), 0);
}

#[test]
fn flush_in_chunks_reports_what_remains() {
    let (mut s, _dir) = mirrored();
    for i in 0..5 {
        create(&mut s, &format!("note {i}"));
    }
    let out = s.flush_vault(2).unwrap();
    assert_eq!(out.written, 2);
    assert_eq!(out.remaining, 3);
    flush(&mut s);
}

#[test]
fn an_explicit_retitle_moves_the_file() {
    let (mut s, dir) = mirrored();
    let n = create_titled(&mut s, "Old", "body");
    flush(&mut s);
    retitle(&mut s, &n.id, "New");
    flush(&mut s);
    assert_eq!(md_files(dir.path()), vec!["New.md"]);
    assert_eq!(read_note(&dir.path().join("New.md")).id, n.id);
}

#[test]
fn a_case_only_retitle_leaves_one_file_under_the_new_name() {
    let (mut s, dir) = mirrored();
    let n = create_titled(&mut s, "notes", "body");
    flush(&mut s);
    retitle(&mut s, &n.id, "Notes");
    flush(&mut s);
    assert_eq!(md_files(dir.path()), vec!["Notes.md"]);
    assert_eq!(
        read_note(&dir.path().join("Notes.md")).title.unwrap(),
        "Notes"
    );
}

#[test]
fn titles_differing_only_in_case_get_separate_files() {
    let (mut s, dir) = mirrored();
    create_titled(&mut s, "Notes", "upper");
    create_titled(&mut s, "notes", "lower");
    flush(&mut s);
    let files = md_files(dir.path());
    assert_eq!(files.len(), 2, "one note overwrote the other: {files:?}");
}

#[test]
fn same_titles_get_separate_files() {
    let (mut s, dir) = mirrored();
    create_titled(&mut s, "Standup", "one");
    create_titled(&mut s, "Standup", "two");
    flush(&mut s);
    assert_eq!(md_files(dir.path()).len(), 2);
}

#[test]
fn soft_delete_moves_the_file_to_trash_and_restore_moves_it_back() {
    let (mut s, dir) = mirrored();
    let n = create_titled(&mut s, "Draft", "body");
    flush(&mut s);

    s.soft_delete_note(&n.id).unwrap();
    flush(&mut s);
    assert!(md_files(dir.path()).is_empty());
    assert_eq!(md_files(&dir.path().join("trash")), vec!["Draft.md"]);
    assert!(read_note(&dir.path().join("trash/Draft.md"))
        .deleted_at
        .is_some());

    s.restore_note(&n.id).unwrap();
    flush(&mut s);
    assert_eq!(md_files(dir.path()), vec!["Draft.md"]);
    assert!(md_files(&dir.path().join("trash")).is_empty());
}

#[test]
fn bulk_trash_and_restore_move_every_file() {
    let (mut s, dir) = mirrored();
    let ids: Vec<String> = ["A", "B"]
        .iter()
        .map(|t| create_titled(&mut s, t, "x").id)
        .collect();
    flush(&mut s);
    s.soft_delete_notes(&ids).unwrap();
    flush(&mut s);
    assert_eq!(md_files(&dir.path().join("trash")), vec!["A.md", "B.md"]);
    s.restore_notes(&ids).unwrap();
    flush(&mut s);
    assert_eq!(md_files(dir.path()), vec!["A.md", "B.md"]);
}

#[test]
fn permanent_deletes_remove_the_files() {
    let (mut s, dir) = mirrored();
    let a = create_titled(&mut s, "A", "x");
    let b = create_titled(&mut s, "B", "x");
    let c = create_titled(&mut s, "C", "x");
    flush(&mut s);
    s.permanently_delete_note(&a.id, true).unwrap();
    s.destroy_notes(&[b.id.clone(), c.id.clone()], true)
        .unwrap();
    let out = s.flush_vault(10_000).unwrap();
    assert_eq!(out.removed, 3);
    assert!(md_files(dir.path()).is_empty());
}

#[test]
fn a_permanent_delete_leaves_a_file_edited_outside_the_app() {
    let (mut s, dir) = mirrored();
    let a = create_titled(&mut s, "A", "x");
    flush(&mut s);
    fs::write(dir.path().join("A.md"), "edited by hand").unwrap();
    s.permanently_delete_note(&a.id, true).unwrap();
    flush(&mut s);
    assert_eq!(
        fs::read_to_string(dir.path().join("A.md")).unwrap(),
        "edited by hand"
    );
}

#[test]
fn tag_changes_rewrite_the_frontmatter_of_every_carrying_note() {
    let (mut s, dir) = mirrored();
    let n = create_titled(&mut s, "Plan", "body");
    let file = dir.path().join("Plan.md");

    let tag = s.add_tag_to_note(&n.id, "work").unwrap();
    flush(&mut s);
    assert_eq!(read_note(&file).tags, vec!["work"]);

    s.update_tag(&tag.id, Some("job".into()), None).unwrap();
    flush(&mut s);
    assert_eq!(read_note(&file).tags, vec!["job"]);

    s.remove_tag_from_note(&n.id, &tag.id).unwrap();
    flush(&mut s);
    assert!(read_note(&file).tags.is_empty());

    let tag = s.add_tag_to_note(&n.id, "gone").unwrap();
    flush(&mut s);
    s.delete_tag(&tag.id).unwrap();
    assert_eq!(pending(&s), 1);
    flush(&mut s);
    assert!(read_note(&file).tags.is_empty());
}

#[test]
fn a_tag_color_change_touches_only_the_manifest() {
    let (mut s, dir) = mirrored();
    let n = create_titled(&mut s, "Plan", "body");
    let tag = s.add_tag_to_note(&n.id, "work").unwrap();
    flush(&mut s);
    s.update_tag(&tag.id, None, Some("#ff0000".into())).unwrap();
    assert_eq!(pending(&s), 0, "a color change must not dirty notes");
    flush(&mut s);
    let manifest =
        parse_manifest(&fs::read_to_string(dir.path().join("instantnotes.yaml")).unwrap()).unwrap();
    assert_eq!(manifest.tags["work"].color.as_deref(), Some("#ff0000"));
}

#[test]
fn space_changes_rewrite_the_frontmatter_of_every_member_note() {
    let (mut s, dir) = mirrored();
    let n = create_titled(&mut s, "Plan", "body");
    let file = dir.path().join("Plan.md");
    let ws = s.get_or_create_workspace("Engineering").unwrap();

    s.add_note_to_workspace(&n.id, &ws.id).unwrap();
    flush(&mut s);
    assert_eq!(read_note(&file).spaces, vec!["Engineering"]);

    s.rename_workspace(&ws.id, "Platform").unwrap();
    flush(&mut s);
    assert_eq!(read_note(&file).spaces, vec!["Platform"]);

    s.remove_note_from_workspace(&n.id, &ws.id).unwrap();
    flush(&mut s);
    assert!(read_note(&file).spaces.is_empty());

    s.add_note_to_workspace(&n.id, &ws.id).unwrap();
    flush(&mut s);
    s.delete_workspace(&ws.id).unwrap();
    assert_eq!(pending(&s), 1);
    flush(&mut s);
    assert!(read_note(&file).spaces.is_empty());
}

#[test]
fn a_foreign_file_at_the_target_name_is_never_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("Plan.md"), "the user's own file").unwrap();
    let mut s = Store::open_in_memory().unwrap();
    s.configure_vault(Some(dir.path())).unwrap();

    let n = create_titled(&mut s, "Plan", "body");
    flush(&mut s);
    assert_eq!(
        fs::read_to_string(dir.path().join("Plan.md")).unwrap(),
        "the user's own file"
    );
    let short: String = n.id.chars().take(6).collect();
    assert_eq!(
        read_note(&dir.path().join(format!("Plan-{short}.md"))).id,
        n.id
    );
}

#[test]
fn an_earlier_export_of_the_same_library_is_adopted_in_place() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open_in_memory().unwrap();
    create_titled(&mut s, "Plan", "body");
    let t = create_titled(&mut s, "Old", "x");
    s.soft_delete_note(&t.id).unwrap();
    let (notes, manifest) = collect_from_store(&s).unwrap();
    export_vault(&notes, &manifest, dir.path()).unwrap();

    s.configure_vault(Some(dir.path())).unwrap();
    flush(&mut s);
    assert_eq!(md_files(dir.path()), vec!["Plan.md"]);
    assert_eq!(md_files(&dir.path().join("trash")), vec!["Old.md"]);
}

#[test]
fn pending_writes_survive_a_restart() {
    let db_dir = tempfile::tempdir().unwrap();
    let vault = tempfile::tempdir().unwrap();
    let db = db_dir.path().join("notes.db");
    {
        let mut s = Store::open(&db).unwrap();
        s.configure_vault(Some(vault.path())).unwrap();
        create_titled(&mut s, "Unflushed", "typed right before a crash");
    }
    let mut s = Store::open(&db).unwrap();
    s.attach_saved_vault().unwrap();
    assert_eq!(pending(&s), 1);
    flush(&mut s);
    assert_eq!(md_files(vault.path()), vec!["Unflushed.md"]);
}

#[test]
fn a_missing_vault_folder_pauses_the_mirror_without_losing_work() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("vault");
    fs::create_dir(&root).unwrap();
    let mut s = Store::open_in_memory().unwrap();
    s.configure_vault(Some(&root)).unwrap();
    fs::remove_dir(&root).unwrap();

    create_titled(&mut s, "Plan", "body");
    assert!(s.flush_vault(10_000).is_err());
    assert!(!root.exists(), "the vault root was recreated");
    let status = s.vault_status().unwrap();
    assert_eq!(status.pending, 1);
    assert!(status.last_error.is_some());

    fs::create_dir(&root).unwrap();
    flush(&mut s);
    assert_eq!(md_files(&root), vec!["Plan.md"]);
    assert!(s.vault_status().unwrap().last_error.is_none());
}

#[test]
fn configure_rejects_a_folder_that_does_not_exist() {
    let parent = tempfile::tempdir().unwrap();
    let mut s = Store::open_in_memory().unwrap();
    assert!(s
        .configure_vault(Some(&parent.path().join("missing")))
        .is_err());
    assert!(s.vault_status().unwrap().path.is_none());
}

#[test]
fn switching_folders_writes_everything_into_the_new_one() {
    let (mut s, first) = mirrored();
    create_titled(&mut s, "A", "x");
    create_titled(&mut s, "B", "x");
    flush(&mut s);

    let second = tempfile::tempdir().unwrap();
    s.configure_vault(Some(second.path())).unwrap();
    flush(&mut s);
    assert_eq!(md_files(second.path()), vec!["A.md", "B.md"]);
    assert_eq!(md_files(first.path()), vec!["A.md", "B.md"]);
}

#[test]
fn stopping_the_mirror_leaves_the_files_and_writes_nothing_more() {
    let (mut s, dir) = mirrored();
    let n = create_titled(&mut s, "A", "x");
    flush(&mut s);
    s.configure_vault(None).unwrap();
    retitle(&mut s, &n.id, "B");
    s.flush_vault(10_000).unwrap();
    assert_eq!(md_files(dir.path()), vec!["A.md"]);
    assert!(s.vault_status().unwrap().path.is_none());
}

#[test]
fn a_whole_library_mirrors_and_verifies_clean() {
    let (mut s, dir) = mirrored();
    let ws = s.get_or_create_workspace("Engineering").unwrap();
    let a = create_titled(&mut s, "Consensus", "Paxos and Raft #consensus");
    s.add_note_to_workspace(&a.id, &ws.id).unwrap();
    s.add_tag_to_note(&a.id, "reading").unwrap();
    let b = create(&mut s, "auto titled\nsecond line");
    s.set_notes_flags(std::slice::from_ref(&b.id), Some(true), None)
        .unwrap();
    let c = create_titled(&mut s, "Consensus", "same title, other note");
    s.set_notes_flags(std::slice::from_ref(&c.id), None, Some(true))
        .unwrap();
    let d = create_titled(&mut s, "Q1/Q2: plan?", "illegal filename characters");
    s.soft_delete_note(&d.id).unwrap();
    s.get_or_create_workspace("Empty space").unwrap();
    flush(&mut s);

    let report = s.verify_vault().unwrap();
    assert_eq!(report.checked, 4);
    assert!(report.missing.is_empty(), "{report:?}");
    assert!(report.diverged.is_empty(), "{report:?}");
    assert!(report.orphans.is_empty(), "{report:?}");
    assert_eq!(report.pending, 0);
    assert!(report.manifest_ok);

    let (expected, _) = collect_from_store(&s).unwrap();
    let mut found = Vec::new();
    for sub in ["", "trash"] {
        for name in md_files(&dir.path().join(sub)) {
            found.push(read_note(&dir.path().join(sub).join(name)));
        }
    }
    found.sort_by(|x, y| x.id.cmp(&y.id));
    let mut expected = expected;
    expected.sort_by(|x, y| x.id.cmp(&y.id));
    assert_eq!(found, expected);
}

#[test]
fn verify_reports_missing_diverged_and_orphan_files() {
    let (mut s, dir) = mirrored();
    create_titled(&mut s, "Kept", "x");
    create_titled(&mut s, "Deleted by hand", "x");
    create_titled(&mut s, "Edited by hand", "x");
    flush(&mut s);

    fs::remove_file(dir.path().join("Deleted by hand.md")).unwrap();
    let edited = dir.path().join("Edited by hand.md");
    let text = fs::read_to_string(&edited).unwrap();
    fs::write(&edited, text.replace("\nx", "\nchanged")).unwrap();
    fs::write(dir.path().join("Stray.md"), "not a note").unwrap();

    let report = s.verify_vault().unwrap();
    assert_eq!(report.missing, vec!["Deleted by hand.md"]);
    assert_eq!(report.diverged, vec!["Edited by hand.md"]);
    assert_eq!(report.orphans, vec!["Stray.md"]);
}

#[test]
#[ignore = "needs INSTANTNOTES_VAULT_TEST_DB pointing at a copy of a real library"]
fn a_real_library_copy_mirrors_and_verifies_clean() {
    use std::time::Instant;

    let db = std::env::var_os("INSTANTNOTES_VAULT_TEST_DB")
        .expect("set INSTANTNOTES_VAULT_TEST_DB to a copy of a library");
    let mut s = Store::open(Path::new(&db)).unwrap();
    let vault = tempfile::tempdir().unwrap();
    s.configure_vault(Some(vault.path())).unwrap();
    let total = pending(&s);

    let started = Instant::now();
    loop {
        let out = s.flush_vault(200).unwrap();
        assert!(out.errors.is_empty(), "flush errors: {:?}", out.errors);
        if out.remaining == 0 {
            break;
        }
    }
    let first_mirror = started.elapsed();

    let report = s.verify_vault().unwrap();
    assert_eq!(report.checked as i64, total);
    assert!(report.missing.is_empty(), "{report:?}");
    assert!(report.diverged.is_empty(), "{report:?}");
    assert!(report.orphans.is_empty(), "{report:?}");
    assert!(report.manifest_ok);

    let (mut expected, _) = collect_from_store(&s).unwrap();
    let mut found = Vec::new();
    for sub in ["", "trash"] {
        for name in md_files(&vault.path().join(sub)) {
            found.push(read_note(&vault.path().join(sub).join(name)));
        }
    }
    found.sort_by(|x, y| x.id.cmp(&y.id));
    expected.sort_by(|x, y| x.id.cmp(&y.id));
    assert_eq!(found, expected);

    let id = expected[0].id.clone();
    let mut single = Vec::new();
    for i in 0..20 {
        s.update_note(
            &id,
            UpdateNotePatch {
                body: Some(format!("{}\n{i}", expected[0].body)),
                ..Default::default()
            },
        )
        .unwrap();
        let t = Instant::now();
        flush(&mut s);
        single.push(t.elapsed());
    }
    single.sort();
    eprintln!(
        "{total} notes: first mirror {first_mirror:?}; single-note flush median {:?}, max {:?}",
        single[single.len() / 2],
        single[single.len() - 1]
    );
}
