//! Whiteboards in the vault. A board's note file carries `kind: whiteboard`
//! and the text on the canvas; the canvas itself is a standard `.excalidraw`
//! file beside it with the same name, openable in Excalidraw. The sidecar
//! follows its note through renames, the trash, and deletes, under the same
//! ownership rules as the note files.

use instantnotes_core::types::*;
use instantnotes_core::vault::{collect_from_store, export_vault, parse_note};
use instantnotes_core::Store;
use serde_json::{json, Value};
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

fn envelope(elements: Value) -> String {
    json!({
        "v": 1,
        "engine": "excalidraw",
        "data": {
            "elements": elements,
            "appState": { "viewBackgroundColor": "transparent" },
            "files": {}
        }
    })
    .to_string()
}

fn rect(id: &str) -> Value {
    json!({ "id": id, "type": "rectangle", "x": 0, "y": 0, "width": 10, "height": 10 })
}

/// A whiteboard titled `title` holding one rectangle.
fn board(s: &mut Store, title: &str) -> Note {
    let n = s
        .create_note(CreateNoteInput {
            title: Some(title.to_string()),
            body: Some(String::new()),
            ..Default::default()
        })
        .unwrap();
    s.update_note(
        &n.id,
        UpdateNotePatch {
            content_kind: Some(CONTENT_KIND_WHITEBOARD.into()),
            surface_data: Some(envelope(json!([rect("r1")]))),
            body: Some("words on the board".into()),
            ..Default::default()
        },
    )
    .unwrap()
}

fn save_board(s: &mut Store, id: &str, elements: Value) {
    s.update_note(
        id,
        UpdateNotePatch {
            surface_data: Some(envelope(elements)),
            ..Default::default()
        },
    )
    .unwrap();
}

/// Visible filenames directly inside `dir`, sorted, skipping folders.
fn files(dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .map(|e| e.unwrap())
        .filter(|e| e.file_type().unwrap().is_file())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| !n.starts_with('.') && n != "instantnotes.yaml")
        .collect();
    names.sort();
    names
}

