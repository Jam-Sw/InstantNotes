use instantnotes_core::classify::{features, Example, Features, Model, Params};
use std::collections::{HashMap, HashSet};
use std::time::Instant;

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
    fn below(&mut self, n: usize) -> usize {
        (self.unit() * n as f64) as usize
    }
}

struct Labeled {
    features: Features,
    truth: usize,
}

fn library(
    rng: &mut Rng,
    sizes: &[usize],
    held_out: usize,
    long: bool,
) -> (Vec<Labeled>, Vec<Labeled>) {
    let k = sizes.len();
    let topic_words = 40;
    let background: Vec<String> = (0..300).map(|i| format!("common{i}")).collect();
    let topics: Vec<Vec<String>> = (0..k)
        .map(|c| {
            (0..topic_words)
                .map(|i| {
                    if i < topic_words / 3 {
                        format!("shared{}word{i}", c.min((c + 1) % k))
                    } else {
                        format!("topic{c}word{i}")
                    }
                })
                .collect()
        })
        .collect();
    let params = Params::default();
    let note = |rng: &mut Rng, c: usize| -> Labeled {
        let len = if long {
            60 + rng.below(140)
        } else {
            4 + rng.below(12)
        };
        let mut text = String::new();
        for _ in 0..len {
            let word = if rng.unit() < 0.4 {
                &topics[c][rng.below(topic_words)]
            } else {
                &background[rng.below(background.len())]
            };
            text.push_str(word);
            text.push(' ');
        }
        if rng.unit() < 0.2 {
            let other = (c + 1 + rng.below(k - 1)) % k;
            text.push_str(&topics[other][rng.below(topic_words)]);
        }
        let mut tags = Vec::new();
        if rng.unit() < 0.35 {
            tags.push((format!("topic{c}tag{}", rng.below(2)), "inline".to_string()));
        }
        if rng.unit() < 0.15 {
            tags.push((format!("topic{c}tag{}", rng.below(2)), "manual".to_string()));
        }
        Labeled {
            features: features(&text, &tags, params),
            truth: c,
        }
    };
    let mut filed = Vec::new();
    let mut test = Vec::new();
    for (c, &n) in sizes.iter().enumerate() {
        for _ in 0..n {
            filed.push(note(rng, c));
        }
        for _ in 0..held_out {
            test.push(note(rng, c));
        }
    }
    (filed, test)
}

struct Answer {
    class: usize,
    probability: f64,
    reasons: usize,
}

trait Method {
    fn name(&self) -> &'static str;
    fn fit(&mut self, filed: &[Labeled], k: usize);
    fn answer(&self, note: &Features) -> Option<Answer>;
}

struct NaiveBayes {
    params: Params,
    model: Option<Model>,
    ids: Vec<String>,
}

impl NaiveBayes {
    fn new(params: Params) -> Self {
        NaiveBayes {
            params,
            model: None,
            ids: Vec::new(),
        }
    }
}

impl Method for NaiveBayes {
    fn name(&self) -> &'static str {
        "naive Bayes (shipped)"
    }
    fn fit(&mut self, filed: &[Labeled], k: usize) {
        self.ids = (0..k).map(|c| format!("space{c:02}")).collect();
        let classes: Vec<Vec<String>> = (0..k).map(|c| vec![self.ids[c].clone()]).collect();
        let examples: Vec<Example<'_>> = filed
            .iter()
            .map(|n| Example {
                features: &n.features,
                classes: &classes[n.truth],
            })
            .collect();
        self.model = Some(Model::fit(&examples, self.params));
    }
    fn answer(&self, note: &Features) -> Option<Answer> {
        let v = self.model.as_ref()?.classify(note)?;
        Some(Answer {
            class: self.ids.iter().position(|id| *id == v.class)?,
            probability: v.probability,
            reasons: v.reasons.len(),
        })
    }
}

fn softmax(scores: &[f64]) -> Vec<f64> {
    let max = scores.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let norm: f64 = scores.iter().map(|s| (s - max).exp()).sum();
    scores.iter().map(|s| (s - max).exp() / norm).collect()
}

fn argmax(v: &[f64]) -> usize {
    v.iter()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(b.1))
        .map(|(i, _)| i)
        .unwrap()
}

