use super::corpus::{Corpus, Doc};
use super::suggest::{Dismissals, DismissedValues};
use super::*;
use crate::classify::{self, Features, Params};
use rustc_hash::FxHashMap;
use std::collections::HashSet;

pub const RELATED_SUGGEST_SETTING: &str = "suggest.related";
const RELATED_DISMISSED_SETTING: &str = "related.dismissed";

const RELATED_DISMISSALS: Dismissals = Dismissals {
    setting: RELATED_DISMISSED_SETTING,
    values: DismissedValues::Notes,
};

pub const RELATED_DEFAULT_LIMIT: usize = 3;
const MAX_LIMIT: usize = 50;
const TOP_TERMS: usize = 5;
const EXCERPT_CHARS: usize = 160;
const FRAGMENT_CHARS: usize = 500;
const DORMANT_BOOST: f64 = 0.2;
const FRAGMENT_BOOST: f64 = 0.04;
const NOTE_WEIGHT: f64 = 0.45;
const PASSAGE_WEIGHT: f64 = 1.5;
const COMMON_SHARE: f64 = 0.55;
const IDF_FLOOR: f64 = 0.6;
const EVIDENCE_RATE: f64 = 0.36;
const EVIDENCE_WEIGHT: f64 = 0.45;
const QUERY_COVER_WEIGHT: f64 = 0.30;
const CAND_COVER_WEIGHT: f64 = 0.25;
const SMOOTH_FROM: f64 = 0.75;
const SMOOTH_HEADROOM: f64 = 0.24;
const SMOOTH_RATE: f64 = 2.2;

struct Term<'a> {
    key: &'a str,
    weight: f64,
    idf: f64,
}

struct Query<'a> {
    terms: Vec<Term<'a>>,
    denom: f64,
}

impl<'a> Query<'a> {
    fn new(features: &'a Features, corpus: &Corpus) -> Self {
        let n = corpus.docs.len();
        let mut terms: Vec<Term> = features
            .iter()
            .filter_map(|(key, weight)| {
                let df = corpus.df(key);
                informative(df, n).then(|| Term {
                    key: key.as_str(),
                    weight: *weight,
                    idf: idf(df, n),
                })
            })
            .collect();
        terms.sort_by(|a, b| a.key.cmp(b.key));
        let denom = top_sum(terms.iter().map(|t| t.weight * t.idf));
        Query { terms, denom }
    }
}

struct Match<'c> {
    doc: &'c Doc,
    score: f64,
    reasons: Vec<String>,
    matched: Vec<String>,
}

fn informative(df: usize, n_docs: usize) -> bool {
    n_docs < 6 || (df as f64) <= (n_docs as f64) * COMMON_SHARE
}

fn idf(df: usize, n_docs: usize) -> f64 {
    ((n_docs as f64 + 2.0) / (df as f64 + 1.0)).ln() + IDF_FLOOR
}

fn top_sum(weights: impl Iterator<Item = f64>) -> f64 {
    let mut weights: Vec<f64> = weights.collect();
    weights.sort_by(|a, b| b.total_cmp(a));
    weights.into_iter().take(TOP_TERMS).sum()
}

fn clamp_limit(limit: usize) -> usize {
    if limit == 0 {
        RELATED_DEFAULT_LIMIT
    } else {
        limit.min(MAX_LIMIT)
    }
}

fn pair_key(a: &str, b: &str) -> (String, String) {
    if a <= b {
        (a.to_string(), b.to_string())
    } else {
        (b.to_string(), a.to_string())
    }
}

