use super::*;
use crate::classify::{self, Example, Features, Model, Params};
use std::collections::{HashMap, HashSet};

pub const DISMISSED_SETTING: &str = "graph.dismissed";

pub const TAG_SUGGEST_SETTING: &str = "suggest.tags";

struct Doc {
    id: String,
    title: String,
    features: Features,
    spaces: Vec<String>,
}

impl Store {
    pub fn space_suggestions(&self) -> Result<Vec<SpaceSuggestion>> {
        let params = Params::default();
        let docs = self.suggestion_docs(params)?;
        let spaces: HashMap<String, String> = self
            .query_rows("SELECT id, name FROM workspaces", |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?
            .into_iter()
            .collect();
        let examples: Vec<Example<'_>> = docs
            .iter()
            .filter(|d| !d.spaces.is_empty())
            .map(|d| Example {
                features: &d.features,
                classes: &d.spaces,
            })
            .collect();
        let model = Model::fit(&examples, params);
        if model.class_count() < 2 {
            return Ok(Vec::new());
        }
        let dismissed = self.dismissed_pairs()?;
        let mut out = Vec::new();
        for doc in docs.iter().filter(|d| d.spaces.is_empty()) {
            let Some(verdict) = model.classify(&doc.features) else {
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
        let setting = self.get_setting(TAG_SUGGEST_SETTING)?;
        let enabled = setting
            .as_ref()
            .and_then(|v| v.get("enabled"))
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        if !enabled {
            return Ok(None);
        }
        let params = Params {
            show_at: setting
                .as_ref()
                .and_then(|v| v.get("showAt"))
                .and_then(|v| v.as_f64())
                .map_or(Params::default().show_at, |at| at.clamp(0.3, 0.9)),
            ..Params::default()
        };
        let docs = self.suggestion_docs(params)?;
        let Some(target) = docs.iter().find(|d| d.id == note_id) else {
            return Ok(None);
        };
        let has: HashSet<&str> = tag_names(&target.features).collect();
        let taught: Vec<(Features, Vec<String>)> = docs
            .iter()
            .filter(|d| d.id != note_id)
            .map(|d| {
                let tags = tag_names(&d.features)
                    .filter(|t| !has.contains(t))
                    .map(str::to_string)
                    .collect::<Vec<_>>();
                (words(&d.features), tags)
            })
            .filter(|(_, tags)| !tags.is_empty())
            .collect();
        let examples: Vec<Example<'_>> = taught
            .iter()
            .map(|(features, classes)| Example { features, classes })
            .collect();
        let model = Model::fit(&examples, params);
        Ok(model
            .classify(&words(&target.features))
            .map(|v| TagSuggestion {
                tag: v.class,
                probability: v.probability,
                reasons: v.reasons,
            }))
    }

    pub fn dismiss_space_suggestion(&mut self, note_id: &str, space_id: &str) -> Result<()> {
        self.fetch_note(note_id)?;
        self.require_workspace(space_id)?;
        let mut map = self.pruned_dismissals()?;
        let entry = map
            .entry(note_id.to_string())
            .or_insert_with(|| serde_json::Value::Array(Vec::new()));
        let list = match entry.as_array_mut() {
            Some(list) => list,
            None => {
                *entry = serde_json::Value::Array(Vec::new());
                entry.as_array_mut().expect("just set")
            }
        };
        if !list.iter().any(|v| v.as_str() == Some(space_id)) {
            list.push(serde_json::Value::String(space_id.to_string()));
        }
        self.set_setting(DISMISSED_SETTING, serde_json::Value::Object(map))
    }

    pub fn restore_space_suggestion(&mut self, note_id: &str, space_id: &str) -> Result<()> {
        let mut map = self.pruned_dismissals()?;
        if let Some(list) = map.get_mut(note_id).and_then(|v| v.as_array_mut()) {
            list.retain(|v| v.as_str() != Some(space_id));
        }
        map.retain(|_, v| v.as_array().is_some_and(|l| !l.is_empty()));
        self.set_setting(DISMISSED_SETTING, serde_json::Value::Object(map))
    }

    pub(super) fn prune_space_dismissals(&mut self) -> Result<()> {
        let map = self.pruned_dismissals()?;
        self.set_setting(DISMISSED_SETTING, serde_json::Value::Object(map))
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

    fn pruned_dismissals(&self) -> Result<serde_json::Map<String, serde_json::Value>> {
        let notes: HashSet<String> = self
            .query_rows("SELECT id FROM notes", |r| r.get::<_, String>(0))?
            .into_iter()
            .collect();
        let spaces: HashSet<String> = self
            .query_rows("SELECT id FROM workspaces", |r| r.get::<_, String>(0))?
            .into_iter()
            .collect();
        let mut map: serde_json::Map<String, serde_json::Value> = self
            .get_setting(DISMISSED_SETTING)?
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        map.retain(|id, _| notes.contains(id));
        for value in map.values_mut() {
            let kept: Vec<serde_json::Value> = value
                .as_array()
                .into_iter()
                .flatten()
                .filter(|v| v.as_str().is_some_and(|id| spaces.contains(id)))
                .cloned()
                .collect();
            *value = serde_json::Value::Array(kept);
        }
        map.retain(|_, v| v.as_array().is_some_and(|l| !l.is_empty()));
        Ok(map)
    }

    fn dismissed_pairs(&self) -> Result<HashSet<(String, String)>> {
        let mut out = HashSet::new();
        let Some(value) = self.get_setting(DISMISSED_SETTING)? else {
            return Ok(out);
        };
        if let Some(map) = value.as_object() {
            for (note_id, spaces) in map {
                for space in spaces.as_array().into_iter().flatten() {
                    if let Some(space_id) = space.as_str() {
                        out.insert((note_id.clone(), space_id.to_string()));
                    }
                }
            }
        }
        Ok(out)
    }

    fn suggestion_docs(&self, params: Params) -> Result<Vec<Doc>> {
        const LIVE: &str = "n.is_deleted = 0 AND n.is_archived = 0";
        let rows = self.query_rows(
            &format!(
                "SELECT n.id, n.title, n.body FROM notes n \
                 WHERE {LIVE} ORDER BY n.updated_at DESC, n.id"
            ),
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            },
        )?;
        let index: HashMap<String, usize> = rows
            .iter()
            .enumerate()
            .map(|(i, (id, _, _))| (id.clone(), i))
            .collect();
        let mut tags: Vec<Vec<(String, String)>> = vec![Vec::new(); rows.len()];
        for (note_id, name, source) in self.query_rows(
            &format!(
                "SELECT e.note_id, t.name, e.source FROM note_tags e \
                 JOIN tags t ON t.id = e.tag_id \
                 JOIN notes n ON n.id = e.note_id WHERE {LIVE}"
            ),
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            },
        )? {
            if let Some(&i) = index.get(&note_id) {
                tags[i].push((name, source));
            }
        }
        let mut spaces: Vec<Vec<String>> = vec![Vec::new(); rows.len()];
        for (note_id, space_id) in self.query_rows(
            &format!(
                "SELECT e.note_id, e.workspace_id FROM note_workspaces e \
                 JOIN notes n ON n.id = e.note_id WHERE {LIVE}"
            ),
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )? {
            if let Some(&i) = index.get(&note_id) {
                spaces[i].push(space_id);
            }
        }
        Ok(rows
            .into_iter()
            .zip(tags)
            .zip(spaces)
            .map(|(((id, title, body), tags), spaces)| Doc {
                features: classify::features(&format!("{title}\n{body}"), &tags, params),
                id,
                title,
                spaces,
            })
            .collect())
    }
}

fn tag_names(features: &Features) -> impl Iterator<Item = &str> {
    features.keys().filter_map(|f| f.strip_prefix('#'))
}

fn words(features: &Features) -> Features {
    features
        .iter()
        .filter(|(f, _)| !f.starts_with('#'))
        .map(|(f, w)| (f.clone(), *w))
        .collect()
}
