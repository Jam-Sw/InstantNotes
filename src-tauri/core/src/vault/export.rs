//! Stage 1 export: write the whole library to a chosen folder as a vault.
//! One-way, no behavior change: SQLite stays authoritative (design.md,
//! SEQUENCE.md unit 7). Attachment copying lives in the desktop shell layer,
//! which is the one that knows where `<app data>/attachments` is.

use super::{
    atomic_write, canvas_rel, collision_key, note_filename, serialize_manifest, serialize_note,
    Manifest, VaultNote,
};
use crate::domain;
use crate::error::Result;
use crate::store::Store;
use crate::types::{Note, NoteFilter};
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::Path;

// list_notes pages at up to 5000 rows per call (store/notes.rs); page
// through every state rather than trusting one call to return everything,
// or a library past that size silently loses notes off the end.
const LIST_PAGE: i64 = 5000;

fn list_all(store: &Store, filter: NoteFilter) -> Result<Vec<Note>> {
    let mut out = Vec::new();
    let mut offset = 0i64;
    loop {
        let page = store.list_notes(NoteFilter {
            limit: Some(LIST_PAGE),
            offset: Some(offset),
            ..filter.clone()
        })?;
        let got = page.len();
        out.extend(page);
        if (got as i64) < LIST_PAGE {
            break;
        }
        offset += LIST_PAGE;
    }
    Ok(out)
}

/// Gather every note (active, archived, and trashed) as `VaultNote`s, plus
/// the tag/space manifest, from a live store. SEQUENCE.md unit 7's done
/// condition: exporting this and re-parsing it must reproduce every field
/// of every note.
pub fn collect_from_store(store: &Store) -> Result<(Vec<VaultNote>, Manifest)> {
    let mut notes: Vec<Note> = Vec::new();
    for filter in [
        NoteFilter {
            is_deleted: Some(false),
            is_archived: Some(false),
            ..Default::default()
        },
        NoteFilter {
            is_deleted: Some(false),
            is_archived: Some(true),
            ..Default::default()
        },
        NoteFilter {
            is_deleted: Some(true),
            ..Default::default()
        },
    ] {
        notes.extend(list_all(store, filter)?);
    }

    let vault_notes = notes
        .iter()
        .map(|note| store.vault_note(&note.id))
        .collect::<Result<Vec<_>>>()?;
    let manifest = store.vault_manifest()?;
    Ok((vault_notes, manifest))
}