fn parse_ms(iso: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(iso)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

fn dormancy(now_ms: i64, doc: &Doc) -> f64 {
    let seen = doc.last_opened_at.as_deref().unwrap_or(&doc.created_at);
    let idle = parse_ms(seen).map_or(0.0, |ms| {
        (now_ms - ms).max(0) as f64 / REVISIT_AFTER_MS as f64
    });
    let fragment = if doc.body_len <= FRAGMENT_CHARS {
        FRAGMENT_BOOST
    } else {
        0.0
    };
    1.0 + DORMANT_BOOST * idle.min(1.0) + fragment
}

fn smooth_score(raw: f64) -> f64 {
    if raw <= 0.0 {
        0.0
    } else if raw <= SMOOTH_FROM {
        raw
    } else {
        SMOOTH_FROM + SMOOTH_HEADROOM * (1.0 - (-(raw - SMOOTH_FROM) * SMOOTH_RATE).exp())
    }
}

fn query_features(doc: &Doc, passage: Option<&str>) -> Features {
    let mut out = doc.feature_map();
    let Some(raw) = passage.map(str::trim).filter(|p| !p.is_empty()) else {
        return out;
    };
    let inline: Vec<(String, String)> = domain::extract_inline_tags(raw)
        .into_iter()
        .map(|t| (t, "inline".to_string()))
        .collect();
    let focused = classify::features(raw, &inline, Params::default());
    if focused.len() < 2 {
        return out;
    }
    for weight in out.values_mut() {
        *weight *= NOTE_WEIGHT;
    }
    for (key, weight) in focused {
        *out.entry(key).or_insert(0.0) += weight * PASSAGE_WEIGHT;
    }
    out
}

fn score<'c>(
    query: &Query<'_>,
    cand: &'c Doc,
    corpus: &Corpus,
    now_ms: i64,
    show_at: f64,
) -> Option<Match<'c>> {
    let mut shared = 0usize;
    let mut shared_cand = 0.0f64;
    let mut shared_query = 0.0f64;
    for term in &query.terms {
        if let Some(cw) = cand.weight(term.key) {
            shared += 1;
            shared_cand += cw * term.idf;
            shared_query += term.weight * term.idf;
        }
    }
    if shared < 2 || query.denom <= 0.0 {
        return None;
    }
    let n = corpus.docs.len();
    let cand_denom = top_sum(cand.features().filter_map(|(key, weight)| {
        let df = corpus.df(key);
        informative(df, n).then(|| weight * idf(df, n))
    }));
    if cand_denom <= 0.0 {
        return None;
    }
    let cand_cov = (shared_cand / cand_denom).clamp(0.0, 1.0);
    let query_cov = (shared_query / query.denom).clamp(0.0, 1.0);
    let evidence = 1.0 - (-EVIDENCE_RATE * shared_cand).exp();
    let base =
        EVIDENCE_WEIGHT * evidence + QUERY_COVER_WEIGHT * query_cov + CAND_COVER_WEIGHT * cand_cov;
    let score = smooth_score(base * dormancy(now_ms, cand));
    if score < show_at {
        return None;
    }
    let mut hits: Vec<(f64, &str)> = query
        .terms
        .iter()
        .filter_map(|t| cand.weight(t.key).map(|cw| (cw * t.weight * t.idf, t.key)))
        .collect();
    hits.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.cmp(b.1)));
    Some(Match {
        doc: cand,
        score,
        reasons: hits
            .iter()
            .take(classify::REASONS)
            .map(|(_, key)| key.to_string())
            .collect(),
        matched: hits.into_iter().map(|(_, key)| key.to_string()).collect(),
    })
}

fn by_rank(a: &Match<'_>, b: &Match<'_>) -> std::cmp::Ordering {
    b.score
        .total_cmp(&a.score)
        .then_with(|| a.doc.updated_at.cmp(&b.doc.updated_at))
        .then_with(|| a.doc.id.cmp(&b.doc.id))
}

fn clean_excerpt_line(line: &str) -> String {
    let trimmed = line
        .trim()
        .trim_start_matches(['#', '>', ' ', '\t'])
        .trim_start_matches("- [ ] ")
        .trim_start_matches("- [x] ")
        .trim_start_matches("- ")
        .trim_start_matches("* ")
        .trim();
    if trimmed.chars().count() <= EXCERPT_CHARS {
        trimmed.to_string()
    } else {
        let clipped: String = trimmed.chars().take(EXCERPT_CHARS - 1).collect();
        format!("{}…", clipped.trim_end())
    }
}

