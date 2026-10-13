use super::surface::{is_vault_file_name, note_of_surface, surface_rel, CANVAS_EXT, SHEET_EXT};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::io;
use std::path::Path;
use std::time::{Duration, SystemTime};

pub const MANIFEST_FILE: &str = "instantnotes.yaml";
pub const TRASH_DIR: &str = "trash";
pub const ATTACHMENTS_DIR: &str = "attachments";

const SETTLE: Duration = Duration::from_secs(2);

pub fn is_vault_root(root: &Path) -> bool {
    root.join(MANIFEST_FILE).is_file()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stamp {
    pub len: u64,
    pub modified: Option<SystemTime>,
}

impl Stamp {
    pub fn of(meta: &fs::Metadata) -> Stamp {
        Stamp {
            len: meta.len(),
            modified: meta.modified().ok(),
        }
    }
}

#[derive(Debug, Default, Clone)]
pub struct Listing {
    pub files: BTreeMap<String, Stamp>,
}

impl Listing {
    pub fn notes(&self) -> impl Iterator<Item = &String> {
        self.files.keys().filter(|rel| rel.ends_with(".md"))
    }

    fn newest(&self) -> Option<SystemTime> {
        self.files.values().filter_map(|s| s.modified).max()
    }
}

pub fn list_vault(root: &Path) -> io::Result<Listing> {
    let mut listing = Listing::default();
    for (prefix, dir) in [("", root.to_path_buf()), ("trash/", root.join(TRASH_DIR))] {
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(e) if prefix.is_empty() => return Err(e),
            Err(_) => continue,
        };
        for entry in entries {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || !is_vault_file_name(&name) {
                continue;
            }
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if meta.is_file() {
                listing
                    .files
                    .insert(format!("{prefix}{name}"), Stamp::of(&meta));
            }
        }
    }
    Ok(listing)
}

#[derive(Debug, Default)]
pub struct Settled {
    seen: HashMap<String, Stamp>,
}

impl Settled {
    pub fn changed(&self, listing: &Listing) -> Vec<String> {
        let mut notes = BTreeSet::new();
        for (rel, stamp) in &listing.files {
            if self.seen.get(rel) == Some(stamp) {
                continue;
            }
            let note = match note_of_surface(rel) {
                Some((note, _)) => note,
                None => rel.clone(),
            };
            if listing.files.contains_key(&note) {
                notes.insert(note);
            }
        }
        notes.into_iter().collect()
    }

    pub fn settle(&mut self, listing: &Listing, note_rels: &[String]) {
        let Some(newest) = listing.newest() else {
            return;
        };
        for note in note_rels {
            let files = [
                note.clone(),
                surface_rel(note, CANVAS_EXT),
                surface_rel(note, SHEET_EXT),
            ];
            for rel in files {
                let Some(stamp) = listing.files.get(&rel) else {
                    continue;
                };
                let settled = stamp.modified.is_some_and(|m| m + SETTLE <= newest);
                if settled {
                    self.seen.insert(rel, *stamp);
                } else {
                    self.seen.remove(&rel);
                }
            }
        }
    }

    pub fn retain_listed(&mut self, listing: &Listing) {
        self.seen.retain(|rel, _| listing.files.contains_key(rel));
    }

    pub fn clear(&mut self) {
        self.seen.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stamp(len: u64, secs: u64) -> Stamp {
        Stamp {
            len,
            modified: Some(SystemTime::UNIX_EPOCH + Duration::from_secs(secs)),
        }
    }

    fn listing(files: &[(&str, Stamp)]) -> Listing {
        Listing {
            files: files.iter().map(|(r, s)| (r.to_string(), *s)).collect(),
        }
    }

    #[test]
    fn lists_note_and_surface_files_at_the_root_and_in_trash_only() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("trash")).unwrap();
        fs::create_dir_all(root.join("attachments")).unwrap();
        for f in [
            "a.md",
            "b.excalidraw",
            "c.csv",
            "notes.txt",
            ".a.md.tmp-1-2",
            "instantnotes.yaml",
            "trash/d.md",
            "attachments/e.md",
        ] {
            fs::write(root.join(f), "x").unwrap();
        }
        let l = list_vault(root).unwrap();
        assert_eq!(
            l.files.keys().collect::<Vec<_>>(),
            vec!["a.md", "b.excalidraw", "c.csv", "trash/d.md"]
        );
        assert!(!is_vault_root(&root.join("trash")));
        assert!(is_vault_root(root));
    }

    #[test]
    fn a_missing_root_is_an_error_and_a_missing_trash_is_not() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list_vault(&dir.path().join("gone")).is_err());
        assert!(list_vault(dir.path()).unwrap().files.is_empty());
    }

    #[test]
    fn everything_is_changed_until_settled_then_only_what_moved() {
        let mut settled = Settled::default();
        let first = listing(&[
            ("a.md", stamp(1, 100)),
            ("b.md", stamp(1, 100)),
            ("b.excalidraw", stamp(5, 100)),
            ("new.md", stamp(1, 200)),
        ]);
        let all = settled.changed(&first);
        assert_eq!(all, vec!["a.md", "b.md", "new.md"]);
        settled.settle(&first, &all);
        assert_eq!(settled.changed(&first), vec!["new.md"]);

        let next = listing(&[
            ("a.md", stamp(1, 100)),
            ("b.md", stamp(1, 100)),
            ("b.excalidraw", stamp(6, 100)),
            ("new.md", stamp(1, 200)),
        ]);
        assert_eq!(settled.changed(&next), vec!["b.md", "new.md"]);
    }

    #[test]
    fn a_surface_file_without_its_note_is_not_a_candidate() {
        let settled = Settled::default();
        let l = listing(&[("lonely.csv", stamp(1, 100))]);
        assert!(settled.changed(&l).is_empty());
    }

    #[test]
    fn retain_listed_forgets_files_that_left() {
        let mut settled = Settled::default();
        let l = listing(&[("a.md", stamp(1, 100)), ("z.md", stamp(1, 200))]);
        settled.settle(&l, &["a.md".to_string()]);
        settled.retain_listed(&listing(&[("z.md", stamp(1, 200))]));
        let back = listing(&[("a.md", stamp(1, 100)), ("z.md", stamp(1, 200))]);
        assert_eq!(settled.changed(&back), vec!["a.md", "z.md"]);
    }
}
