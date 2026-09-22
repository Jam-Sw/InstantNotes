//! Vault filenames (design.md §3.1). The filename is a label, not identity:
//! identity is the frontmatter `id`, so this only has to be readable and
//! collision-free, not stable across renames.

use std::collections::HashSet;

const INVALID: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

/// Strip characters that are illegal in a filename on any of Windows/macOS/
/// Linux, collapse the result to something non-empty, and trim trailing
/// dots/spaces (Windows rejects trailing dots).
fn sanitize(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| {
            if INVALID.contains(&c) || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches(['.', ' ']).trim();
    if trimmed.is_empty() {
        "Untitled".to_string()
    } else {
        trimmed.to_string()
    }
}

/// The key a filename occupies in a `taken` set. Case-folded because the
/// default filesystems on macOS (APFS) and Windows are case-insensitive:
/// "Notes.md" and "notes.md" are one file there, so they must collide here.
pub fn collision_key(name: &str) -> String {
    name.to_lowercase()
}

/// The `.md` filename for a note, unique against `taken` (the
/// `collision_key`s of names already assigned earlier in the same
/// export/flush pass). On collision, appends the first six characters of the
/// note's id; if even that is taken (a note literally titled that way), the
/// whole id, which is unique by construction.
pub fn note_filename(title: &str, id: &str, taken: &HashSet<String>) -> String {
    let base = sanitize(title);
    let short: String = id.chars().take(6).collect();
    [format!("{base}.md"), format!("{base}-{short}.md")]
        .into_iter()
        .find(|name| !taken.contains(&collision_key(name)))
        .unwrap_or_else(|| format!("{base}-{id}.md"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_spaces_and_case_as_written() {
        let taken = HashSet::new();
        assert_eq!(
            note_filename("Distributed Systems Notes", "id1", &taken),
            "Distributed Systems Notes.md"
        );
    }

    #[test]
    fn strips_path_separators_and_other_illegal_characters() {
        let taken = HashSet::new();
        assert_eq!(
            note_filename("Q1/Q2: Plan?", "id1", &taken),
            "Q1 Q2  Plan.md"
        );
    }

    #[test]
    fn empty_or_illegal_only_title_falls_back_to_untitled() {
        let taken = HashSet::new();
        assert_eq!(note_filename("", "id1", &taken), "Untitled.md");
        assert_eq!(note_filename("///", "id1", &taken), "Untitled.md");
    }

    #[test]
    fn trims_trailing_dots_and_spaces() {
        let taken = HashSet::new();
        assert_eq!(note_filename("Notes.  ", "id1", &taken), "Notes.md");
    }

    #[test]
    fn appends_id_prefix_on_collision() {
        let mut taken = HashSet::new();
        taken.insert(collision_key("Meeting Notes.md"));
        assert_eq!(
            note_filename("Meeting Notes", "018f6c3a-8b29", &taken),
            "Meeting Notes-018f6c.md"
        );
    }

    /// macOS (APFS) and Windows filesystems are case-insensitive by default,
    /// so "Notes.md" and "notes.md" are the same file there: the second
    /// write would silently replace the first.
    #[test]
    fn a_case_variant_title_counts_as_a_collision() {
        let mut taken = HashSet::new();
        taken.insert(collision_key("Notes.md"));
        assert_eq!(
            note_filename("notes", "abc123-rest", &taken),
            "notes-abc123.md"
        );
    }

    #[test]
    fn a_taken_suffixed_name_falls_back_to_the_full_id() {
        let mut taken = HashSet::new();
        taken.insert(collision_key("Notes.md"));
        // A note literally titled "Notes-abc123" already holds this name.
        taken.insert(collision_key("Notes-abc123.md"));
        assert_eq!(
            note_filename("Notes", "abc123-rest-of-uuid", &taken),
            "Notes-abc123-rest-of-uuid.md"
        );
    }
}
