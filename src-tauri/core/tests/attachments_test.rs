//! Attachment cleanup (SEQUENCE.md unit 11). An image pasted into a note is a
//! file under `<app data>/attachments`, referenced from the body as
//! `attachments/<name>`. Destroying the last note that references it removes
//! the file; nothing a note, the trash, or the capture draft still refers to
//! is ever removed. Real SQLite and real tempdirs throughout.

use instantnotes_core::attachments::{list_attachments, referenced_names, remove_attachment};
use instantnotes_core::types::*;
use instantnotes_core::Store;
use std::fs;
use std::time::{Duration, SystemTime};

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

fn names(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

// ---- finding references ----

#[test]
fn finds_every_attachment_a_body_references() {
    let body = "intro ![](attachments/a1.png) and ![alt](attachments/b-2.JPG)\n\
                <img src=\"attachments/c_3.webp\"> twice ![](attachments/a1.png)";
    let found: Vec<String> = referenced_names(body).into_iter().collect();
    assert_eq!(found, names(&["a1.png", "b-2.JPG", "c_3.webp"]));
}

#[test]
fn ignores_a_bare_folder_mention_and_linked_originals() {
    assert!(referenced_names("see the attachments/ folder").is_empty());
    assert!(referenced_names("![](/Users/me/Pictures/cat.png)").is_empty());
}

// ---- which files are still referenced ----

#[test]
fn a_destroyed_notes_images_become_unreferenced() {
    let mut s = store();
    let n = create(
        &mut s,
        "![](attachments/only.png) ![](attachments/shared.png)",
    );
    create(&mut s, "also uses ![](attachments/shared.png)");

    let referenced = s.attachment_names_of(std::slice::from_ref(&n.id)).unwrap();
    assert_eq!(
        referenced.iter().cloned().collect::<Vec<_>>(),
        names(&["only.png", "shared.png"])
    );
    s.soft_delete_note(&n.id).unwrap();
    s.destroy_notes(std::slice::from_ref(&n.id), true).unwrap();

    assert_eq!(
        s.unreferenced_attachments(referenced).unwrap(),
        names(&["only.png"])
    );
}

#[test]
fn a_trashed_or_archived_note_still_holds_its_images() {
    let mut s = store();
    let trashed = create(&mut s, "![](attachments/t.png)");
    s.soft_delete_note(&trashed.id).unwrap();
    let archived = create(&mut s, "![](attachments/a.png)");
    s.update_note(
        &archived.id,
        UpdateNotePatch {
            is_archived: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    let left = s
        .unreferenced_attachments(names(&["t.png", "a.png", "gone.png"]))
        .unwrap();
    assert_eq!(left, names(&["gone.png"]));
}

#[test]
fn a_reference_in_another_case_still_holds_the_image() {
    let mut s = store();
    create(&mut s, "![](attachments/Shot.PNG)");
    assert!(s
        .unreferenced_attachments(names(&["shot.png"]))
        .unwrap()
        .is_empty());
}

#[test]
fn the_capture_draft_holds_its_images() {
    let mut s = store();
    s.set_setting(
        "capture.draft",
        serde_json::Value::String("half written ![](attachments/draft.png)".into()),
    )
    .unwrap();
    assert!(s
        .unreferenced_attachments(names(&["draft.png"]))
        .unwrap()
        .is_empty());
}

#[test]
fn a_whiteboard_canvas_holds_its_images() {
    let mut s = store();
    let n = create(&mut s, "");
    s.update_note(
        &n.id,
        UpdateNotePatch {
            content_kind: Some(CONTENT_KIND_WHITEBOARD.into()),
            surface_data: Some(r#"{"v":1,"note":"attachments/board.png"}"#.into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(s
        .unreferenced_attachments(names(&["board.png"]))
        .unwrap()
        .is_empty());
}

// ---- removing files ----

#[test]
fn removing_takes_the_file_and_an_identical_vault_copy() {
    let dir = tempfile::tempdir().unwrap();
    let vault = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("x.png"), b"pixels").unwrap();
    fs::write(vault.path().join("x.png"), b"pixels").unwrap();

    let freed = remove_attachment(dir.path(), Some(vault.path()), "x.png").unwrap();

    assert_eq!(freed, 6);
    assert!(!dir.path().join("x.png").exists());
    assert!(!vault.path().join("x.png").exists());
}

/// A vault copy that differs was changed outside the app: not ours to remove.
#[test]
fn removing_keeps_a_vault_copy_that_was_changed() {
    let dir = tempfile::tempdir().unwrap();
    let vault = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("x.png"), b"pixels").unwrap();
    fs::write(vault.path().join("x.png"), b"edited").unwrap();

    remove_attachment(dir.path(), Some(vault.path()), "x.png").unwrap();

    assert!(!dir.path().join("x.png").exists());
    assert_eq!(fs::read(vault.path().join("x.png")).unwrap(), b"edited");
}

#[test]
fn removing_refuses_anything_but_a_plain_file_name() {
    let dir = tempfile::tempdir().unwrap();
    let outside = dir.path().join("keep.png");
    fs::write(&outside, b"x").unwrap();
    let inner = dir.path().join("attachments");
    fs::create_dir(&inner).unwrap();
    for bad in ["../keep.png", "a/b.png", "", ".", ".."] {
        assert!(remove_attachment(&inner, None, bad).is_err(), "{bad:?}");
    }
    assert!(outside.exists());
}

#[test]
fn removing_a_missing_file_frees_nothing() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(remove_attachment(dir.path(), None, "nope.png").unwrap(), 0);
}

#[test]
fn listing_skips_folders_hidden_files_and_anything_too_recent() {
    let dir = tempfile::tempdir().unwrap();
    let old = SystemTime::now() - Duration::from_secs(3 * 3600);
    for (name, bytes) in [("old.png", 3usize), ("new.png", 5)] {
        fs::write(dir.path().join(name), vec![0u8; bytes]).unwrap();
    }
    fs::File::options()
        .write(true)
        .open(dir.path().join("old.png"))
        .unwrap()
        .set_modified(old)
        .unwrap();
    fs::write(dir.path().join(".DS_Store"), b"x").unwrap();
    fs::create_dir(dir.path().join("sub")).unwrap();

    let cutoff = SystemTime::now() - Duration::from_secs(3600);
    assert_eq!(
        list_attachments(dir.path(), Some(cutoff)).unwrap(),
        vec![("old.png".to_string(), 3)]
    );
    let mut all = list_attachments(dir.path(), None).unwrap();
    all.sort();
    assert_eq!(
        all,
        vec![("new.png".to_string(), 5), ("old.png".to_string(), 3)]
    );
}

#[test]
fn listing_a_missing_folder_is_empty() {
    let dir = tempfile::tempdir().unwrap();
    assert!(list_attachments(&dir.path().join("none"), None)
        .unwrap()
        .is_empty());
}

// ---- the store's removal: re-checked, and carried into the vault ----

#[test]
fn the_store_removes_only_what_nothing_references() {
    let mut s = store();
    let dir = tempfile::tempdir().unwrap();
    for name in ["kept.png", "loose.png"] {
        fs::write(dir.path().join(name), b"img").unwrap();
    }
    create(&mut s, "![](attachments/kept.png)");

    // Callers pass candidates; the store checks them again itself.
    let done = s
        .remove_unreferenced_attachments(dir.path(), names(&["kept.png", "loose.png"]))
        .unwrap();

    assert_eq!((done.count, done.bytes), (1, 3));
    assert!(dir.path().join("kept.png").exists());
    assert!(!dir.path().join("loose.png").exists());
}

#[test]
fn the_store_also_removes_the_live_vault_copy() {
    let mut s = store();
    let vault = tempfile::tempdir().unwrap();
    s.configure_vault(Some(vault.path())).unwrap();
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(vault.path().join("attachments")).unwrap();
    fs::write(dir.path().join("x.png"), b"img").unwrap();
    fs::write(vault.path().join("attachments/x.png"), b"img").unwrap();

    s.remove_unreferenced_attachments(dir.path(), names(&["x.png"]))
        .unwrap();

    assert!(!vault.path().join("attachments/x.png").exists());
}
