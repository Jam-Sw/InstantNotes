use std::collections::HashSet;

const INVALID: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

const MAX_BASE_BYTES: usize = 150;

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
    let mut end = cleaned.len().min(MAX_BASE_BYTES);
    while !cleaned.is_char_boundary(end) {
        end -= 1;
    }
    let trimmed = cleaned[..end].trim().trim_end_matches(['.', ' ']).trim();
    if trimmed.is_empty() {
        "Untitled".to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn collision_key(name: &str) -> String {
    name.to_lowercase()
}

pub fn candidate_filenames(title: &str, id: &str) -> [String; 3] {
    let base = sanitize(title);
    let short: String = id.chars().take(6).collect();
    [
        format!("{base}.md"),
        format!("{base}-{short}.md"),
        format!("{base}-{id}.md"),
    ]
}

pub fn note_filename(title: &str, id: &str, taken: &HashSet<String>) -> String {
    let [plain, short, full] = candidate_filenames(title, id);
    [plain, short]
        .into_iter()
        .find(|name| !taken.contains(&collision_key(name)))
        .unwrap_or(full)
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
    fn a_very_long_title_still_fits_a_filename_with_its_temp_suffix() {
        let title = "é".repeat(300);
        let id = "018f6c3a-8b29-7c10-9824-3a2e1d0f5b6a";
        for name in candidate_filenames(&title, id) {
            let temp_name = format!(".{name}.tmp-4294967295-18446744073709551615");
            assert!(temp_name.len() <= 255, "{} bytes: {name}", temp_name.len());
            assert!(name.starts_with("éé"));
        }
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
        taken.insert(collision_key("Notes-abc123.md"));
        assert_eq!(
            note_filename("Notes", "abc123-rest-of-uuid", &taken),
            "Notes-abc123-rest-of-uuid.md"
        );
    }
}
