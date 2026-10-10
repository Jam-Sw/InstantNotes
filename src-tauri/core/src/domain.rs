pub fn normalize_tag_name(raw: &str) -> Option<String> {
    let stripped = raw.trim().trim_start_matches('#');
    let collapsed = stripped
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    if collapsed.is_empty() {
        None
    } else {
        Some(collapsed)
    }
}

pub fn normalize_workspace_name(raw: &str) -> Option<String> {
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        None
    } else {
        Some(collapsed)
    }
}

pub fn extract_inline_tags(body: &str) -> Vec<String> {
    let chars: Vec<char> = body.chars().collect();
    let mut out: Vec<String> = Vec::new();
    let mut prev_is_boundary = true;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '#' && prev_is_boundary {
            let mut j = i + 1;
            let mut token = String::new();
            while j < chars.len()
                && (chars[j].is_alphanumeric() || chars[j] == '-' || chars[j] == '_')
            {
                token.push(chars[j]);
                j += 1;
            }
            if !token.is_empty() {
                if let Some(normalized) = normalize_tag_name(&token) {
                    if !out.contains(&normalized) {
                        out.push(normalized);
                    }
                }
                i = j;
                prev_is_boundary = false;
                continue;
            }
        }
        prev_is_boundary = c.is_whitespace();
        i += 1;
    }
    out
}

pub fn derive_title(body: &str) -> String {
    const UNTITLED: &str = "Untitled";
    const EMPHASIS: [char; 4] = ['*', '~', '=', '`'];
    let Some(line) = body
        .lines()
        .find(|l| !l.trim().is_empty() && !is_image_line(l))
    else {
        return UNTITLED.to_string();
    };
    let line = line
        .trim()
        .trim_start_matches(['#', '-', '*', '>', ' ', '\t']);
    let words: Vec<&str> = line
        .split_whitespace()
        .map(|w| w.trim_matches(EMPHASIS).trim_start_matches('#'))
        .filter(|w| !w.is_empty())
        .collect();
    let joined = words.join(" ");
    if joined.is_empty() {
        return UNTITLED.to_string();
    }
    joined.chars().take(80).collect()
}

fn is_image_line(line: &str) -> bool {
    let mut rest = line.trim();
    if rest.is_empty() {
        return false;
    }
    while !rest.is_empty() {
        let Some(after) = rest.strip_prefix("![") else {
            return false;
        };
        let Some(close) = after.find("](") else {
            return false;
        };
        let Some(end) = after[close + 2..].find(')') else {
            return false;
        };
        rest = after[close + 2 + end + 1..].trim_start();
    }
    true
}

const STOP_WORDS: &[&str] = &[
    "the",
    "and",
    "for",
    "are",
    "but",
    "not",
    "you",
    "all",
    "any",
    "can",
    "had",
    "her",
    "was",
    "one",
    "our",
    "out",
    "has",
    "his",
    "how",
    "its",
    "may",
    "new",
    "now",
    "old",
    "see",
    "two",
    "way",
    "who",
    "did",
    "get",
    "let",
    "put",
    "say",
    "she",
    "too",
    "use",
    "with",
    "that",
    "this",
    "from",
    "they",
    "will",
    "have",
    "what",
    "when",
    "your",
    "which",
    "their",
    "there",
    "would",
    "about",
    "could",
    "other",
    "these",
    "those",
    "then",
    "than",
    "them",
    "some",
    "such",
    "into",
    "over",
    "also",
    "just",
    "like",
    "more",
    "most",
    "only",
    "very",
    "much",
    "many",
    "been",
    "being",
    "were",
    "where",
    "while",
    "should",
    "because",
    "after",
    "before",
    "here",
    "does",
    "done",
    "each",
    "even",
    "ever",
    "every",
    "still",
    "same",
    "well",
    "want",
    "need",
    "make",
    "made",
    "take",
    "took",
    "come",
    "came",
    "goes",
    "going",
    "gone",
    "know",
    "think",
    "thing",
    "things",
    "something",
    "anything",
    "nothing",
    "really",
    "maybe",
    "again",
    "back",
    "down",
    "first",
    "last",
    "next",
    "today",
    "tomorrow",
    "yesterday",
    "week",
    "time",
    "day",
    "days",
    "note",
    "notes",
    "todo",
    "http",
    "https",
    "www",
    "com",
    "org",
    "net",
    "html",
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "attachments",
    "true",
    "false",
    "null",
    "none",
    "yes",
    "doesn",
    "don",
    "isn",
    "aren",
    "wasn",
    "didn",
    "won",
    "can't",
    "cannot",
    "i'm",
    "it's",
    "that's",
    "we're",
    "you're",
    "they're",
    "there's",
    "he's",
    "she's",
    "let's",
    "i've",
    "we've",
];