struct ComplementNB {
    alpha: f64,
    show_at: f64,
    cap: usize,
    counts: Vec<HashMap<String, f64>>,
    totals: Vec<f64>,
    priors: Vec<f64>,
    vocab: HashSet<String>,
}

impl Method for ComplementNB {
    fn name(&self) -> &'static str {
        "complement naive Bayes"
    }
    fn fit(&mut self, filed: &[Labeled], k: usize) {
        self.counts = vec![HashMap::new(); k];
        self.totals = vec![0.0; k];
        let mut members = vec![0usize; k];
        for n in filed {
            members[n.truth] += 1;
            for (f, w) in &n.features {
                *self.counts[n.truth].entry(f.clone()).or_insert(0.0) += w;
                self.totals[n.truth] += w;
                self.vocab.insert(f.clone());
            }
        }
        let filed_n: usize = members.iter().sum();
        self.priors = members
            .iter()
            .map(|m| (*m as f64 + 1.0) / (filed_n as f64 + k as f64))
            .collect();
    }
    fn answer(&self, note: &Features) -> Option<Answer> {
        let k = self.counts.len();
        let informative: Vec<(&String, &f64)> = note
            .iter()
            .filter(|(f, _)| self.vocab.contains(*f))
            .collect();
        if informative.is_empty() {
            return None;
        }
        let temper = (self.cap as f64 / informative.len() as f64).min(1.0);
        let v = self.vocab.len() as f64;
        let scores: Vec<f64> = (0..k)
            .map(|c| {
                let total: f64 = (0..k).filter(|i| *i != c).map(|i| self.totals[i]).sum();
                let complement: f64 = informative
                    .iter()
                    .map(|(f, w)| {
                        let count: f64 = (0..k)
                            .filter(|i| *i != c)
                            .map(|i| self.counts[i].get(*f).copied().unwrap_or(0.0))
                            .sum();
                        *w * ((count + self.alpha) / (total + self.alpha * v)).ln()
                    })
                    .sum();
                self.priors[c].ln() - temper * complement
            })
            .collect();
        let p = softmax(&scores);
        let best = argmax(&p);
        if p[best] < self.show_at {
            return None;
        }
        let reasons = informative
            .iter()
            .filter(|(f, _)| {
                let own = self.counts[best].get(*f).copied().unwrap_or(0.0);
                let all: f64 = self
                    .counts
                    .iter()
                    .map(|c| c.get(*f).copied().unwrap_or(0.0))
                    .sum();
                own / self.totals[best].max(1.0)
                    > (all - own) / (self.totals.iter().sum::<f64>() - self.totals[best]).max(1.0)
            })
            .count()
            .min(3);
        Some(Answer {
            class: best,
            probability: p[best],
            reasons,
        })
    }
}

struct Centroid {
    temperature: f64,
    show_at: f64,
    idf: HashMap<String, f64>,
    centroids: Vec<HashMap<String, f64>>,
}

impl Centroid {
    fn vector(&self, note: &Features) -> HashMap<String, f64> {
        let mut v: HashMap<String, f64> = note
            .iter()
            .filter_map(|(f, w)| self.idf.get(f).map(|idf| (f.clone(), w * idf)))
            .collect();
        let norm = v.values().map(|x| x * x).sum::<f64>().sqrt();
        if norm > 0.0 {
            for x in v.values_mut() {
                *x /= norm;
            }
        }
        v
    }
}

