use instantnotes_core::types::*;
use instantnotes_core::vault::{collect_from_store, export_vault, parse_note};
use instantnotes_core::Store;
use std::fs;
use std::path::Path;
use tempfile::TempDir;

const GRID: &str = r#"{"v":1,"engine":"grid","data":{"cols":[{"w":120},{"w":80}],"rows":[["Build","ms"],["a1f3","412"],["",""]]}}"#;
const GRID2: &str = r#"{"v":1,"engine":"grid","data":{"cols":[{"w":120},{"w":80}],"rows":[["Build","ms"],["a1f3","412"],["b2c4","398"]]}}"#;

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

fn sheet(s: &mut Store, title: &str) -> Note {
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
            content_kind: Some(CONTENT_KIND_SHEET.into()),
            surface_data: Some(GRID.into()),
            ..Default::default()
        },
    )
    .unwrap()
}

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

#[test]
fn a_sheet_writes_its_csv_beside_its_note() {
    let (mut s, dir) = mirrored();
    let n = sheet(&mut s, "Timings");
    flush(&mut s);

    assert_eq!(files(dir.path()), vec!["Timings.csv", "Timings.md"]);
    let note = parse_note(&fs::read_to_string(dir.path().join("Timings.md")).unwrap()).unwrap();
    assert_eq!(note.id, n.id);
    assert_eq!(note.kind, CONTENT_KIND_SHEET);
    assert_eq!(note.body, "| Build | ms |\n| --- | --- |\n| a1f3 | 412 |");
    assert_eq!(
        fs::read_to_string(dir.path().join("Timings.csv")).unwrap(),
        "Build,ms\r\na1f3,412\r\n"
    );
}

#[test]
fn a_grid_edit_rewrites_the_csv() {
    let (mut s, dir) = mirrored();
    let n = sheet(&mut s, "Timings");
    flush(&mut s);
    s.update_note(
        &n.id,
        UpdateNotePatch {
            surface_data: Some(GRID2.into()),
            ..Default::default()
        },
    )
    .unwrap();
    flush(&mut s);
    assert_eq!(
        fs::read_to_string(dir.path().join("Timings.csv")).unwrap(),
        "Build,ms\r\na1f3,412\r\nb2c4,398\r\n"
    );
}

#[test]
fn renaming_a_sheet_moves_its_csv_too() {
    let (mut s, dir) = mirrored();
    let n = sheet(&mut s, "Timings");
    flush(&mut s);
    s.update_note(
        &n.id,
        UpdateNotePatch {
            title: Some("Bench".into()),
            ..Default::default()
        },
    )
    .unwrap();
    flush(&mut s);
    assert_eq!(files(dir.path()), vec!["Bench.csv", "Bench.md"]);
}

#[test]
fn trash_restore_and_destroy_carry_the_csv() {
    let (mut s, dir) = mirrored();
    let n = sheet(&mut s, "Timings");
    flush(&mut s);

    s.soft_delete_note(&n.id).unwrap();
    flush(&mut s);
    assert!(files(dir.path()).is_empty());
    assert_eq!(
        files(&dir.path().join("trash")),
        vec!["Timings.csv", "Timings.md"]
    );

    s.restore_note(&n.id).unwrap();
    flush(&mut s);
    assert_eq!(files(dir.path()), vec!["Timings.csv", "Timings.md"]);

    s.soft_delete_note(&n.id).unwrap();
    s.destroy_notes(std::slice::from_ref(&n.id), true).unwrap();
    flush(&mut s);
    assert!(files(dir.path()).is_empty());
    assert!(files(&dir.path().join("trash")).is_empty());
}

#[test]
fn a_csv_edited_outside_the_app_survives_a_delete() {
    let (mut s, dir) = mirrored();
    let n = sheet(&mut s, "Timings");
    flush(&mut s);
    fs::write(dir.path().join("Timings.csv"), "mine\r\n").unwrap();

    s.soft_delete_note(&n.id).unwrap();
    s.destroy_notes(std::slice::from_ref(&n.id), true).unwrap();
    flush(&mut s);

    assert_eq!(files(dir.path()), vec!["Timings.csv"]);
}

#[test]
fn a_foreign_csv_at_the_name_is_never_overwritten() {
    let (mut s, dir) = mirrored();
    fs::write(dir.path().join("Timings.csv"), "someone else's data").unwrap();
    let n = sheet(&mut s, "Timings");
    flush(&mut s);

    assert_eq!(
        fs::read_to_string(dir.path().join("Timings.csv")).unwrap(),
        "someone else's data"
    );
    let id6 = &n.id[..6];
    let names = files(dir.path());
    assert!(names.contains(&format!("Timings-{id6}.md")), "{names:?}");
    assert!(names.contains(&format!("Timings-{id6}.csv")), "{names:?}");
}

#[test]
fn a_document_that_becomes_a_sheet_gains_its_csv() {
    let (mut s, dir) = mirrored();
    let n = s
        .create_note(CreateNoteInput {
            title: Some("Log".into()),
            body: Some(String::new()),
            ..Default::default()
        })
        .unwrap();
    flush(&mut s);
    assert_eq!(files(dir.path()), vec!["Log.md"]);
    s.update_note(
        &n.id,
        UpdateNotePatch {
            content_kind: Some(CONTENT_KIND_SHEET.into()),
            ..Default::default()
        },
    )
    .unwrap();
    flush(&mut s);
    assert_eq!(files(dir.path()), vec!["Log.csv", "Log.md"]);
    assert_eq!(fs::read_to_string(dir.path().join("Log.csv")).unwrap(), "");
    let text = fs::read_to_string(dir.path().join("Log.md")).unwrap();
    assert!(text.contains("\nkind: sheet\n"), "{text}");
}

#[test]
fn verify_checks_the_csv_too() {
    let (mut s, dir) = mirrored();
    sheet(&mut s, "Timings");
    sheet(&mut s, "Bench");
    flush(&mut s);

    let clean = s.verify_vault().unwrap();
    assert!(clean.missing.is_empty() && clean.diverged.is_empty() && clean.orphans.is_empty());

    fs::write(dir.path().join("Timings.csv"), "Build,ms\n").unwrap();
    fs::remove_file(dir.path().join("Bench.csv")).unwrap();
    fs::write(dir.path().join("Loose.csv"), "x\r\n").unwrap();
    let report = s.verify_vault().unwrap();
    assert_eq!(report.diverged, vec!["Timings.csv"]);
    assert_eq!(report.missing, vec!["Bench.csv"]);
    assert_eq!(report.orphans, vec!["Loose.csv"]);
}

#[test]
fn an_export_writes_the_csv_too() {
    let mut s = Store::open_in_memory().unwrap();
    sheet(&mut s, "Timings");
    let dest = tempfile::tempdir().unwrap();
    let (notes, manifest) = collect_from_store(&s).unwrap();
    export_vault(&notes, &manifest, dest.path()).unwrap();
    assert_eq!(files(dest.path()), vec!["Timings.csv", "Timings.md"]);
    assert_eq!(
        fs::read_to_string(dest.path().join("Timings.csv")).unwrap(),
        "Build,ms\r\na1f3,412\r\n"
    );
}