fn read_json(path: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn a_whiteboard_writes_its_canvas_beside_its_note() {
    let (mut s, dir) = mirrored();
    let n = board(&mut s, "Plan");
    flush(&mut s);

    assert_eq!(files(dir.path()), vec!["Plan.excalidraw", "Plan.md"]);
    let note = parse_note(&fs::read_to_string(dir.path().join("Plan.md")).unwrap()).unwrap();
    assert_eq!(note.id, n.id);
    assert_eq!(note.kind, CONTENT_KIND_WHITEBOARD);
    assert_eq!(note.body, "words on the board");

    let canvas = read_json(&dir.path().join("Plan.excalidraw"));
    assert_eq!(canvas["type"], "excalidraw");
    assert_eq!(canvas["version"], 2);
    assert_eq!(canvas["elements"], json!([rect("r1")]));
    assert_eq!(canvas["appState"]["viewBackgroundColor"], "transparent");
    assert_eq!(canvas["files"], json!({}));
}

#[test]
fn a_document_gets_no_canvas_and_no_kind_line() {
    let (mut s, dir) = mirrored();
    s.create_note(CreateNoteInput {
        body: Some("Plain".into()),
        ..Default::default()
    })
    .unwrap();
    flush(&mut s);
    assert_eq!(files(dir.path()), vec!["Plain.md"]);
    let text = fs::read_to_string(dir.path().join("Plain.md")).unwrap();
    assert!(!text.contains("kind:"), "{text}");
}

#[test]
fn a_canvas_edit_rewrites_the_canvas_file() {
    let (mut s, dir) = mirrored();
    let n = board(&mut s, "Plan");
    flush(&mut s);
    save_board(&mut s, &n.id, json!([rect("r1"), rect("r2")]));
    flush(&mut s);
    let canvas = read_json(&dir.path().join("Plan.excalidraw"));
    assert_eq!(canvas["elements"].as_array().unwrap().len(), 2);
}

#[test]
fn renaming_a_board_moves_its_canvas_too() {
    let (mut s, dir) = mirrored();
    let n = board(&mut s, "Plan");
    flush(&mut s);
    s.update_note(
        &n.id,
        UpdateNotePatch {
            title: Some("Roadmap".into()),
            ..Default::default()
        },
    )
    .unwrap();
    flush(&mut s);
    assert_eq!(files(dir.path()), vec!["Roadmap.excalidraw", "Roadmap.md"]);
}

#[test]
fn a_case_only_rename_keeps_one_canvas_under_the_new_name() {
    let (mut s, dir) = mirrored();
    let n = board(&mut s, "plan");
    flush(&mut s);
    s.update_note(
        &n.id,
        UpdateNotePatch {
            title: Some("Plan".into()),
            ..Default::default()
        },
    )
    .unwrap();
    flush(&mut s);
    assert_eq!(files(dir.path()), vec!["Plan.excalidraw", "Plan.md"]);
}

#[test]
fn trash_restore_and_destroy_carry_the_canvas() {
    let (mut s, dir) = mirrored();
    let n = board(&mut s, "Plan");
    flush(&mut s);

    s.soft_delete_note(&n.id).unwrap();
    flush(&mut s);
    assert!(files(dir.path()).is_empty());
    assert_eq!(
        files(&dir.path().join("trash")),
        vec!["Plan.excalidraw", "Plan.md"]
    );

    s.restore_note(&n.id).unwrap();
    flush(&mut s);
    assert_eq!(files(dir.path()), vec!["Plan.excalidraw", "Plan.md"]);
    assert!(files(&dir.path().join("trash")).is_empty());

    s.soft_delete_note(&n.id).unwrap();
    s.destroy_notes(std::slice::from_ref(&n.id), true).unwrap();
    flush(&mut s);
    assert!(files(dir.path()).is_empty());
    assert!(files(&dir.path().join("trash")).is_empty());
}

#[test]
fn a_canvas_edited_outside_the_app_survives_a_delete() {
    let (mut s, dir) = mirrored();
    let n = board(&mut s, "Plan");
    flush(&mut s);
    fs::write(dir.path().join("Plan.excalidraw"), "{\"mine\": true}").unwrap();

    s.soft_delete_note(&n.id).unwrap();
    s.destroy_notes(std::slice::from_ref(&n.id), true).unwrap();
    flush(&mut s);

    assert_eq!(files(dir.path()), vec!["Plan.excalidraw"]);
    assert_eq!(
        fs::read_to_string(dir.path().join("Plan.excalidraw")).unwrap(),
        "{\"mine\": true}"
    );
}

#[test]
fn a_foreign_canvas_at_the_name_is_never_overwritten() {
    let (mut s, dir) = mirrored();
    fs::write(dir.path().join("Plan.excalidraw"), "someone else's drawing").unwrap();
    let n = board(&mut s, "Plan");
    flush(&mut s);

    assert_eq!(
        fs::read_to_string(dir.path().join("Plan.excalidraw")).unwrap(),
        "someone else's drawing"
    );
    let id6 = &n.id[..6];
    let names = files(dir.path());
    assert!(names.contains(&format!("Plan-{id6}.md")), "{names:?}");
    assert!(
        names.contains(&format!("Plan-{id6}.excalidraw")),
        "{names:?}"
    );
    assert!(!names.contains(&"Plan.md".to_string()), "{names:?}");
}

#[test]
fn stopping_and_restarting_on_the_same_folder_adopts_the_canvas() {
    let (mut s, dir) = mirrored();
    board(&mut s, "Plan");
    flush(&mut s);
    s.configure_vault(None).unwrap();
    s.configure_vault(Some(dir.path())).unwrap();
    flush(&mut s);
    assert_eq!(files(dir.path()), vec!["Plan.excalidraw", "Plan.md"]);
}

#[test]
fn verify_checks_the_canvas_too() {
    let (mut s, dir) = mirrored();
    board(&mut s, "Plan");
    board(&mut s, "Map");
    flush(&mut s);

    let clean = s.verify_vault().unwrap();
    assert!(clean.missing.is_empty() && clean.diverged.is_empty() && clean.orphans.is_empty());
    assert_eq!(clean.checked, 2);

    fs::write(dir.path().join("Plan.excalidraw"), "{}").unwrap();
    fs::remove_file(dir.path().join("Map.excalidraw")).unwrap();
    fs::write(dir.path().join("Loose.excalidraw"), "{}").unwrap();
    let report = s.verify_vault().unwrap();
    assert_eq!(report.diverged, vec!["Plan.excalidraw"]);
    assert_eq!(report.missing, vec!["Map.excalidraw"]);
    assert_eq!(report.orphans, vec!["Loose.excalidraw"]);
}

/// Formatting is not content: a canvas file reindented by another tool
/// still matches.
#[test]
fn verify_compares_the_canvas_by_content_not_bytes() {
    let (mut s, dir) = mirrored();
    board(&mut s, "Plan");
    flush(&mut s);
    let path = dir.path().join("Plan.excalidraw");
    let compact = serde_json::to_string(&read_json(&path)).unwrap();
    fs::write(&path, compact).unwrap();
    assert!(s.verify_vault().unwrap().diverged.is_empty());
}

#[test]
fn an_export_writes_the_canvas_too() {
    let mut s = Store::open_in_memory().unwrap();
    board(&mut s, "Plan");
    let dest = tempfile::tempdir().unwrap();
    let (notes, manifest) = collect_from_store(&s).unwrap();
    export_vault(&notes, &manifest, dest.path()).unwrap();
    assert_eq!(files(dest.path()), vec!["Plan.excalidraw", "Plan.md"]);
    let canvas = read_json(&dest.path().join("Plan.excalidraw"));
    assert_eq!(canvas["elements"], json!([rect("r1")]));
}

/// A board saved before the store ever wrote a canvas (or with an envelope
/// it does not recognize) still mirrors: its canvas file is an empty scene.
#[test]
fn an_unreadable_canvas_mirrors_as_an_empty_scene() {
    let (mut s, dir) = mirrored();
    let n = board(&mut s, "Plan");
    s.update_note(
        &n.id,
        UpdateNotePatch {
            surface_data: Some("not json".into()),
            ..Default::default()
        },
    )
    .unwrap();
    flush(&mut s);
    let canvas = read_json(&dir.path().join("Plan.excalidraw"));
    assert_eq!(canvas["type"], "excalidraw");
    assert_eq!(canvas["elements"], json!([]));
}