fn stop_words() -> &'static (std::collections::HashSet<&'static str>, usize) {
    static SET: std::sync::LazyLock<(std::collections::HashSet<&'static str>, usize)> =
        std::sync::LazyLock::new(|| {
            let longest = STOP_WORDS.iter().map(|w| w.len()).max().unwrap_or(0);
            (STOP_WORDS.iter().copied().collect(), longest)
        });
    &SET
}

fn is_stop_word(word: &str) -> bool {
    let (set, longest) = stop_words();
    word.len() <= *longest && set.contains(word)
}

fn emit_word(
    raw: &str,
    chars: usize,
    digits_only: bool,
    dirty: bool,
    scratch: &mut String,
    visit: &mut impl FnMut(&str),
) {
    if !dirty {
        if chars >= 3 && !digits_only && !is_stop_word(raw) {
            visit(raw);
        }
        return;
    }
    scratch.clear();
    for c in raw.chars() {
        scratch.extend(c.to_lowercase());
    }
    let lowered_chars = scratch.chars().count();
    let lowered_digits = scratch.chars().all(|c| c.is_ascii_digit());
    if lowered_chars >= 3 && !lowered_digits && !is_stop_word(scratch) {
        visit(scratch);
    }
}

pub fn for_each_content_word(text: &str, mut visit: impl FnMut(&str)) {
    let mut scratch = String::new();
    let mut start = 0usize;
    let mut chars = 0usize;
    let mut digits_only = true;
    let mut dirty = false;
    let mut in_word = false;
    let mut in_tag = false;
    let mut prev_is_boundary = true;
    for (at, c) in text.char_indices() {
        if c == '#' && prev_is_boundary {
            in_tag = true;
            prev_is_boundary = false;
            continue;
        }
        if c.is_alphanumeric() || c == '\'' {
            if !in_tag {
                if !in_word {
                    in_word = true;
                    start = at;
                    chars = 0;
                    digits_only = true;
                    dirty = false;
                }
                chars += 1;
                digits_only &= c.is_ascii_digit();
                dirty |= !c.is_ascii() || c.is_ascii_uppercase();
            }
            prev_is_boundary = false;
            continue;
        }
        if (c == '-' || c == '_') && in_tag {
            prev_is_boundary = false;
            continue;
        }
        in_tag = false;
        if in_word {
            emit_word(
                &text[start..at],
                chars,
                digits_only,
                dirty,
                &mut scratch,
                &mut visit,
            );
            in_word = false;
        }
        prev_is_boundary = c.is_whitespace();
    }
    if in_word {
        emit_word(
            &text[start..],
            chars,
            digits_only,
            dirty,
            &mut scratch,
            &mut visit,
        );
    }
}

pub fn content_words(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for_each_content_word(text, |word| {
        if !seen.contains(word) {
            seen.insert(word.to_string());
            out.push(word.to_string());
        }
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reference_content_words(text: &str) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut word = String::new();
        let mut in_tag = false;
        let mut prev_is_boundary = true;
        let flush = |word: &mut String,
                     out: &mut Vec<String>,
                     seen: &mut std::collections::HashSet<String>| {
            if word.chars().count() >= 3
                && !word.chars().all(|c| c.is_ascii_digit())
                && !STOP_WORDS.contains(&word.as_str())
                && seen.insert(word.clone())
            {
                out.push(word.clone());
            }
            word.clear();
        };
        for c in text.chars() {
            if c == '#' && prev_is_boundary {
                in_tag = true;
                prev_is_boundary = false;
                continue;
            }
            if c.is_alphanumeric() || c == '\'' {
                if !in_tag {
                    word.extend(c.to_lowercase());
                }
                prev_is_boundary = false;
                continue;
            }
            if (c == '-' || c == '_') && in_tag {
                prev_is_boundary = false;
                continue;
            }
            in_tag = false;
            flush(&mut word, &mut out, &mut seen);
            prev_is_boundary = c.is_whitespace();
        }
        flush(&mut word, &mut out, &mut seen);
        out
    }

    #[test]
    fn content_words_match_the_reference_on_random_text() {
        const PIECES: &[&str] = &[
            "a",
            "B",
            "ab",
            "Abc",
            "the",
            "and",
            "we're",
            "WE'RE",
            "x1",
            "123",
            "4567",
            "9",
            "caf\u{e9}",
            "\u{130}stanbul",
            "\u{4e2d}\u{6587}",
            "\u{df}",
            "'",
            "''",
            "don't",
            "-",
            "_",
            "#",
            "##",
            "#tag",
            "#tag-x_y",
            " ",
            "  ",
            "\n",
            "\t",
            ".",
            ",",
            "(",
            ")",
            "!",
            "\u{a0}",
            "\u{2003}",
            "word",
            "Zebra",
            "naive",
            "re-do",
            "snake_case",
            "ALLCAPS",
            "\u{1f600}",
            "e\u{301}",
        ];
        let mut state = 0x2545_F491_4F6C_DD1Du64;
        let mut next = move || {
            state ^= state >> 12;
            state ^= state << 25;
            state ^= state >> 27;
            state.wrapping_mul(0x2545_F491_4F6C_DD1D)
        };
        for _ in 0..40_000 {
            let len = (next() % 40) as usize;
            let text: String = (0..len)
                .map(|_| PIECES[(next() % PIECES.len() as u64) as usize])
                .collect();
            assert_eq!(
                content_words(&text),
                reference_content_words(&text),
                "{text:?}"
            );
        }
    }

    #[test]
    fn normalize_lowercases_and_trims() {
        assert_eq!(normalize_tag_name("  Project "), Some("project".into()));
    }

    #[test]
    fn normalize_strips_leading_hashes() {
        assert_eq!(normalize_tag_name("#idea"), Some("idea".into()));
        assert_eq!(normalize_tag_name("##idea"), Some("idea".into()));
    }

    #[test]
    fn normalize_collapses_inner_whitespace() {
        assert_eq!(
            normalize_tag_name("project   alpha"),
            Some("project alpha".into())
        );
    }

    #[test]
    fn normalize_rejects_empty() {
        assert_eq!(normalize_tag_name(""), None);
        assert_eq!(normalize_tag_name("   "), None);
        assert_eq!(normalize_tag_name("#"), None);
        assert_eq!(normalize_tag_name("##  "), None);
    }

    #[test]
    fn extracts_tags_at_start_and_after_whitespace() {
        assert_eq!(
            extract_inline_tags("#first call sam #q3-budget tomorrow"),
            vec!["first".to_string(), "q3-budget".to_string()]
        );
    }

    #[test]
    fn extraction_normalizes_and_dedupes() {
        assert_eq!(
            extract_inline_tags("#Idea and #idea again #IDEA"),
            vec!["idea".to_string()]
        );
    }

    #[test]
    fn hash_mid_word_is_not_a_tag() {
        assert_eq!(
            extract_inline_tags("the C#language a#b"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn bare_hash_is_not_a_tag() {
        assert_eq!(extract_inline_tags("just a # symbol"), Vec::<String>::new());
    }

    #[test]
    fn underscores_and_digits_allowed() {
        assert_eq!(
            extract_inline_tags("#tag_1 #v2-final"),
            vec!["tag_1".to_string(), "v2-final".to_string()]
        );
    }

    #[test]
    fn title_from_first_nonempty_line() {
        assert_eq!(derive_title("\n\nBuy milk\nand coffee"), "Buy milk");
    }

    #[test]
    fn title_strips_markdown_markers() {
        assert_eq!(derive_title("# Heading here\nbody"), "Heading here");
        assert_eq!(derive_title("- list item"), "list item");
        assert_eq!(derive_title("> quoted thought"), "quoted thought");
    }

    #[test]
    fn title_passes_over_lines_that_are_only_images() {
        assert_eq!(
            derive_title("![](attachments/a.png)\nWhiteboard photo"),
            "Whiteboard photo"
        );
        assert_eq!(
            derive_title("![a](x.png) ![b](y.png)\n\nTwo shots"),
            "Two shots"
        );
        assert_eq!(derive_title("![](attachments/a.png)"), "Untitled");
        assert_eq!(derive_title("See ![](a.png) here"), "See ![](a.png) here");
    }

    #[test]
    fn title_drops_emphasis_markers_around_words() {
        assert_eq!(
            derive_title("**Groceries** for the week"),
            "Groceries for the week"
        );
        assert_eq!(derive_title("***Call the bank***"), "Call the bank");
        assert_eq!(
            derive_title("~~old plan~~ ==new== `plan`"),
            "old plan new plan"
        );
        assert_eq!(derive_title("C++ and a*b"), "C++ and a*b");
    }

    #[test]
    fn title_strips_tag_hashes_keeping_words() {
        assert_eq!(
            derive_title("call sam #q3-budget now"),
            "call sam q3-budget now"
        );
    }

    #[test]
    fn title_truncates_to_80_chars() {
        let long = "x".repeat(200);
        assert_eq!(derive_title(&long).chars().count(), 80);
    }

    #[test]
    fn empty_body_yields_untitled() {
        assert_eq!(derive_title(""), "Untitled");
        assert_eq!(derive_title("   \n  "), "Untitled");
    }

    #[test]
    fn content_words_keep_what_a_note_is_about() {
        assert_eq!(
            content_words("Tomato ragu: simmer the sauce slowly #pasta"),
            vec!["tomato", "ragu", "simmer", "sauce", "slowly"]
        );
    }

    #[test]
    fn content_words_skip_tags_short_tokens_numbers_and_stop_words() {
        assert_eq!(
            content_words("#my-tag_1 is 2026 ok, the ONE! It's 20 min"),
            vec!["min"]
        );
        assert_eq!(content_words("C#minor a#b"), vec!["minor"]);
    }

    #[test]
    fn content_words_are_lowercase_and_listed_once() {
        assert_eq!(
            content_words("Ragu RAGU ragu Risotto"),
            vec!["ragu", "risotto"]
        );
    }

    #[test]
    fn content_words_leave_markdown_and_links_behind() {
        assert_eq!(
            content_words("![pic](attachments/abc123.png) see https://example.com/path"),
            vec!["pic", "abc123", "example", "path"]
        );
    }
}
