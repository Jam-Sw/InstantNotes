//! Which Space a note belongs in, judged from the notes already filed. Pure:
//! no SQL, no I/O. `store/suggest.rs` builds the examples from the library
//! and reads the verdicts; `tests/suggest_bench_test.rs` measures this model
//! against the alternatives on synthetic libraries, and records why this one.
//!
//! The model is a Dirichlet-Multinomial naive Bayes over a note's features:
//! the tags it carries (`#name`, weighted by how they got there) and the
//! words in its text (`domain::content_words`). Each Space's feature
//! likelihoods are smoothed with `alpha` pseudo-counts, so two notes make a
//! well-defined Space; the posterior is the softmax of log prior plus
//! log-likelihood. Two guards keep it honest: a note's evidence is averaged
//! past `evidence_cap` informative features, so a long note is not certain
//! just because it is long, and a Space is suggested only when the evidence
//! itself favours it, not its size through the prior. Every reason it gives
//! is a feature's weight of evidence for the Space against the rest.

use std::collections::{HashMap, HashSet};

/// The tunables, with the values the benchmark settled on.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Params {
    /// Dirichlet prior per feature per Space.
    pub alpha: f64,
    /// Below this posterior nothing is suggested.
    pub show_at: f64,
    /// Past this many informative features a note's evidence is averaged.
    pub evidence_cap: usize,
    /// Weight of a tag written in the text, and of one added to the note.
    pub inline_weight: f64,
    pub manual_weight: f64,
}

impl Default for Params {
    fn default() -> Self {
        Params {
            alpha: 0.5,
            show_at: 0.5,
            evidence_cap: 12,
            inline_weight: 2.0,
            manual_weight: 1.0,
        }
    }
}

/// How many reasons a verdict names.
pub const REASONS: usize = 3;

/// A note as the model sees it: feature to weight. A tag is keyed with its
/// `#`, a word without, so the two never collide.
pub type Features = HashMap<String, f64>;

/// One filed note: its features and the Spaces it is in.
pub struct Example<'a> {
    pub features: &'a Features,
    pub classes: &'a [String],
}

struct Class {
    id: String,
    members: usize,
    counts: HashMap<String, f64>,
    total: f64,
}

/// The fitted model: one count table per Space with members.
pub struct Model {
    params: Params,
    classes: Vec<Class>,
    priors: Vec<f64>,
    vocabulary: HashSet<String>,
}

/// The model's answer for one note.
#[derive(Debug, Clone, PartialEq)]
pub struct Verdict {
    pub class: String,
    /// The posterior probability of the Space, 0 to 1.
    pub probability: f64,
    /// Features for the Space against the rest, strongest first, at most
    /// `REASONS`.
    pub reasons: Vec<String>,
}

