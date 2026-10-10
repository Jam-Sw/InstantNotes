use rustc_hash::FxHashMap;

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

pub type Features = FxHashMap<String, f64>;

pub struct Example<'a> {
    pub features: &'a Features,
    pub classes: &'a [String],
}

struct Class {
    id: String,
    members: usize,
    total: f64,
}

type Row = Vec<(usize, f64)>;

pub struct Model {
    params: Params,
    classes: Vec<Class>,
    priors: Vec<f64>,
    table: FxHashMap<String, Row>,
    denominators: Vec<f64>,
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
        let mut table: FxHashMap<String, Row> = FxHashMap::default();
        for ex in examples {
            for class_id in ex.classes {
                let index = match classes.iter().position(|c| &c.id == class_id) {
                    Some(index) => index,
                    None => {
                        classes.push(Class {
                            id: class_id.clone(),
                            members: 0,
                            total: 0.0,
                        });
                        classes.len() - 1
                    }
                };
                classes[index].members += 1;
                for (feature, weight) in ex.features {
                    classes[index].total += weight;
                    if let Some(row) = table.get_mut(feature.as_str()) {
                        match row.iter_mut().rev().find(|(c, _)| *c == index) {
                            Some((_, count)) => *count += weight,
                            None => row.push((index, *weight)),
                        }
                        continue;
                    }
                    table.insert(feature.clone(), vec![(index, *weight)]);
                }
            }
        }
        let mut order: Vec<usize> = (0..classes.len()).collect();
        order.sort_by(|a, b| classes[*a].id.cmp(&classes[*b].id));
        let mut remap = vec![0; classes.len()];
        for (sorted, original) in order.iter().enumerate() {
            remap[*original] = sorted;
        }
        for row in table.values_mut() {
            for entry in row.iter_mut() {
                entry.0 = remap[entry.0];
            }
            row.sort_unstable_by_key(|entry| entry.0);
        }
        let mut slots: Vec<Option<Class>> = classes.into_iter().map(Some).collect();
        let classes: Vec<Class> = order
            .iter()
            .map(|original| slots[*original].take().expect("each class once"))
            .collect();
        let filed: usize = classes.iter().map(|c| c.members).sum();
        let priors = classes
            .iter()
            .map(|c| (c.members as f64 + 1.0) / (filed as f64 + classes.len() as f64))
            .collect();
        let vocabulary = table.len() as f64;
        let denominators = classes
            .iter()
            .map(|c| c.total + params.alpha * vocabulary)
            .collect();
        Model {
            params,
            classes,
            priors,
            table,
            denominators,
        }
    }

    pub fn class_count(&self) -> usize {
        self.classes.len()
    }

    fn log_likelihood(&self, class: usize, row: &Row) -> f64 {
        let count = row
            .binary_search_by_key(&class, |entry| entry.0)
            .map_or(0.0, |at| row[at].1);
        ((count + self.params.alpha) / self.denominators[class]).ln()
    }

    pub fn posterior(&self, features: &Features) -> Option<Posterior> {
        if self.classes.len() < 2 {
            return None;
        }
        let mut evidence: Vec<(&str, f64, &Row)> = features
            .iter()
            .filter_map(|(f, w)| self.table.get(f.as_str()).map(|row| (f.as_str(), *w, row)))
            .collect();
        if evidence.is_empty() {
            return None;
        }
        evidence.sort_by(|a, b| a.0.cmp(b.0));
        let temper = (self.params.evidence_cap as f64 / evidence.len() as f64).min(1.0);
        let alpha = self.params.alpha;
        let unseen: Vec<f64> = self
            .denominators
            .iter()
            .map(|denominator| (alpha / denominator).ln())
            .collect();
        let mut sums = vec![-0.0f64; self.classes.len()];
        let mut likelihood = unseen.clone();
        for (_, weight, row) in &evidence {
            for (class, count) in row.iter() {
                likelihood[*class] = ((count + alpha) / self.denominators[*class]).ln();
            }
            for (sum, ll) in sums.iter_mut().zip(&likelihood) {
                *sum += weight * ll;
            }
            for (class, _) in row.iter() {
                likelihood[*class] = unseen[*class];
            }
        }
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
        let rest_prior: f64 = self
            .priors
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != best)
            .map(|(_, p)| p)
            .sum();
        let mut reasons: Vec<(f64, f64, &str)> = features
            .iter()
            .filter_map(|(f, w)| self.table.get(f.as_str()).map(|row| (f, w, row)))
            .map(|(f, w, row)| {
                let rest: f64 = self
                    .priors
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| *i != best)
                    .map(|(i, p)| p / rest_prior * self.log_likelihood(i, row).exp())
                    .sum();
                (self.log_likelihood(best, row) - rest.ln(), *w, f.as_str())
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
    let mut out =
        Features::with_capacity_and_hasher((text.len() / 10).clamp(16, 2048), Default::default());
    crate::domain::for_each_content_word(text, |word| {
        if !out.contains_key(word) {
            out.insert(word.to_string(), 1.0);
        }
    });
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    struct Rng(u64);

    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 >> 12;
            self.0 ^= self.0 << 25;
            self.0 ^= self.0 >> 27;
            self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
        }
        fn below(&mut self, n: usize) -> usize {
            (self.next() % n as u64) as usize
        }
    }

    struct RefClass {
        id: String,
        members: usize,
        counts: HashMap<String, f64>,
        total: f64,
    }

    struct RefModel {
        params: Params,
        classes: Vec<RefClass>,
        priors: Vec<f64>,
        vocabulary: std::collections::HashSet<String>,
    }

    impl RefModel {
        fn fit(examples: &[Example<'_>], params: Params) -> RefModel {
            let mut classes: Vec<RefClass> = Vec::new();
            let mut vocabulary = std::collections::HashSet::new();
            for ex in examples {
                for class_id in ex.classes {
                    let class = match classes.iter_mut().find(|c| &c.id == class_id) {
                        Some(c) => c,
                        None => {
                            classes.push(RefClass {
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
            RefModel {
                params,
                classes,
                priors,
                vocabulary,
            }
        }

        fn class_count(&self) -> usize {
            self.classes.len()
        }

        fn log_likelihood(&self, class: &RefClass, feature: &str) -> f64 {
            let count = class.counts.get(feature).copied().unwrap_or(0.0);
            let alpha = self.params.alpha;
            ((count + alpha) / (class.total + alpha * self.vocabulary.len() as f64)).ln()
        }

        fn posterior(&self, features: &Features) -> Option<Posterior> {
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

        fn classify(&self, features: &Features) -> Option<Verdict> {
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

        fn class_ids(&self) -> Vec<&str> {
            self.classes.iter().map(|c| c.id.as_str()).collect()
        }
    }

    fn doc(rng: &mut Rng, topic: usize, topics: usize, vocabulary: usize) -> Features {
        let mut f = Features::default();
        for _ in 0..(5 + rng.below(40)) {
            let word = if rng.below(3) == 0 {
                rng.below(vocabulary)
            } else {
                (topic * vocabulary / topics + rng.below(vocabulary / topics + 1)) % vocabulary
            };
            f.insert(format!("w{word}"), 1.0);
        }
        for _ in 0..rng.below(3) {
            let tag = if rng.below(2) == 0 {
                topic
            } else {
                rng.below(topics)
            };
            f.insert(
                format!("#t{tag}"),
                if rng.below(2) == 0 { 2.0 } else { 1.0 },
            );
        }
        f
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() <= 1e-9 * b.abs().max(1.0)
    }

    #[test]
    fn the_model_matches_the_reference_on_random_libraries() {
        let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
        let params = Params::default();
        let mut verdicts = 0;
        for _ in 0..120 {
            let topics = 2 + rng.below(8);
            let vocabulary = 30 + rng.below(400);
            let filed: Vec<(Features, Vec<String>)> = (0..(20 + rng.below(180)))
                .map(|_| {
                    let topic = rng.below(topics);
                    let mut classes = vec![format!("s{topic}")];
                    if rng.below(8) == 0 {
                        classes.push(format!("s{}", rng.below(topics)));
                        classes.dedup();
                    }
                    (doc(&mut rng, topic, topics, vocabulary), classes)
                })
                .collect();
            let examples: Vec<Example> = filed
                .iter()
                .map(|(features, classes)| Example { features, classes })
                .collect();
            let model = Model::fit(&examples, params);
            let reference = RefModel::fit(&examples, params);
            assert_eq!(model.class_count(), reference.class_count());
            assert_eq!(model.class_ids(), reference.class_ids());
            for _ in 0..30 {
                let topic = rng.below(topics);
                let mut f = doc(&mut rng, topic, topics, vocabulary);
                if rng.below(4) == 0 {
                    f.insert("unknown-feature".to_string(), 1.0);
                }
                match (model.posterior(&f), reference.posterior(&f)) {
                    (None, None) => {}
                    (Some(a), Some(b)) => {
                        assert_eq!(a.informative, b.informative);
                        for (x, y) in a.probabilities.iter().zip(&b.probabilities) {
                            assert!(close(*x, *y), "{x} vs {y}");
                        }
                        for (x, y) in a.evidence_sums.iter().zip(&b.evidence_sums) {
                            assert!(close(*x, *y), "{x} vs {y}");
                        }
                    }
                    (a, b) => panic!("posterior disagrees: {a:?} vs {b:?}"),
                }
                match (model.classify(&f), reference.classify(&f)) {
                    (None, None) => {}
                    (Some(a), Some(b)) => {
                        verdicts += 1;
                        assert_eq!(a.class, b.class);
                        assert!(close(a.probability, b.probability));
                        let x: std::collections::HashSet<_> = a.reasons.iter().collect();
                        let y: std::collections::HashSet<_> = b.reasons.iter().collect();
                        assert_eq!(x, y);
                    }
                    (a, b) => {
                        let near = [a, b]
                            .into_iter()
                            .flatten()
                            .all(|v| (v.probability - params.show_at).abs() < 1e-9);
                        assert!(near, "classify disagrees");
                    }
                }
            }
        }
        assert!(
            verdicts > 100,
            "the comparison reached only {verdicts} verdicts"
        );
    }
}