/// Write every note plus `instantnotes.yaml` into `dest`, which is created
/// if missing. Deleted notes land under `dest/trash/`; everything else at
/// the vault root. Filenames are assigned in `notes` order, so collisions
/// resolve deterministically for a given input order.
pub fn export_vault(notes: &[VaultNote], manifest: &Manifest, dest: &Path) -> io::Result<()> {
    let trash_dir = dest.join("trash");
    fs::create_dir_all(&trash_dir)?;

    let mut taken_root: HashSet<String> = HashSet::new();
    let mut taken_trash: HashSet<String> = HashSet::new();

    for note in notes {
        let display_title = note
            .title
            .clone()
            .unwrap_or_else(|| domain::derive_title(&note.body));
        let is_trashed = note.deleted_at.is_some();
        let taken = if is_trashed {
            &mut taken_trash
        } else {
            &mut taken_root
        };
        let filename = note_filename(&display_title, &note.id, taken);
        taken.insert(collision_key(&filename));

        let dir = if is_trashed { &trash_dir } else { dest };
        atomic_write(&dir.join(&filename), serialize_note(note).as_bytes())?;
        if let Some(canvas) = &note.canvas {
            atomic_write(&dir.join(canvas_rel(&filename)), canvas.as_bytes())?;
        }
    }

    atomic_write(
        &dest.join("instantnotes.yaml"),
        serialize_manifest(manifest).as_bytes(),
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::{ManifestSpace, ManifestTag};

    fn note(id: &str, title: Option<&str>, body: &str, deleted: bool) -> VaultNote {
        VaultNote {
            id: id.to_string(),
            title: title.map(str::to_string),
            body: body.to_string(),
            created_at: "2026-01-01T00:00:00.000000Z".to_string(),
            updated_at: "2026-01-01T00:00:00.000000Z".to_string(),
            is_pinned: false,
            is_archived: false,
            deleted_at: deleted.then(|| "2026-01-02T00:00:00.000000Z".to_string()),
            tags: Vec::new(),
            spaces: Vec::new(),
            kind: crate::types::CONTENT_KIND_DOCUMENT.to_string(),
            canvas: None,
        }
    }

    #[test]
    fn writes_a_note_file_named_after_its_title() {
        let dir = tempfile::tempdir().unwrap();
        let notes = vec![note("id1", Some("My Note"), "body", false)];
        export_vault(&notes, &Manifest::default(), dir.path()).unwrap();
        let content = fs::read_to_string(dir.path().join("My Note.md")).unwrap();
        assert!(content.contains("id: id1"));
        assert!(content.ends_with("body"));
    }

    #[test]
    fn falls_back_to_the_derived_title_when_none_is_set() {
        let dir = tempfile::tempdir().unwrap();
        let notes = vec![note("id1", None, "Buy milk\nand eggs", false)];
        export_vault(&notes, &Manifest::default(), dir.path()).unwrap();
        assert!(dir.path().join("Buy milk.md").exists());
    }

    #[test]
    fn deleted_notes_land_in_trash() {
        let dir = tempfile::tempdir().unwrap();
        let notes = vec![note("id1", Some("Old Draft"), "body", true)];
        export_vault(&notes, &Manifest::default(), dir.path()).unwrap();
        assert!(!dir.path().join("Old Draft.md").exists());
        assert!(dir.path().join("trash").join("Old Draft.md").exists());
    }

    #[test]
    fn two_notes_with_the_same_title_both_survive_with_distinct_names() {
        let dir = tempfile::tempdir().unwrap();
        let notes = vec![
            note("aaaaaa-1", Some("Standup"), "one", false),
            note("bbbbbb-2", Some("Standup"), "two", false),
        ];
        export_vault(&notes, &Manifest::default(), dir.path()).unwrap();
        assert!(dir.path().join("Standup.md").exists());
        assert!(dir.path().join("Standup-bbbbbb.md").exists());
    }

    #[test]
    fn titles_differing_only_in_case_both_survive() {
        let dir = tempfile::tempdir().unwrap();
        let notes = vec![
            note("aaaaaa-1", Some("Notes"), "upper", false),
            note("bbbbbb-2", Some("notes"), "lower", false),
        ];
        export_vault(&notes, &Manifest::default(), dir.path()).unwrap();
        let mut bodies: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.extension().is_some_and(|x| x == "md"))
            .map(|p| fs::read_to_string(p).unwrap())
            .collect();
        bodies.sort();
        assert_eq!(bodies.len(), 2, "one note overwrote the other");
        // Sorted by full text, so by frontmatter id: aaaaaa-1 first.
        assert!(bodies[0].ends_with("upper") && bodies[1].ends_with("lower"));
    }

    #[test]
    fn root_and_trash_collisions_are_tracked_independently() {
        let dir = tempfile::tempdir().unwrap();
        let notes = vec![
            note("aaaaaa-1", Some("Notes"), "active", false),
            note("bbbbbb-2", Some("Notes"), "trashed", true),
        ];
        export_vault(&notes, &Manifest::default(), dir.path()).unwrap();
        // Same plain name in each location is fine; they don't collide with
        // each other, only within their own directory.
        assert!(dir.path().join("Notes.md").exists());
        assert!(dir.path().join("trash").join("Notes.md").exists());
    }

    #[test]
    fn writes_the_manifest_alongside_the_notes() {
        let dir = tempfile::tempdir().unwrap();
        let mut m = Manifest::default();
        m.tags.insert(
            "idea".to_string(),
            ManifestTag {
                color: Some("#fff".to_string()),
                created: "2026-01-01T00:00:00.000000Z".to_string(),
            },
        );
        m.spaces.push(ManifestSpace {
            name: "Engineering".to_string(),
            created: "2026-01-01T00:00:00.000000Z".to_string(),
        });
        export_vault(&[], &m, dir.path()).unwrap();
        let text = fs::read_to_string(dir.path().join("instantnotes.yaml")).unwrap();
        assert!(text.contains("idea"));
        assert!(text.contains("Engineering"));
    }

    #[test]
    fn creates_the_destination_directory_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("fresh-vault");
        export_vault(&[], &Manifest::default(), &dest).unwrap();
        assert!(dest.join("instantnotes.yaml").exists());
    }
}