impl Model {
    /// Count the filed notes. A note in several Spaces teaches each. The
    /// classes come out sorted by id, so verdicts are stable whatever order
    /// the examples arrive in.
    pub fn fit(examples: &[Example<'_>], params: Params) -> Model {
        let mut classes: Vec<Class> = Vec::new();
        let mut vocabulary = HashSet::new();
        for ex in examples {
            for class_id in ex.classes {
                let class = match classes.iter_mut().find(|c| &c.id == class_id) {
                    Some(c) => c,
                    None => {
                        classes.push(Class {
                            id: class_id.clone(),
                            members: 0,
                            counts: HashMap::new(),
                            total: 0.0,
                        });
                        classes.last_mut().expect("just pushed")
                    }
                };
                class.members += 1;
                for (feature, weight) in ex.features {
                    *class.counts.entry(feature.clone()).or_insert(0.0) += weight;
                    class.total += weight;
                    vocabulary.insert(feature.clone());
                }
            }
        }
        classes.sort_by(|a, b| a.id.cmp(&b.id));
        let filed: usize = classes.iter().map(|c| c.members).sum();
        let priors = classes
            .iter()
            .map(|c| (c.members as f64 + 1.0) / (filed as f64 + classes.len() as f64))
            .collect();
        Model {
            params,
            classes,
            priors,
            vocabulary,
        }
    }

    /// How many Spaces hold notes. Below two there is nothing to decide.
    pub fn class_count(&self) -> usize {
        self.classes.len()
    }

    fn log_likelihood(&self, class: &Class, feature: &str) -> f64 {
        let count = class.counts.get(feature).copied().unwrap_or(0.0);
        let alpha = self.params.alpha;
        ((count + alpha) / (class.total + alpha * self.vocabulary.len() as f64)).ln()
    }

    /// The posterior over every Space for a note, with the per-Space
    /// evidence sums, or None when the note shares no feature with any
    /// filed note. The benchmark reads this; `classify` applies the policy.
    pub fn posterior(&self, features: &Features) -> Option<Posterior> {
        if self.classes.len() < 2 {
            return None;
        }
        let mut evidence: Vec<(&str, f64)> = features
            .iter()
            .filter(|(f, _)| self.vocabulary.contains(f.as_str()))
            .map(|(f, w)| (f.as_str(), *w))
            .collect();
        if evidence.is_empty() {
            return None;
        }
        evidence.sort_by(|a, b| a.0.cmp(b.0));
        let temper = (self.params.evidence_cap as f64 / evidence.len() as f64).min(1.0);
        let sums: Vec<f64> = self
            .classes
            .iter()
            .map(|c| {
                evidence
                    .iter()
                    .map(|(f, w)| w * self.log_likelihood(c, f))
                    .sum::<f64>()
            })
            .collect();
        let scores: Vec<f64> = sums
            .iter()
            .zip(&self.priors)
            .map(|(s, p)| p.ln() + temper * s)
            .collect();
        let max = scores.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let norm: f64 = scores.iter().map(|s| (s - max).exp()).sum();
        let probabilities = scores.iter().map(|s| (s - max).exp() / norm).collect();
        Some(Posterior {
            probabilities,
            evidence_sums: sums,
            informative: evidence.len(),
        })
    }

    /// The Space a note belongs in, if the model is sure enough to say.
    pub fn classify(&self, features: &Features) -> Option<Verdict> {
        let post = self.posterior(features)?;
        let (best, &probability) = post
            .probabilities
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))?;
        // The words have to point there, not just the Space's size.
        let evidence_leads = post
            .evidence_sums
            .iter()
            .enumerate()
            .all(|(i, s)| i == best || *s < post.evidence_sums[best]);
        if probability < self.params.show_at || !evidence_leads {
            return None;
        }
        Some(Verdict {
            class: self.classes[best].id.clone(),
            probability,
            reasons: self.reasons(features, best),
        })
    }

    /// Each feature's weight of evidence for the Space against the rest, the
    /// rest taken as a mixture in proportion to their priors; the strongest
    /// `REASONS` that favour the Space, ties broken by weight then name.
    fn reasons(&self, features: &Features, best: usize) -> Vec<String> {
        let class = &self.classes[best];
        let rest_prior: f64 = self
            .priors
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != best)
            .map(|(_, p)| p)
            .sum();
        let mut reasons: Vec<(f64, f64, &str)> = features
            .iter()
            .filter(|(f, _)| self.vocabulary.contains(f.as_str()))
            .map(|(f, w)| {
                let rest: f64 = self
                    .classes
                    .iter()
                    .zip(&self.priors)
                    .enumerate()
                    .filter(|(i, _)| *i != best)
                    .map(|(_, (c, p))| p / rest_prior * self.log_likelihood(c, f).exp())
                    .sum();
                (self.log_likelihood(class, f) - rest.ln(), *w, f.as_str())
            })
            .filter(|(llr, _, _)| *llr > 0.0)
            .collect();
        reasons.sort_by(|a, b| {
            b.0.total_cmp(&a.0)
                .then(b.1.total_cmp(&a.1))
                .then(a.2.cmp(b.2))
        });
        reasons
            .into_iter()
            .take(REASONS)
            .map(|(_, _, f)| f.to_string())
            .collect()
    }

    /// The Space ids, in the order `posterior` reports them.
    pub fn class_ids(&self) -> Vec<&str> {
        self.classes.iter().map(|c| c.id.as_str()).collect()
    }
}

/// The model's full answer for one note, before the show policy.
#[derive(Debug, Clone, PartialEq)]
pub struct Posterior {
    /// One probability per Space, in `class_ids` order.
    pub probabilities: Vec<f64>,
    /// Each Space's summed log-likelihood of the note's informative features.
    pub evidence_sums: Vec<f64>,
    /// How many of the note's features any filed note shares.
    pub informative: usize,
}

/// A note's features from its tags and text. Tags come as (name, source).
pub fn features(text: &str, tags: &[(String, String)], params: Params) -> Features {
    let mut out = Features::new();
    for word in crate::domain::content_words(text) {
        out.insert(word, 1.0);
    }
    for (name, source) in tags {
        let weight = if source == "inline" {
            params.inline_weight
        } else {
            params.manual_weight
        };
        out.insert(format!("#{name}"), weight);
    }
    out
}
