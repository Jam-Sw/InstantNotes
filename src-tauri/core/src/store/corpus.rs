use super::*;
use crate::classify::{self, Features, Params};
use rustc_hash::FxHashMap;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Default)]
pub(super) struct CorpusCache {
    words: FxHashMap<String, CachedWords>,
    word_df: Arc<FxHashMap<String, usize>>,
    built: Option<(i64, Arc<Corpus>)>,
}

struct CachedWords {
    title: String,
    updated_at: String,
    body_len: usize,
    words: Arc<Features>,
}

impl CorpusCache {
    fn learn(&mut self, words: &Features) {
        let df = Arc::make_mut(&mut self.word_df);
        for key in words.keys() {
            *df.entry(key.clone()).or_insert(0) += 1;
        }
    }

    fn forget(&mut self, words: &Features) {
        let df = Arc::make_mut(&mut self.word_df);
        for key in words.keys() {
            if let Some(count) = df.get_mut(key) {
                *count -= 1;
                if *count == 0 {
                    df.remove(key);
                }
            }
        }
    }
}

pub(super) struct Doc {
    pub(super) id: String,
    pub(super) title: String,
    pub(super) content_kind: String,
    pub(super) created_at: String,
    pub(super) updated_at: String,
    pub(super) last_opened_at: Option<String>,
    pub(super) body_len: usize,
    pub(super) words: Arc<Features>,
    tag_features: Vec<(String, f64)>,
    pub(super) spaces: Vec<String>,
}

impl Doc {
    pub(super) fn weight(&self, key: &str) -> Option<f64> {
        if key.starts_with('#') {
            self.tag_features
                .iter()
                .find(|(k, _)| k == key)
                .map(|(_, w)| *w)
        } else {
            self.words.get(key).copied()
        }
    }

    pub(super) fn features(&self) -> impl Iterator<Item = (&str, f64)> {
        self.words
            .iter()
            .map(|(k, w)| (k.as_str(), *w))
            .chain(self.tag_features.iter().map(|(k, w)| (k.as_str(), *w)))
    }

    pub(super) fn tags(&self) -> impl Iterator<Item = &str> {
        self.tag_features.iter().map(|(k, _)| &k[1..])
    }

    pub(super) fn feature_map(&self) -> Features {
        let mut out = (*self.words).clone();
        for (key, weight) in &self.tag_features {
            out.insert(key.clone(), *weight);
        }
        out
    }
}

struct NoteRow {
    id: String,
    title: String,
    content_kind: String,
    created_at: String,
    updated_at: String,
    last_opened_at: Option<String>,
    body_len: usize,
}

pub(super) struct Corpus {
    pub(super) docs: Vec<Doc>,
    word_df: Arc<FxHashMap<String, usize>>,
    tag_df: FxHashMap<String, usize>,
}

impl Corpus {
    pub(super) fn df(&self, key: &str) -> usize {
        let found = if key.starts_with('#') {
            self.tag_df.get(key)
        } else {
            self.word_df.get(key)
        };
        found.copied().unwrap_or(0).max(1)
    }
}

impl Store {
    fn corpus_key(&self) -> Result<Option<i64>> {
        let read_only: bool = self.conn.query_row("PRAGMA query_only", [], |r| r.get(0))?;
        if !read_only {
            return Ok(None);
        }
        Ok(Some(self.data_version()?))
    }

    pub(super) fn corpus(&self) -> Result<Arc<Corpus>> {
        const LIVE: &str = "n.is_deleted = 0 AND n.is_archived = 0";
        let key = self.corpus_key()?;
        if let Some(key) = key {
            if let Some((built_at, corpus)) = &self.suggest_corpus.borrow().built {
                if *built_at == key {
                    return Ok(Arc::clone(corpus));
                }
            }
        }
        let params = Params::default();
        let rows = self.query_rows(
            &format!(
                "SELECT n.id, n.title, n.content_kind, n.created_at, n.updated_at, \
                        n.last_opened_at, length(n.body) \
                 FROM notes n WHERE {LIVE} ORDER BY n.updated_at DESC, n.id"
            ),
            |r| {
                Ok(NoteRow {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    content_kind: r.get(2)?,
                    created_at: r.get(3)?,
                    updated_at: r.get(4)?,
                    last_opened_at: r.get(5)?,
                    body_len: r.get::<_, i64>(6)?.max(0) as usize,
                })
            },
        )?;
        let index: HashMap<String, usize> = rows
            .iter()
            .enumerate()
            .map(|(i, r)| (r.id.clone(), i))
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

        let mut cache = self.suggest_corpus.borrow_mut();
        let gone: Vec<String> = cache
            .words
            .keys()
            .filter(|id| !index.contains_key(*id))
            .cloned()
            .collect();
        for id in gone {
            if let Some(old) = cache.words.remove(&id) {
                cache.forget(&old.words);
            }
        }
        let mut body_stmt = self
            .conn
            .prepare_cached("SELECT body FROM notes WHERE id = ?1")?;
        for NoteRow {
            id,
            title,
            updated_at,
            body_len,
            ..
        } in &rows
        {
            let fresh = cache.words.get(id).is_some_and(|c| {
                c.updated_at == *updated_at && c.body_len == *body_len && c.title == *title
            });
            if fresh {
                continue;
            }
            let body: String = body_stmt
                .query_row(params![id], |r| r.get(0))
                .optional()?
                .unwrap_or_default();
            let words = Arc::new(classify::features(&format!("{title}\n{body}"), &[], params));
            cache.learn(&words);
            let replaced = cache.words.insert(
                id.clone(),
                CachedWords {
                    title: title.clone(),
                    updated_at: updated_at.clone(),
                    body_len: *body_len,
                    words,
                },
            );
            if let Some(old) = replaced {
                cache.forget(&old.words);
            }
        }

        let mut tag_df: FxHashMap<String, usize> = FxHashMap::default();
        let docs: Vec<Doc> = rows
            .into_iter()
            .zip(tags)
            .zip(spaces)
            .map(|((row, tags), spaces)| {
                let tag_features: Vec<(String, f64)> = tags
                    .iter()
                    .map(|(name, source)| {
                        (format!("#{name}"), classify::tag_weight(source, params))
                    })
                    .collect();
                for (key, _) in &tag_features {
                    *tag_df.entry(key.clone()).or_insert(0) += 1;
                }
                let words = cache
                    .words
                    .get(&row.id)
                    .map(|c| Arc::clone(&c.words))
                    .unwrap_or_default();
                Doc {
                    id: row.id,
                    title: row.title,
                    content_kind: row.content_kind,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    last_opened_at: row.last_opened_at,
                    body_len: row.body_len,
                    words,
                    tag_features,
                    spaces,
                }
            })
            .collect();
        let corpus = Arc::new(Corpus {
            docs,
            word_df: Arc::clone(&cache.word_df),
            tag_df,
        });
        cache.built = key.map(|key| (key, Arc::clone(&corpus)));
        Ok(corpus)
    }
}
