use super::corpus::Doc;
use super::*;
use crate::classify::{Example, Features, Model, Params};
use std::collections::{HashMap, HashSet};

pub const DISMISSED_SETTING: &str = "graph.dismissed";

pub const TAG_SUGGEST_SETTING: &str = "suggest.tags";

pub(super) enum DismissedValues {
    Notes,
    Workspaces,
}

pub(super) struct Dismissals {
    pub(super) setting: &'static str,
    pub(super) values: DismissedValues,
}

const SPACE_DISMISSALS: Dismissals = Dismissals {
    setting: DISMISSED_SETTING,
    values: DismissedValues::Workspaces,
};

impl Store {
    pub fn space_suggestions(&self) -> Result<Vec<SpaceSuggestion>> {
        let params = Params::default();
        let corpus = self.corpus()?;
        let features: Vec<Features> = corpus.docs.iter().map(Doc::feature_map).collect();
        let spaces: HashMap<String, String> = self
            .query_rows("SELECT id, name FROM workspaces", |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?
            .into_iter()
            .collect();
        let examples: Vec<Example<'_>> = corpus
            .docs
            .iter()
            .zip(&features)
            .filter(|(d, _)| !d.spaces.is_empty())
            .map(|(d, features)| Example {
                features,
                classes: &d.spaces,
            })
            .collect();
        let model = Model::fit(&examples, params);
        if model.class_count() < 2 {
            return Ok(Vec::new());
        }
        let dismissed = self.dismissed_pairs(&SPACE_DISMISSALS)?;
        let mut out = Vec::new();
        for (doc, features) in corpus
            .docs
            .iter()
            .zip(&features)
            .filter(|(d, _)| d.spaces.is_empty())
        {
            let Some(verdict) = model.classify(features) else {
                continue;
            };
            if dismissed.contains(&(doc.id.clone(), verdict.class.clone())) {
                continue;
            }
            let Some(space_name) = spaces.get(&verdict.class) else {
                continue;
            };
            out.push(SpaceSuggestion {
                note_id: doc.id.clone(),
                note_title: doc.title.clone(),
                space_id: verdict.class,
                space_name: space_name.clone(),
                probability: verdict.probability,
                reasons: verdict
                    .reasons
                    .into_iter()
                    .map(|f| SuggestionReason {
                        kind: if f.starts_with('#') { "tag" } else { "word" }.to_string(),
                        label: f,
                    })
                    .collect(),
            });
        }
        Ok(out)
    }

    pub fn tag_suggestion(&self, note_id: &str) -> Result<Option<TagSuggestion>> {
        let Some(show_at) = self.suggest_threshold(TAG_SUGGEST_SETTING)? else {
            return Ok(None);
        };
        let params = Params {
            show_at,
            ..Params::default()
        };
        let corpus = self.corpus()?;
        let Some(target) = corpus.docs.iter().find(|d| d.id == note_id) else {
            return Ok(None);
        };
        let has: HashSet<&str> = target.tags().collect();
        let taught: Vec<(&Features, Vec<String>)> = corpus
            .docs
            .iter()
            .filter(|d| d.id != note_id)
            .map(|d| {
                let tags = d
                    .tags()
                    .filter(|t| !has.contains(t))
                    .map(str::to_string)
                    .collect::<Vec<_>>();
                (&*d.words, tags)
            })
            .filter(|(_, tags)| !tags.is_empty())
            .collect();
        let examples: Vec<Example<'_>> = taught
            .iter()
            .map(|(features, classes)| Example { features, classes })
            .collect();
        let model = Model::fit(&examples, params);
        Ok(model.classify(&target.words).map(|v| TagSuggestion {
            tag: v.class,
            probability: v.probability,
            reasons: v.reasons,
        }))
    }

    pub fn dismiss_space_suggestion(&mut self, note_id: &str, space_id: &str) -> Result<()> {
        self.fetch_note(note_id)?;
        self.require_workspace(space_id)?;
        self.dismiss_pair(&SPACE_DISMISSALS, note_id, space_id)
    }

    pub fn restore_space_suggestion(&mut self, note_id: &str, space_id: &str) -> Result<()> {
        self.restore_pair(&SPACE_DISMISSALS, note_id, space_id)
    }

    pub(super) fn prune_space_dismissals(&mut self) -> Result<()> {
        let map = self.pruned_dismissals(&SPACE_DISMISSALS)?;
        self.set_setting(SPACE_DISMISSALS.setting, serde_json::Value::Object(map))
    }

    pub(super) fn suggest_threshold(&self, key: &str) -> Result<Option<f64>> {
        let setting = self.get_setting(key)?;
        let enabled = setting
            .as_ref()
            .and_then(|v| v.get("enabled"))
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        if !enabled {
            return Ok(None);
        }
        Ok(Some(
            setting
                .as_ref()
                .and_then(|v| v.get("showAt"))
                .and_then(|v| v.as_f64())
                .map_or(Params::default().show_at, |at| at.clamp(0.3, 0.9)),
        ))
    }

    fn require_workspace(&self, space_id: &str) -> Result<()> {
        let known: Option<String> = self
            .conn
            .query_row(
                "SELECT id FROM workspaces WHERE id = ?1",
                params![space_id],
                |r| r.get(0),
            )
            .optional()?;
        match known {
            Some(_) => Ok(()),
            None => Err(AppError::NotFound(format!(
                "workspace {space_id} not found"
            ))),
        }
    }

    pub(super) fn dismiss_pair(&mut self, d: &Dismissals, key: &str, value: &str) -> Result<()> {
        let mut map = self.pruned_dismissals(d)?;
        let entry = map
            .entry(key.to_string())
            .or_insert_with(|| serde_json::Value::Array(Vec::new()));
        if !entry.is_array() {
            *entry = serde_json::Value::Array(Vec::new());
        }
        if let Some(list) = entry.as_array_mut() {
            if !list.iter().any(|v| v.as_str() == Some(value)) {
                list.push(serde_json::Value::String(value.to_string()));
            }
        }
        self.set_setting(d.setting, serde_json::Value::Object(map))
    }

    pub(super) fn restore_pair(&mut self, d: &Dismissals, key: &str, value: &str) -> Result<()> {
        let mut map = self.pruned_dismissals(d)?;
        if let Some(list) = map.get_mut(key).and_then(|v| v.as_array_mut()) {
            list.retain(|v| v.as_str() != Some(value));
        }
        map.retain(|_, v| v.as_array().is_some_and(|l| !l.is_empty()));
        self.set_setting(d.setting, serde_json::Value::Object(map))
    }

    fn pruned_dismissals(
        &self,
        d: &Dismissals,
    ) -> Result<serde_json::Map<String, serde_json::Value>> {
        let notes: HashSet<String> = self
            .query_rows("SELECT id FROM notes", |r| r.get::<_, String>(0))?
            .into_iter()
            .collect();
        let values: HashSet<String> = match d.values {
            DismissedValues::Notes => notes.clone(),
            DismissedValues::Workspaces => self
                .query_rows("SELECT id FROM workspaces", |r| r.get::<_, String>(0))?
                .into_iter()
                .collect(),
        };
        let mut map: serde_json::Map<String, serde_json::Value> = self
            .get_setting(d.setting)?
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        map.retain(|id, _| notes.contains(id));
        for value in map.values_mut() {
            let kept: Vec<serde_json::Value> = value
                .as_array()
                .into_iter()
                .flatten()
                .filter(|v| v.as_str().is_some_and(|id| values.contains(id)))
                .cloned()
                .collect();
            *value = serde_json::Value::Array(kept);
        }
        map.retain(|_, v| v.as_array().is_some_and(|l| !l.is_empty()));
        Ok(map)
    }

    pub(super) fn dismissed_pairs(&self, d: &Dismissals) -> Result<HashSet<(String, String)>> {
        let mut out = HashSet::new();
        let Some(value) = self.get_setting(d.setting)? else {
            return Ok(out);
        };
        if let Some(map) = value.as_object() {
            for (key, values) in map {
                for value in values.as_array().into_iter().flatten() {
                    if let Some(value) = value.as_str() {
                        out.insert((key.clone(), value.to_string()));
                    }
                }
            }
        }
        Ok(out)
    }
}