impl Method for Centroid {
    fn name(&self) -> &'static str {
        "TF-IDF centroid"
    }
    fn fit(&mut self, filed: &[Labeled], k: usize) {
        let mut df: HashMap<String, usize> = HashMap::new();
        for n in filed {
            for f in n.features.keys() {
                *df.entry(f.clone()).or_insert(0) += 1;
            }
        }
        let n = filed.len() as f64;
        self.idf = df
            .into_iter()
            .map(|(f, d)| (f, ((n + 1.0) / (d as f64 + 1.0)).ln() + 1.0))
            .collect();
        self.centroids = vec![HashMap::new(); k];
        for note in filed {
            for (f, x) in self.vector(&note.features) {
                *self.centroids[note.truth].entry(f).or_insert(0.0) += x;
            }
        }
        for c in &mut self.centroids {
            let norm = c.values().map(|x| x * x).sum::<f64>().sqrt();
            if norm > 0.0 {
                for x in c.values_mut() {
                    *x /= norm;
                }
            }
        }
    }
    fn answer(&self, note: &Features) -> Option<Answer> {
        let v = self.vector(note);
        if v.is_empty() {
            return None;
        }
        let sims: Vec<f64> = self
            .centroids
            .iter()
            .map(|c| {
                v.iter()
                    .map(|(f, x)| x * c.get(f).copied().unwrap_or(0.0))
                    .sum()
            })
            .collect();
        let p = softmax(
            &sims
                .iter()
                .map(|s| s * self.temperature)
                .collect::<Vec<_>>(),
        );
        let best = argmax(&p);
        if p[best] < self.show_at {
            return None;
        }
        let reasons = v
            .keys()
            .filter(|f| self.centroids[best].contains_key(*f))
            .count()
            .min(3);
        Some(Answer {
            class: best,
            probability: p[best],
            reasons,
        })
    }
}

struct Knn {
    k: usize,
    show_at: f64,
    filed: Vec<(HashSet<String>, usize)>,
    classes: usize,
}

impl Method for Knn {
    fn name(&self) -> &'static str {
        "kNN Jaccard vote"
    }
    fn fit(&mut self, filed: &[Labeled], k: usize) {
        self.classes = k;
        self.filed = filed
            .iter()
            .map(|n| (n.features.keys().cloned().collect(), n.truth))
            .collect();
    }
    fn answer(&self, note: &Features) -> Option<Answer> {
        let mine: HashSet<&String> = note.keys().collect();
        let mut scored: Vec<(f64, usize, &HashSet<String>)> = self
            .filed
            .iter()
            .map(|(set, truth)| {
                let inter = set.iter().filter(|f| mine.contains(f)).count() as f64;
                let union = (set.len() + mine.len()) as f64 - inter;
                (if union > 0.0 { inter / union } else { 0.0 }, *truth, set)
            })
            .filter(|(s, _, _)| *s > 0.0)
            .collect();
        if scored.is_empty() {
            return None;
        }
        scored.sort_by(|a, b| b.0.total_cmp(&a.0));
        scored.truncate(self.k);
        let mut votes = vec![0.0; self.classes];
        for (s, truth, _) in &scored {
            votes[*truth] += s;
        }
        let total: f64 = votes.iter().sum();
        let best = argmax(&votes);
        let probability = votes[best] / total;
        if probability < self.show_at {
            return None;
        }
        let shared: HashSet<&String> = scored
            .iter()
            .filter(|(_, t, _)| *t == best)
            .flat_map(|(_, _, set)| set.iter().filter(|f| mine.contains(f)))
            .collect();
        Some(Answer {
            class: best,
            probability,
            reasons: shared.len().min(3),
        })
    }
}

#[derive(Debug, Default, Clone)]
struct Score {
    precision: f64,
    coverage: f64,
    ece: f64,
    three_reasons: f64,
    small_space_recall: f64,
    millis: f64,
}

fn score(method: &mut dyn Method, filed: &[Labeled], test: &[Labeled], k: usize) -> Score {
    let started = Instant::now();
    method.fit(filed, k);
    let mut sizes = vec![0usize; k];
    for n in filed {
        sizes[n.truth] += 1;
    }
    let largest = argmax(&sizes.iter().map(|s| *s as f64).collect::<Vec<_>>());
    let mut shown = 0usize;
    let mut right = 0usize;
    let mut reasons3 = 0usize;
    let mut bins = [(0usize, 0usize, 0.0f64); 5];
    let mut small_total = 0usize;
    let mut small_right = 0usize;
    for n in test {
        let answer = method.answer(&n.features);
        if n.truth != largest {
            small_total += 1;
            if answer.as_ref().is_some_and(|a| a.class == n.truth) {
                small_right += 1;
            }
        }
        let Some(a) = answer else { continue };
        shown += 1;
        let correct = a.class == n.truth;
        right += usize::from(correct);
        reasons3 += usize::from(a.reasons >= 3);
        let bin = (((a.probability - 0.5) / 0.1) as usize).min(4);
        bins[bin].0 += 1;
        bins[bin].1 += usize::from(correct);
        bins[bin].2 += a.probability;
    }
    let millis = started.elapsed().as_secs_f64() * 1000.0;
    let ece = bins
        .iter()
        .filter(|(n, _, _)| *n > 0)
        .map(|(n, r, p)| {
            (*n as f64 / shown.max(1) as f64) * (p / *n as f64 - *r as f64 / *n as f64).abs()
        })
        .sum();
    Score {
        precision: right as f64 / shown.max(1) as f64,
        coverage: shown as f64 / test.len() as f64,
        ece,
        three_reasons: reasons3 as f64 / shown.max(1) as f64,
        small_space_recall: small_right as f64 / small_total.max(1) as f64,
        millis,
    }
}

