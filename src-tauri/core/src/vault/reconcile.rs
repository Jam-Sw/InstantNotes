use super::surface::same_surface;
use super::VaultNote;
use crate::domain;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Local,
    Remote,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Skip,
    Insert,
    Unchanged,
    Same,
    Take,
    Fork(Side),
}

#[derive(Debug, Clone, Copy)]
pub struct Synced<'a> {
    pub sha: Option<&'a str>,
    pub surface_sha: Option<&'a str>,
    pub dirty: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct Remote<'a> {
    pub note: &'a VaultNote,
    pub sha: &'a str,
    pub surface_sha: Option<&'a str>,
}

pub fn decide(
    local: Option<(&VaultNote, Synced<'_>)>,
    remote: Remote<'_>,
    tombstoned: bool,
) -> Decision {
    let Some((note, synced)) = local else {
        return if tombstoned {
            Decision::Skip
        } else {
            Decision::Insert
        };
    };
    if synced.sha == Some(remote.sha) && synced.surface_sha == remote.surface_sha {
        return Decision::Unchanged;
    }
    if equivalent(note, remote.note) {
        return Decision::Same;
    }
    match (synced.sha.is_some(), synced.dirty) {
        (true, false) => Decision::Take,
        (true, true) => Decision::Fork(Side::Local),
        (false, false) if !older(&remote.note.updated_at, &note.updated_at) => Decision::Take,
        (false, _) if older(&note.updated_at, &remote.note.updated_at) => {
            Decision::Fork(Side::Remote)
        }
        (false, _) => Decision::Fork(Side::Local),
    }
}

fn older(a: &str, b: &str) -> bool {
    match (
        chrono::DateTime::parse_from_rfc3339(a),
        chrono::DateTime::parse_from_rfc3339(b),
    ) {
        (Ok(a), Ok(b)) => a < b,
        _ => a < b,
    }
}

pub fn equivalent(a: &VaultNote, b: &VaultNote) -> bool {
    let tags = |n: &VaultNote| -> BTreeSet<String> {
        n.tags
            .iter()
            .filter_map(|t| domain::normalize_tag_name(t))
            .collect()
    };
    let spaces = |n: &VaultNote| -> BTreeSet<String> {
        n.spaces.iter().map(|s| s.trim().to_lowercase()).collect()
    };
    let surface = match (&a.surface, &b.surface) {
        (Some(x), Some(y)) => same_surface(&a.kind, x, y),
        (None, None) => true,
        _ => false,
    };
    a.title == b.title
        && a.body == b.body
        && a.is_pinned == b.is_pinned
        && a.is_archived == b.is_archived
        && a.deleted_at.is_some() == b.deleted_at.is_some()
        && a.kind == b.kind
        && tags(a) == tags(b)
        && spaces(a) == spaces(b)
        && surface
}

pub fn derived_id(parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part.as_bytes());
        hasher.update([0]);
    }
    let digest = hasher.finalize();
    let mut b = [0u8; 16];
    b.copy_from_slice(&digest[..16]);
    b[6] = (b[6] & 0x0f) | 0x80;
    b[8] = (b[8] & 0x3f) | 0x80;
    let hex: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

