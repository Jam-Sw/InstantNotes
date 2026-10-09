pub mod export;
pub mod manifest;
pub mod mirror;
pub mod naming;
pub mod parse;
pub mod serialize;
pub mod surface;
pub mod write;

pub use export::{collect_from_store, export_vault};
pub use manifest::{parse_manifest, serialize_manifest, Manifest, ManifestSpace, ManifestTag};
pub use mirror::{check_vault_location, is_within, FlushOutcome, VaultReport, VaultStatus};
pub use naming::{candidate_filenames, collision_key, note_filename};
pub use parse::{parse_note, ParseError};
pub use serialize::serialize_note;
pub use surface::{
    canvas_file, is_vault_file_name, note_of_surface, same_canvas, same_surface, surface_ext,
    surface_file, surface_rel, CANVAS_EXT, SHEET_EXT,
};
pub use write::{atomic_write, copy_dir_recursive, copy_missing_files};

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct Frontmatter {
    id: String,
    created: String,
    updated: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    kind: Option<String>,
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
    pub kind: String,
    pub surface: Option<String>,
}

#[cfg(test)]
mod round_trip_tests {
    use super::*;
    use crate::types::{CONTENT_KIND_DOCUMENT, CONTENT_KIND_WHITEBOARD};

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
            kind: CONTENT_KIND_DOCUMENT.to_string(),
            surface: None,
        }
    }

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
    fn a_whiteboard_round_trips_its_kind() {
        let mut n = base("id-wb");
        n.kind = CONTENT_KIND_WHITEBOARD.to_string();
        let text = serialize_note(&n);
        assert!(text.contains("\nkind: whiteboard\n"), "{text}");
        assert_eq!(parse_note(&text).unwrap(), n);
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
