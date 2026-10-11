use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ManifestTag {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub color: Option<String>,
    pub created: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ManifestSpace {
    pub name: String,
    pub created: String,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Manifest {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub tags: BTreeMap<String, ManifestTag>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub spaces: Vec<ManifestSpace>,
}

pub fn serialize_manifest(m: &Manifest) -> String {
    serde_norway::to_string(m).expect("Manifest has no maps with non-string keys")
}

pub fn parse_manifest(text: &str) -> Result<Manifest, serde_norway::Error> {
    serde_norway::from_str(text)
}

pub fn merge_manifest(base: Option<&Manifest>, ours: &Manifest, theirs: &Manifest) -> Manifest {
    let mut merged = Manifest::default();
    let names = ours.tags.keys().chain(theirs.tags.keys());
    for name in names {
        if merged.tags.contains_key(name) {
            continue;
        }
        let known = base.and_then(|b| b.tags.get(name));
        let tag = match (ours.tags.get(name), theirs.tags.get(name)) {
            (Some(o), Some(t)) => {
                let color = match known {
                    Some(b) if o.color == b.color => t.color.clone(),
                    Some(_) => o.color.clone(),
                    None => o.color.clone().or_else(|| t.color.clone()),
                };
                Some(ManifestTag {
                    color,
                    created: o.created.clone(),
                })
            }
            (Some(o), None) => known.is_none().then(|| o.clone()),
            (None, Some(t)) => known.is_none().then(|| t.clone()),
            (None, None) => None,
        };
        if let Some(tag) = tag {
            merged.tags.insert(name.clone(), tag);
        }
    }

    let key = |s: &ManifestSpace| s.name.to_lowercase();
    let find = |list: &[ManifestSpace], k: &str| list.iter().find(|s| key(s) == k).cloned();
    let mut seen = std::collections::HashSet::new();
    for space in ours.spaces.iter().chain(theirs.spaces.iter()) {
        let k = key(space);
        if !seen.insert(k.clone()) {
            continue;
        }
        let known = base.is_some_and(|b| find(&b.spaces, &k).is_some());
        let kept = match (find(&ours.spaces, &k), find(&theirs.spaces, &k)) {
            (Some(o), Some(_)) => Some(o),
            (Some(o), None) => (!known).then_some(o),
            (None, Some(t)) => (!known).then_some(t),
            (None, None) => None,
        };
        merged.spaces.extend(kept);
    }
    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tag(color: Option<&str>) -> ManifestTag {
        ManifestTag {
            color: color.map(str::to_string),
            created: "2026-01-01T00:00:00.000000Z".to_string(),
        }
    }

    fn manifest(tags: &[(&str, Option<&str>)], spaces: &[&str]) -> Manifest {
        Manifest {
            tags: tags.iter().map(|(n, c)| (n.to_string(), tag(*c))).collect(),
            spaces: spaces
                .iter()
                .map(|n| ManifestSpace {
                    name: n.to_string(),
                    created: "2026-01-01T00:00:00.000000Z".to_string(),
                })
                .collect(),
        }
    }

    fn space_names(m: &Manifest) -> Vec<String> {
        let mut names: Vec<String> = m.spaces.iter().map(|s| s.name.clone()).collect();
        names.sort();
        names
    }

    #[test]
    fn a_first_merge_takes_the_union_and_never_removes() {
        let ours = manifest(&[("work", None), ("mine", Some("#111"))], &["Home"]);
        let theirs = manifest(&[("work", Some("#f00")), ("theirs", None)], &["Lab"]);
        let merged = merge_manifest(None, &ours, &theirs);
        assert_eq!(
            merged.tags.keys().collect::<Vec<_>>(),
            vec!["mine", "theirs", "work"]
        );
        assert_eq!(merged.tags["work"].color.as_deref(), Some("#f00"));
        assert_eq!(merged.tags["mine"].color.as_deref(), Some("#111"));
        assert_eq!(space_names(&merged), vec!["Home", "Lab"]);
    }

    #[test]
    fn each_side_keeps_its_own_additions_and_removals() {
        let base = manifest(&[("a", None), ("b", None)], &["Old", "Both"]);
        let ours = manifest(
            &[("a", None), ("b", None), ("new-here", None)],
            &["Old", "Both"],
        );
        let theirs = manifest(&[("b", None), ("new-there", None)], &["Both", "Fresh"]);
        let merged = merge_manifest(Some(&base), &ours, &theirs);
        assert_eq!(
            merged.tags.keys().collect::<Vec<_>>(),
            vec!["b", "new-here", "new-there"]
        );
        assert_eq!(space_names(&merged), vec!["Both", "Fresh"]);

        let ours_removed = manifest(&[("b", None)], &["Both"]);
        let theirs_kept = base.clone();
        let merged = merge_manifest(Some(&base), &ours_removed, &theirs_kept);
        assert_eq!(merged.tags.keys().collect::<Vec<_>>(), vec!["b"]);
        assert_eq!(space_names(&merged), vec!["Both"]);
    }

    #[test]
    fn a_color_changed_on_one_side_wins_and_a_local_change_beats_a_remote_one() {
        let base = manifest(&[("t", Some("#000")), ("u", Some("#000"))], &[]);
        let ours = manifest(&[("t", Some("#000")), ("u", Some("#0f0"))], &[]);
        let theirs = manifest(&[("t", Some("#f00")), ("u", Some("#00f"))], &[]);
        let merged = merge_manifest(Some(&base), &ours, &theirs);
        assert_eq!(merged.tags["t"].color.as_deref(), Some("#f00"));
        assert_eq!(merged.tags["u"].color.as_deref(), Some("#0f0"));
    }

    #[test]
    fn spaces_match_without_regard_to_case() {
        let ours = manifest(&[], &["Work"]);
        let theirs = manifest(&[], &["work"]);
        let merged = merge_manifest(None, &ours, &theirs);
        assert_eq!(space_names(&merged), vec!["Work"]);
    }

    #[test]
    fn empty_manifest_round_trips() {
        let m = Manifest::default();
        let text = serialize_manifest(&m);
        assert_eq!(parse_manifest(&text).unwrap(), m);
    }

    #[test]
    fn round_trips_tags_and_spaces() {
        let mut m = Manifest::default();
        m.tags.insert(
            "consensus".to_string(),
            ManifestTag {
                color: Some("#7aa2f7".to_string()),
                created: "2026-07-02T09:14:00.000000Z".to_string(),
            },
        );
        m.tags.insert(
            "no-color".to_string(),
            ManifestTag {
                color: None,
                created: "2026-07-02T09:14:00.000000Z".to_string(),
            },
        );
        m.spaces.push(ManifestSpace {
            name: "Engineering".to_string(),
            created: "2026-07-02T09:10:00.000000Z".to_string(),
        });
        let text = serialize_manifest(&m);
        assert_eq!(parse_manifest(&text).unwrap(), m);
    }

    #[test]
    fn tags_serialize_sorted_by_name_for_stable_diffs() {
        let mut m = Manifest::default();
        for name in ["zebra", "alpha", "mid"] {
            m.tags.insert(
                name.to_string(),
                ManifestTag {
                    color: None,
                    created: "2026-01-01T00:00:00.000000Z".to_string(),
                },
            );
        }
        let text = serialize_manifest(&m);
        let alpha = text.find("alpha").unwrap();
        let mid = text.find("mid").unwrap();
        let zebra = text.find("zebra").unwrap();
        assert!(alpha < mid && mid < zebra, "tags not sorted:\n{text}");
    }

    #[test]
    fn an_empty_space_survives_the_round_trip() {
        let mut m = Manifest::default();
        m.spaces.push(ManifestSpace {
            name: "Someday".to_string(),
            created: "2026-01-01T00:00:00.000000Z".to_string(),
        });
        let text = serialize_manifest(&m);
        assert_eq!(parse_manifest(&text).unwrap().spaces.len(), 1);
    }
}
