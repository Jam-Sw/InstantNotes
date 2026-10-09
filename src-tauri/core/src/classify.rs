use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Params {
    pub alpha: f64,
    pub show_at: f64,
    pub evidence_cap: usize,
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

pub const REASONS: usize = 3;

pub type Features = HashMap<String, f64>;

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

pub struct Model {
    params: Params,
    classes: Vec<Class>,
    priors: Vec<f64>,
    vocabulary: HashSet<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Verdict {
    pub class: String,
    pub probability: f64,
    pub reasons: Vec<String>,
}

impl Model {
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
                    match class.counts.get_mut(feature) {
                        Some(count) => *count += weight,
                        None => {
                            class.counts.insert(feature.clone(), *weight);
                        }
                    }
                    class.total += weight;
                    if !vocabulary.contains(feature) {
                        vocabulary.insert(feature.clone());
                    }
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

    pub fn class_count(&self) -> usize {
        self.classes.len()
    }

    fn log_likelihood(&self, class: &Class, feature: &str) -> f64 {
        let count = class.counts.get(feature).copied().unwrap_or(0.0);
        let alpha = self.params.alpha;
        ((count + alpha) / (class.total + alpha * self.vocabulary.len() as f64)).ln()
    }

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

    pub fn classify(&self, features: &Features) -> Option<Verdict> {
        let post = self.posterior(features)?;
        let (best, &probability) = post
            .probabilities
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))?;
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

    pub fn class_ids(&self) -> Vec<&str> {
        self.classes.iter().map(|c| c.id.as_str()).collect()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Posterior {
    pub probabilities: Vec<f64>,
    pub evidence_sums: Vec<f64>,
    pub informative: usize,
}

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