fn contenders(params: Params, all: bool) -> Vec<Box<dyn Method>> {
    if !all {
        return vec![Box::new(NaiveBayes::new(params))];
    }
    vec![
        Box::new(NaiveBayes::new(params)),
        Box::new(ComplementNB {
            alpha: params.alpha,
            show_at: params.show_at,
            cap: params.evidence_cap,
            counts: Vec::new(),
            totals: Vec::new(),
            priors: Vec::new(),
            vocab: HashSet::new(),
        }),
        Box::new(Centroid {
            temperature: 10.0,
            show_at: params.show_at,
            idf: HashMap::new(),
            centroids: Vec::new(),
        }),
        Box::new(Knn {
            k: 7,
            show_at: params.show_at,
            filed: Vec::new(),
            classes: 0,
        }),
    ]
}

struct Scenario {
    name: &'static str,
    sizes: Vec<usize>,
    held_out: usize,
    long: bool,
}

const COLD_START: &str = "cold start, 4 x 2";

fn scenarios() -> Vec<Scenario> {
    vec![
        Scenario {
            name: "2 Spaces, 30/70",
            sizes: vec![30, 70],
            held_out: 100,
            long: false,
        },
        Scenario {
            name: "3 Spaces, 10/40/150",
            sizes: vec![10, 40, 150],
            held_out: 100,
            long: false,
        },
        Scenario {
            name: "6 Spaces, 5..160",
            sizes: vec![5, 10, 20, 40, 80, 160],
            held_out: 60,
            long: false,
        },
        Scenario {
            name: COLD_START,
            sizes: vec![2, 2, 2, 2],
            held_out: 50,
            long: false,
        },
        Scenario {
            name: "one giant, 400 vs 10/10/10",
            sizes: vec![400, 10, 10, 10],
            held_out: 50,
            long: false,
        },
        Scenario {
            name: "5,000 notes, 8 Spaces",
            sizes: vec![100, 200, 300, 400, 600, 800, 1200, 1400],
            held_out: 60,
            long: false,
        },
        Scenario {
            name: "long notes, 3 Spaces 20/60/120",
            sizes: vec![20, 60, 120],
            held_out: 100,
            long: true,
        },
    ]
}

fn run(params: Params, verbose: bool, all: bool) -> HashMap<(&'static str, &'static str), Score> {
    let mut out = HashMap::new();
    for scenario in scenarios() {
        let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
        let (filed, test) = library(&mut rng, &scenario.sizes, scenario.held_out, scenario.long);
        if verbose {
            println!(
                "\n== {} ({} filed, {} held out) ==",
                scenario.name,
                filed.len(),
                test.len()
            );
            println!(
                "{:<26} {:>9} {:>9} {:>6} {:>8} {:>7} {:>8}",
                "method", "precision", "coverage", "ECE", "3 reasons", "small", "ms"
            );
        }
        for mut method in contenders(params, all) {
            let s = score(method.as_mut(), &filed, &test, scenario.sizes.len());
            if verbose {
                println!(
                    "{:<26} {:>9.3} {:>9.3} {:>6.3} {:>8.3} {:>7.3} {:>8.1}",
                    method.name(),
                    s.precision,
                    s.coverage,
                    s.ece,
                    s.three_reasons,
                    s.small_space_recall,
                    s.millis
                );
            }
            out.insert((scenario.name, method.name()), s);
        }
    }
    out
}

