//! The vault format: a note as Markdown + YAML frontmatter, and back.
//! This file holds the pure format; `write` and `export` do the filesystem
//! I/O, and the stage 2 flush lives on `Store` (`store/vault.rs`). Design: openspec/changes/feat-portable-vault-sync/design.md §3.2.

pub mod export;
pub mod manifest;
pub mod mirror;
pub mod naming;
pub mod parse;
pub mod serialize;
pub mod write;

pub use export::{collect_from_store, export_vault};
pub use manifest::{parse_manifest, serialize_manifest, Manifest, ManifestSpace, ManifestTag};
pub use mirror::{check_vault_location, is_within, FlushOutcome, VaultReport, VaultStatus};
pub use naming::{candidate_filenames, collision_key, note_filename};
pub use parse::{parse_note, ParseError};
pub use serialize::serialize_note;
pub use write::{atomic_write, copy_dir_recursive, copy_missing_files};

use serde::{Deserialize, Serialize};

/// The YAML frontmatter shape, shared by the serializer and the parser so
/// the two can never drift out of step with each other.
#[derive(Serialize, Deserialize)]
struct Frontmatter {
    id: String,
    created: String,
    updated: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    title: Option<String>,
    #[serde(skip_serializing_if = "is_false", default)]
    pinned: bool,
    #[serde(skip_serializing_if = "is_false", default)]
    archived: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    deleted: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    tags: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    spaces: Vec<String>,
}

fn is_false(b: &bool) -> bool {
    !*b
}

/// A note in the shape the vault format carries. Deliberately narrower than
/// `types::Note`: `last_opened_at` is device-local and never written to the
/// vault (design.md §7.2), and `is_deleted` is implied by `deleted_at` (the
/// store keeps them in lockstep) plus, from stage 2 on, by the note's
/// location under `trash/` rather than by a frontmatter field.
///
/// `title: None` means the title is auto-derived from the body (design.md
/// §3.2). This replaces a separate `title_is_auto` bool so the type can't
/// represent the contradictory state of a bool and a string disagreeing.
#[derive(Debug, Clone, PartialEq)]
pub struct VaultNote {
    pub id: String,
    pub title: Option<String>,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
    pub is_pinned: bool,
    pub is_archived: bool,
    pub deleted_at: Option<String>,
    pub tags: Vec<String>,
    pub spaces: Vec<String>,
}

#[cfg(test)]
mod round_trip_tests {
    use super::*;

    fn base(id: &str) -> VaultNote {
        VaultNote {
            id: id.to_string(),
            title: None,
            body: "hello world".to_string(),
            created_at: "2026-09-03T19:00:00.000000Z".to_string(),
            updated_at: "2026-09-03T19:15:00.000000Z".to_string(),
            is_pinned: false,
            is_archived: false,
            deleted_at: None,
            tags: Vec::new(),
            spaces: Vec::new(),
        }
    }

    /// Every combination of the boolean/optional fields, plus edge-case
    /// strings, round-trips exactly through serialize -> parse.
    #[test]
    fn round_trips_every_flag_combination() {
        for pinned in [false, true] {
            for archived in [false, true] {
                for title in [None, Some("Consensus Protocols".to_string())] {
                    for deleted_at in [None, Some("2026-09-04T00:00:00.000000Z".to_string())] {
                        for tags in [
                            Vec::<String>::new(),
                            vec!["distributed-systems".to_string(), "consensus".to_string()],
                        ] {
                            for spaces in [Vec::<String>::new(), vec!["Engineering".to_string()]] {
                                let mut n = base("018f6c3a-8b29-7c10-9824-3a2e1d0f5b6a");
                                n.is_pinned = pinned;
                                n.is_archived = archived;
                                n.title = title.clone();
                                n.deleted_at = deleted_at.clone();
                                n.tags = tags.clone();
                                n.spaces = spaces.clone();

                                let text = serialize_note(&n);
                                let parsed = parse_note(&text).unwrap_or_else(|e| {
                                    panic!("failed to parse own output: {e}\n---\n{text}")
                                });
                                assert_eq!(parsed, n, "round trip mismatch for:\n{text}");
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn round_trips_multiline_body_containing_a_literal_thematic_break() {
        let mut n = base("id-1");
        n.body = "# Title\n\nabove\n\n---\n\nbelow the horizontal rule".to_string();
        let text = serialize_note(&n);
        let parsed = parse_note(&text).unwrap();
        assert_eq!(parsed, n);
    }

    #[test]
    fn round_trips_yaml_hostile_characters_in_title_and_tags() {
        let mut n = base("id-2");
        n.title = Some("Meeting: 3pm - \"quoted\", #hash, [brackets]".to_string());
        n.tags = vec!["c++".to_string(), "a:b".to_string()];
        n.spaces = vec!["R&D".to_string()];
        let text = serialize_note(&n);
        let parsed = parse_note(&text).unwrap();
        assert_eq!(parsed, n);
    }

    #[test]
    fn round_trips_empty_body() {
        let mut n = base("id-3");
        n.body = String::new();
        let text = serialize_note(&n);
        let parsed = parse_note(&text).unwrap();
        assert_eq!(parsed, n);
    }

    #[test]
    fn round_trips_unicode_title_and_body() {
        let mut n = base("id-4");
        n.title = Some("Café ☕ notes — 日本語".to_string());
        n.body = "Body with emoji 🎉 and accents: café, naïve".to_string();
        let text = serialize_note(&n);
        let parsed = parse_note(&text).unwrap();
        assert_eq!(parsed, n);
    }

    #[test]
    fn a_plain_note_serializes_with_only_id_created_updated() {
        let n = base("018f6c3a-8b29-7c10-9824-3a2e1d0f5b6a");
        let text = serialize_note(&n);
        assert_eq!(
            text,
            "---\nid: 018f6c3a-8b29-7c10-9824-3a2e1d0f5b6a\ncreated: 2026-09-03T19:00:00.000000Z\nupdated: 2026-09-03T19:15:00.000000Z\n---\nhello world"
        );
    }

    #[test]
    fn missing_frontmatter_delimiter_is_a_clear_error() {
        let err = parse_note("just a plain markdown file\nwith no frontmatter").unwrap_err();
        assert!(matches!(err, ParseError::MissingFrontmatter));
    }

    #[test]
    fn unterminated_frontmatter_is_a_clear_error() {
        let err = parse_note("---\nid: x\ncreated: y\nupdated: z\nbody with no closing delimiter")
            .unwrap_err();
        assert!(matches!(err, ParseError::UnterminatedFrontmatter));
    }

    #[test]
    fn unknown_frontmatter_keys_are_ignored() {
        let text = "---\nid: id-5\ncreated: c\nupdated: u\nfuture_field: something\n---\nbody";
        let parsed = parse_note(text).unwrap();
        assert_eq!(parsed.id, "id-5");
    }

    #[test]
    fn missing_required_key_is_a_clear_error() {
        let text = "---\ncreated: c\nupdated: u\n---\nbody";
        let err = parse_note(text).unwrap_err();
        assert!(matches!(err, ParseError::Yaml(_)));
    }
}