fn best_excerpt(body: &str, title: &str, matched: &HashSet<&str>) -> String {
    let lines: Vec<&str> = body
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    if lines.is_empty() {
        return String::new();
    }
    let multi = lines.len() > 1;
    let mut best_idx = 0usize;
    let mut best_score = -1.0f64;
    for (idx, line) in lines.iter().enumerate() {
        let mut hits = 0usize;
        domain::for_each_content_word(line, |w| {
            if matched.contains(w) {
                hits += 1;
            }
        });
        for tag in domain::extract_inline_tags(line) {
            if matched.contains(format!("#{tag}").as_str()) {
                hits += 1;
            }
        }
        let mut score = hits as f64;
        if multi && idx > 0 && domain::derive_title(lines[0]) == title {
            score += 0.25;
        }
        if score > best_score {
            best_score = score;
            best_idx = idx;
        }
    }
    clean_excerpt_line(lines[best_idx])
}

impl Store {
    pub fn related_notes(
        &self,
        note_id: &str,
        passage: Option<&str>,
        limit: usize,
    ) -> Result<Vec<RelatedNote>> {
        let Some(show_at) = self.suggest_threshold(RELATED_SUGGEST_SETTING)? else {
            return Ok(Vec::new());
        };
        self.rank_related(note_id, passage, show_at, limit)
    }

    pub fn find_related_notes(
        &self,
        note_id: &str,
        passage: Option<&str>,
        limit: usize,
    ) -> Result<Vec<RelatedNote>> {
        self.rank_related(note_id, passage, Params::default().show_at, limit)
    }

