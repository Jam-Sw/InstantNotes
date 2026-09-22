//! `VaultNote` -> Markdown + YAML frontmatter. Every field is omitted when
//! it equals its default, per design.md §3.2: frontmatter noise defeats the
//! point of the format being human-readable.

use super::{Frontmatter, VaultNote};

pub fn serialize_note(note: &VaultNote) -> String {
    let frontmatter = Frontmatter {
        id: note.id.clone(),
        created: note.created_at.clone(),
        updated: note.updated_at.clone(),
        title: note.title.clone(),
        pinned: note.is_pinned,
        archived: note.is_archived,
        deleted: note.deleted_at.clone(),
        tags: note.tags.clone(),
        spaces: note.spaces.clone(),
    };
    let yaml = serde_norway::to_string(&frontmatter)
        .expect("Frontmatter has no maps with non-string keys and cannot fail to serialize");
    format!("---\n{yaml}---\n{}", note.body)
}
