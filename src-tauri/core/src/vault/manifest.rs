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

#[cfg(test)]
mod tests {
    use super::*;

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