    pub fn related_pairs(&self, limit: usize) -> Result<Vec<RelatedPair>> {
        let corpus = self.corpus()?;
        let docs = &corpus.docs;
        let n = docs.len();
        if n < 2 {
            return Ok(Vec::new());
        }
        let mut postings: FxHashMap<&str, Vec<usize>> = FxHashMap::default();
        for (i, doc) in docs.iter().enumerate() {
            for (key, _) in doc.features() {
                if informative(corpus.df(key), n) {
                    postings.entry(key).or_default().push(i);
                }
            }
        }
        let dismissed = self.dismissed_pairs(&RELATED_DISMISSALS)?;
        let show_at = Params::default().show_at;
        let now = now_ms();
        let mut hits = vec![0usize; n];
        let mut touched: Vec<usize> = Vec::new();
        let mut found: Vec<(usize, Match<'_>)> = Vec::new();
        for (i, anchor) in docs.iter().enumerate() {
            let features = anchor.feature_map();
            let query = Query::new(&features, &corpus);
            if query.terms.len() < 2 {
                continue;
            }
            for term in &query.terms {
                for &j in postings.get(term.key).into_iter().flatten() {
                    if hits[j] == 0 {
                        touched.push(j);
                    }
                    hits[j] += 1;
                }
            }
            for j in touched.drain(..) {
                let shared = std::mem::take(&mut hits[j]);
                if shared < 2 || j == i {
                    continue;
                }
                let cand = &docs[j];
                if (anchor.updated_at.as_str(), anchor.body_len, &anchor.id)
                    < (cand.updated_at.as_str(), cand.body_len, &cand.id)
                {
                    continue;
                }
                if dismissed.contains(&pair_key(&anchor.id, &cand.id)) {
                    continue;
                }
                if let Some(m) = score(&query, cand, &corpus, now, show_at) {
                    found.push((i, m));
                }
            }
        }
        found.sort_by(|(ai, a), (bi, b)| {
            by_rank(a, b).then_with(|| docs[*ai].id.cmp(&docs[*bi].id))
        });
        found.truncate(clamp_limit(limit));
        found
            .into_iter()
            .map(|(i, m)| {
                Ok(RelatedPair {
                    note_id: docs[i].id.clone(),
                    note_title: docs[i].title.clone(),
                    related: self.related_note(m)?,
                })
            })
            .collect()
    }

    pub fn dismiss_related_note(&mut self, note_id: &str, related_id: &str) -> Result<()> {
        if note_id == related_id {
            return Err(AppError::Validation(
                "a note cannot be dismissed as related to itself".into(),
            ));
        }
        self.fetch_note(note_id)?;
        self.fetch_note(related_id)?;
        let (a, b) = pair_key(note_id, related_id);
        self.dismiss_pair(&RELATED_DISMISSALS, &a, &b)
    }

    pub fn restore_related_note(&mut self, note_id: &str, related_id: &str) -> Result<()> {
        let (a, b) = pair_key(note_id, related_id);
        self.restore_pair(&RELATED_DISMISSALS, &a, &b)
    }

    fn rank_related(
        &self,
        note_id: &str,
        passage: Option<&str>,
        show_at: f64,
        limit: usize,
    ) -> Result<Vec<RelatedNote>> {
        let corpus = self.corpus()?;
        if corpus.docs.len() < 2 {
            return Ok(Vec::new());
        }
        let Some(target) = corpus.docs.iter().find(|d| d.id == note_id) else {
            return Ok(Vec::new());
        };
        let features = query_features(target, passage);
        let query = Query::new(&features, &corpus);
        if query.terms.len() < 2 {
            return Ok(Vec::new());
        }
        let dismissed = self.dismissed_pairs(&RELATED_DISMISSALS)?;
        let now = now_ms();
        let mut found: Vec<Match<'_>> = corpus
            .docs
            .iter()
            .filter(|cand| cand.id != note_id && !dismissed.contains(&pair_key(note_id, &cand.id)))
            .filter_map(|cand| score(&query, cand, &corpus, now, show_at))
            .collect();
        found.sort_by(by_rank);
        found.truncate(clamp_limit(limit));
        found.into_iter().map(|m| self.related_note(m)).collect()
    }

    fn related_note(&self, m: Match<'_>) -> Result<RelatedNote> {
        let body: String = self
            .conn
            .prepare_cached("SELECT body FROM notes WHERE id = ?1")?
            .query_row(params![m.doc.id], |r| r.get(0))
            .optional()?
            .unwrap_or_default();
        let matched: HashSet<&str> = m.matched.iter().map(String::as_str).collect();
        Ok(RelatedNote {
            note_id: m.doc.id.clone(),
            title: m.doc.title.clone(),
            excerpt: best_excerpt(&body, &m.doc.title, &matched),
            content_kind: m.doc.content_kind.clone(),
            created_at: m.doc.created_at.clone(),
            updated_at: m.doc.updated_at.clone(),
            last_opened_at: m.doc.last_opened_at.clone(),
            score: m.score,
            reasons: m.reasons,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create(s: &mut Store, body: &str) -> Note {
        s.create_note(CreateNoteInput {
            body: Some(body.into()),
            ..Default::default()
        })
        .unwrap()
    }

    #[test]
    fn notes_revisit_would_list_outrank_fresh_notes_with_the_same_words() {
        let mut s = Store::open_in_memory().unwrap();
        let body = "Mycelium acoustic panels\nKiln drying hemp hurd substrates for studio baffling";
        let old = create(&mut s, body);
        let sixty_days_ago =
            (Utc::now() - Duration::days(60)).to_rfc3339_opts(SecondsFormat::Micros, true);
        s.conn
            .execute(
                "UPDATE notes SET created_at = ?1, updated_at = ?1 WHERE id = ?2",
                params![sixty_days_ago, old.id],
            )
            .unwrap();
        let fresh = create(&mut s, body);
        let current = create(
            &mut s,
            "Studio acoustics\nTesting mycelium hemp substrates for baffling",
        );

        let related = s.related_notes(&current.id, None, 3).unwrap();
        let ids: Vec<&str> = related.iter().map(|r| r.note_id.as_str()).collect();
        assert_eq!(ids, vec![old.id.as_str(), fresh.id.as_str()]);
        assert!(related[0].score > related[1].score);
    }
}
