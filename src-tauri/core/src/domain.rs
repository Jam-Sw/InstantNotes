//! Pure domain logic: tag semantics and title derivation.
//! No I/O, no SQL, no Tauri — per the dependency rule.

/// Normalize a tag name per DATA_MODEL.md §2.2: trim, strip leading `#`,
/// lowercase, collapse repeated whitespace. Returns `None` for empty results.
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

/// Normalize a workspace name: trim and collapse repeated whitespace,
/// preserving case (workspaces are display names, unlike lowercase tags).
/// Returns `None` for empty results.
pub fn normalize_workspace_name(raw: &str) -> Option<String> {
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        None
    } else {
        Some(collapsed)
    }
}

/// Extract inline `#tag` tokens from note body text. A tag starts with `#`
/// at the start of the text or after whitespace, followed by one or more
/// alphanumeric / `-` / `_` characters. Results are normalized and deduped,
/// in order of first appearance.
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

/// Derive a note title from the first line of the body with words on it
/// (see DATA_MODEL.md section 6), passing over blank lines and lines that
/// are only images: strip leading markdown markers (`#`, `-`, `*`, `>`), the
/// emphasis markers around words (`**`, `*`, `~~`, `==`, `` ` ``), and inline
/// `#` tag prefixes, collapse whitespace, truncate to 80 chars (char
/// boundary). A body with no such line yields "Untitled".
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

/// A line holding nothing but Markdown images: `![alt](path)`, one or more.
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

#[cfg(test)]
mod tests {
    use super::*;

    // -- normalize_tag_name --

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

    // -- extract_inline_tags --

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

    // -- derive_title --

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
        // An image inside a line of words is part of the title line.
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
        // Inside a word they are the word.
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
}