#[test]
fn naive_bayes_holds_up_against_the_alternatives() {
    let results = run(Params::default(), true, true);
    let nb = |scenario: &'static str| &results[&(scenario, "naive Bayes (shipped)")];

    for s in scenarios().iter().filter(|s| s.name != COLD_START) {
        let r = nb(s.name);
        assert!(r.precision >= 0.9, "{}: precision {}", s.name, r.precision);
        assert!(r.coverage >= 0.6, "{}: coverage {}", s.name, r.coverage);
        assert!(
            r.three_reasons >= 0.9,
            "{}: reasons {}",
            s.name,
            r.three_reasons
        );
    }
    for s in ["2 Spaces, 30/70", "3 Spaces, 10/40/150", "6 Spaces, 5..160"] {
        assert!(nb(s).ece <= 0.1, "{s}: ECE {}", nb(s).ece);
    }
    let cold = nb(COLD_START);
    assert!(
        cold.precision >= 0.75,
        "cold start precision {}",
        cold.precision
    );
    assert!(
        cold.coverage >= 0.3 && cold.coverage <= 0.7,
        "cold start coverage {}",
        cold.coverage
    );
    assert!(nb("one giant, 400 vs 10/10/10").small_space_recall >= 0.8);
    assert!(nb("5,000 notes, 8 Spaces").millis < 1000.0);

    let mean = |method: &'static str, pick: fn(&Score) -> f64| -> f64 {
        let v: Vec<f64> = scenarios()
            .iter()
            .map(|s| pick(&results[&(s.name, method)]))
            .collect();
        v.iter().sum::<f64>() / v.len() as f64
    };
    for other in [
        "complement naive Bayes",
        "TF-IDF centroid",
        "kNN Jaccard vote",
    ] {
        let nb_quality = mean("naive Bayes (shipped)", |s| s.precision - s.ece);
        let other_quality = mean(other, |s| s.precision - s.ece);
        assert!(
            nb_quality + 0.02 >= other_quality,
            "{other}: precision minus ECE {other_quality:.3} beats {nb_quality:.3}"
        );
    }
}

#[test]
fn the_defaults_come_from_a_sweep() {
    let base = Params::default();
    let summarize = |params: Params| -> (f64, f64, f64) {
        let results = run(params, false, false);
        for sc in scenarios() {
            let r = &results[&(sc.name, "naive Bayes (shipped)")];
            println!(
                "    {:<34} precision {:.3} coverage {:.3} ECE {:.3} small {:.3}",
                sc.name, r.precision, r.coverage, r.ece, r.small_space_recall
            );
        }
        let v: Vec<&Score> = scenarios()
            .iter()
            .map(|s| &results[&(s.name, "naive Bayes (shipped)")])
            .collect();
        let n = v.len() as f64;
        (
            v.iter().map(|s| s.precision).sum::<f64>() / n,
            v.iter().map(|s| s.coverage).sum::<f64>() / n,
            v.iter().map(|s| s.ece).sum::<f64>() / n,
        )
    };
    println!(
        "\n== alpha (show_at {}, cap {}) ==",
        base.show_at, base.evidence_cap
    );
    for alpha in [0.1, 0.25, 0.5, 1.0, 2.0] {
        let (p, c, e) = summarize(Params { alpha, ..base });
        println!("alpha {alpha:<4} precision {p:.3} coverage {c:.3} ECE {e:.3}");
    }
    println!(
        "\n== show_at (alpha {}, cap {}) ==",
        base.alpha, base.evidence_cap
    );
    for show_at in [0.4, 0.5, 0.6, 0.7] {
        let (p, c, e) = summarize(Params { show_at, ..base });
        println!("show_at {show_at:<4} precision {p:.3} coverage {c:.3} ECE {e:.3}");
    }
    println!(
        "\n== evidence cap (alpha {}, show_at {}) ==",
        base.alpha, base.show_at
    );
    for evidence_cap in [4, 8, 12, 24, usize::MAX] {
        let (p, c, e) = summarize(Params {
            evidence_cap,
            ..base
        });
        let label = if evidence_cap == usize::MAX {
            "none".to_string()
        } else {
            evidence_cap.to_string()
        };
        println!("cap {label:<5} precision {p:.3} coverage {c:.3} ECE {e:.3}");
    }
    let (p, c, e) = summarize(base);
    assert!(
        p >= 0.9 && c >= 0.6 && e <= 0.12,
        "defaults: {p:.3} {c:.3} {e:.3}"
    );
}