pub fn conflict_title(title: &str, stamp: &str) -> String {
    format!("{} (conflict {stamp})", title.trim())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::CONTENT_KIND_DOCUMENT;

    fn note(body: &str, updated: &str) -> VaultNote {
        VaultNote {
            id: "n".into(),
            title: None,
            body: body.into(),
            created_at: "2026-10-01T00:00:00.000000Z".into(),
            updated_at: updated.into(),
            is_pinned: false,
            is_archived: false,
            deleted_at: None,
            tags: vec![],
            spaces: vec![],
            kind: CONTENT_KIND_DOCUMENT.into(),
            surface: None,
        }
    }

    const EARLY: &str = "2026-10-02T00:00:00.000000Z";
    const LATE: &str = "2026-10-03T00:00:00.000000Z";

    fn synced(sha: Option<&str>, dirty: bool) -> Synced<'_> {
        Synced {
            sha,
            surface_sha: None,
            dirty,
        }
    }

    fn remote<'a>(n: &'a VaultNote, sha: &'a str) -> Remote<'a> {
        Remote {
            note: n,
            sha,
            surface_sha: None,
        }
    }

    #[test]
    fn rule_1_a_file_waiting_for_its_destroy_is_skipped() {
        let theirs = note("x", EARLY);
        assert_eq!(decide(None, remote(&theirs, "s"), true), Decision::Skip);
    }

    #[test]
    fn rule_2_an_unknown_id_is_inserted() {
        let theirs = note("x", EARLY);
        assert_eq!(decide(None, remote(&theirs, "s"), false), Decision::Insert);
    }

    #[test]
    fn rule_3_the_bytes_last_synced_are_unchanged_even_when_dirty() {
        let ours = note("edited here", LATE);
        let theirs = note("x", EARLY);
        let d = decide(
            Some((&ours, synced(Some("s"), true))),
            remote(&theirs, "s"),
            false,
        );
        assert_eq!(d, Decision::Unchanged);
    }

    #[test]
    fn rule_3_needs_the_surface_file_unchanged_too() {
        let ours = note("x", EARLY);
        let theirs = note("y", EARLY);
        let base = Synced {
            sha: Some("s"),
            surface_sha: Some("c1"),
            dirty: false,
        };
        let r = Remote {
            note: &theirs,
            sha: "s",
            surface_sha: Some("c2"),
        };
        assert_eq!(decide(Some((&ours, base)), r, false), Decision::Take);
    }

    #[test]
    fn rule_4_equivalent_versions_are_the_same_whatever_their_times() {
        let ours = note("x", EARLY);
        let theirs = note("x", LATE);
        for base in [
            synced(Some("old"), true),
            synced(None, false),
            synced(None, true),
        ] {
            assert_eq!(
                decide(Some((&ours, base)), remote(&theirs, "new"), false),
                Decision::Same
            );
        }
    }

    #[test]
    fn rule_5_a_clean_note_takes_the_remote_edit() {
        let ours = note("x", LATE);
        let theirs = note("y", EARLY);
        let d = decide(
            Some((&ours, synced(Some("old"), false))),
            remote(&theirs, "new"),
            false,
        );
        assert_eq!(d, Decision::Take);
    }

    #[test]
    fn rule_6_an_edit_on_both_sides_keeps_local_and_copies_remote() {
        let ours = note("x", EARLY);
        let theirs = note("y", LATE);
        let d = decide(
            Some((&ours, synced(Some("old"), true))),
            remote(&theirs, "new"),
            false,
        );
        assert_eq!(d, Decision::Fork(Side::Local));
    }

    #[test]
    fn rule_7_with_no_base_a_clean_note_takes_a_version_not_older() {
        let ours = note("x", EARLY);
        let newer = note("y", LATE);
        let same_time = note("y", EARLY);
        for theirs in [&newer, &same_time] {
            let d = decide(
                Some((&ours, synced(None, false))),
                remote(theirs, "s"),
                false,
            );
            assert_eq!(d, Decision::Take);
        }
    }

    #[test]
    fn rule_8_with_no_base_the_newer_side_keeps_the_note() {
        let older = note("x", EARLY);
        let newer = note("y", LATE);
        let d = decide(
            Some((&older, synced(None, true))),
            remote(&newer, "s"),
            false,
        );
        assert_eq!(d, Decision::Fork(Side::Remote));
        let d = decide(
            Some((&newer, synced(None, false))),
            remote(&older, "s"),
            false,
        );
        assert_eq!(d, Decision::Fork(Side::Local));
        let tie = note("z", LATE);
        let d = decide(Some((&newer, synced(None, true))), remote(&tie, "s"), false);
        assert_eq!(d, Decision::Fork(Side::Local));
    }

    #[test]
    fn equivalence_ignores_order_case_and_timestamps_but_not_content() {
        let mut a = note("x", EARLY);
        a.tags = vec!["Work".into(), "idea".into()];
        a.spaces = vec!["Lab".into(), "Home".into()];
        let mut b = note("x", LATE);
        b.tags = vec!["idea".into(), "work".into()];
        b.spaces = vec!["home".into(), "lab".into()];
        b.created_at = LATE.into();
        assert!(equivalent(&a, &b));
        b.deleted_at = Some(LATE.into());
        assert!(!equivalent(&a, &b));
        a.deleted_at = Some(EARLY.into());
        assert!(equivalent(&a, &b));
        b.is_pinned = true;
        assert!(!equivalent(&a, &b));
    }

    #[test]
    fn a_derived_id_is_a_stable_uuid_shape() {
        let id = derived_id(&["a", "b"]);
        assert_eq!(id, derived_id(&["a", "b"]));
        assert_ne!(id, derived_id(&["ab"]));
        assert_eq!(id.len(), 36);
        assert_eq!(id.as_bytes()[14], b'8');
        assert!(uuid::Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn a_conflict_title_names_its_moment() {
        assert_eq!(
            conflict_title(" Plan ", "2026-10-07 14:03"),
            "Plan (conflict 2026-10-07 14:03)"
        );
    }
}
