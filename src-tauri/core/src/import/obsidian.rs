use super::markdown::{
    self, embed, file_name, is_external, is_image, parse_date, Inline, Note, Page, Tree,
};
use std::path::{Path, PathBuf};

pub const REGISTRY: &str = "obsidian/obsidian.json";
pub const SANDBOXED_CONFIGS: [&str; 2] = [
    ".var/app/md.obsidian.Obsidian/config",
    "snap/obsidian/current/.config",
];
const DROPPED_PROPERTIES: [&str; 7] = [
    "aliases",
    "alias",
    "cssclasses",
    "cssclass",
    "created",
    "date",
    "position",
];

pub fn registry_vaults(json: &str) -> Vec<PathBuf> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else {
        return Vec::new();
    };
    let Some(vaults) = value.get("vaults").and_then(|v| v.as_object()) else {
        return Vec::new();
    };
    let mut found: Vec<(u64, PathBuf)> = vaults
        .values()
        .filter_map(|v| {
            let path = v.get("path")?.as_str()?;
            let ts = v.get("ts").and_then(serde_json::Value::as_u64).unwrap_or(0);
            Some((ts, PathBuf::from(path)))
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, path)| path).collect()
}

pub fn convert(tree: &Tree, page: &Page, mut image: impl FnMut(&Path) -> Option<String>) -> Note {
    let (front, text) = split_frontmatter(&page.text);
    let mut tags = Vec::new();
    let mut created_at = None;
    let mut properties = Vec::new();
    if let Some(map) = front.as_ref().and_then(serde_norway::Value::as_mapping) {
        for (key, value) in map {
            let Some(key) = key.as_str() else { continue };
            match key.to_lowercase().as_str() {
                "tags" | "tag" => tags.extend(tag_list(value)),
                "created" | "date" if created_at.is_none() => {
                    created_at = value.as_str().and_then(parse_date);
                }
                k if DROPPED_PROPERTIES.contains(&k) => {}
                _ => {
                    if let Some(shown) = property_text(value) {
                        properties.push(format!("{key}: {shown}"));
                    }
                }
            }
        }
    }
    let text = obsidian_lines(text);
    let body = markdown::rewrite(&text, |inline| match inline {
        Inline::Wiki {
            embed: false,
            inner,
        } => Some(wiki_label(inner)),
        Inline::Wiki { embed: true, inner } => {
            let target = inner.split('|').next().unwrap_or(inner);
            let target = target.split('#').next().unwrap_or(target).trim();
            if !is_image(target) {
                return Some(wiki_label(inner));
            }
            Some(embed(tree.named(target), target, tree, &mut image))
        }
        Inline::Link {
            image: true,
            target,
            ..
        } if !is_external(target) => {
            let found = tree
                .relative(&page.path, target)
                .or_else(|| tree.named(&markdown::percent_decode(target)));
            Some(embed(found, target, tree, &mut image))
        }
        Inline::Link {
            image: false,
            text,
            target,
        } if !is_external(target) && !target.starts_with('#') => Some(text.to_string()),
        Inline::Link { .. } => None,
    });
    let mut body = markdown::ensure_title(body.trim_end(), page.stem());
    if !properties.is_empty() {
        let (head, rest) = body.split_once('\n').unwrap_or((&body, ""));
        body = format!(
            "{head}\n\n{}\n\n{}",
            properties.join("\n"),
            rest.trim_start_matches('\n')
        )
        .trim_end()
        .to_string();
    }
    Note {
        body,
        tags,
        created_at,
        updated_at: None,
    }
}

fn wiki_label(inner: &str) -> String {
    if let Some((_, alias)) = inner.split_once('|') {
        return alias.trim().to_string();
    }
    let mut parts = inner
        .split('#')
        .map(|p| p.trim().trim_start_matches('^'))
        .filter(|p| !p.is_empty());
    let name = parts.next().unwrap_or("");
    let name = name.strip_suffix(".md").unwrap_or(name);
    let name = file_name(name);
    let rest: Vec<&str> = parts
        .filter(|p| !inner.contains(&format!("#^{p}")))
        .collect();
    std::iter::once(name)
        .chain(rest)
        .collect::<Vec<_>>()
        .join(" > ")
}

fn split_frontmatter(text: &str) -> (Option<serde_norway::Value>, &str) {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let Some(after) = text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))
    else {
        return (None, text);
    };
    let mut offset = 0;
    for line in after.split_inclusive('\n') {
        if matches!(line.trim_end(), "---" | "...") {
            let yaml = &after[..offset];
            let rest = &after[offset + line.len()..];
            return match serde_norway::from_str::<serde_norway::Value>(yaml) {
                Ok(value) => (Some(value), rest),
                Err(_) => (None, text),
            };
        }
        offset += line.len();
    }
    (None, text)
}

fn tag_list(value: &serde_norway::Value) -> Vec<String> {
    let words: Vec<String> = match value {
        serde_norway::Value::Sequence(items) => items
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect(),
        serde_norway::Value::String(s) => s
            .split(|c: char| c == ',' || c.is_whitespace())
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    };
    words
        .into_iter()
        .map(|w| w.trim().trim_start_matches('#').to_string())
        .filter(|w| !w.is_empty())
        .collect()
}

fn property_text(value: &serde_norway::Value) -> Option<String> {
    let scalar = |v: &serde_norway::Value| match v {
        serde_norway::Value::String(s) => Some(s.clone()),
        serde_norway::Value::Number(n) => Some(n.to_string()),
        serde_norway::Value::Bool(b) => Some(b.to_string()),
        _ => None,
    };
    match value {
        serde_norway::Value::Sequence(items) => {
            let shown: Vec<String> = items.iter().filter_map(scalar).collect();
            (!shown.is_empty()).then(|| shown.join(", "))
        }
        v => scalar(v).filter(|s| !s.trim().is_empty()),
    }
}

fn obsidian_lines(text: &str) -> String {
    let mut in_comment = false;
    markdown::map_lines(text, |line, out| {
        let (content, newline) = match line.strip_suffix('\n') {
            Some(c) => (c, "\n"),
            None => (line, ""),
        };
        let started_in_comment = in_comment;
        let mut kept = String::new();
        let mut rest = content;
        loop {
            if in_comment {
                match rest.find("%%") {
                    Some(at) => {
                        rest = &rest[at + 2..];
                        in_comment = false;
                    }
                    None => break,
                }
            } else {
                match rest.find("%%") {
                    Some(at) => {
                        kept.push_str(&rest[..at]);
                        rest = &rest[at + 2..];
                        in_comment = true;
                    }
                    None => {
                        kept.push_str(rest);
                        break;
                    }
                }
            }
        }
        if kept.trim().is_empty() && (started_in_comment || content.contains("%%")) {
            return;
        }
        out.push_str(&callout(strip_block_id(&kept)));
        out.push_str(newline);
    })
}

fn strip_block_id(line: &str) -> &str {
    let trimmed = line.trim_end();
    if let Some((before, id)) = trimmed.rsplit_once('^') {
        let is_id = !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
        if is_id && (before.is_empty() || before.ends_with(' ')) {
            return before.trim_end();
        }
    }
    line
}

fn callout(line: &str) -> String {
    let quote_len = line.len() - line.trim_start_matches(['>', ' ']).len();
    if quote_len == 0 || !line[..quote_len].contains('>') {
        return line.to_string();
    }
    let (quote, rest) = line.split_at(quote_len);
    let Some(after) = rest.strip_prefix("[!") else {
        return line.to_string();
    };
    let Some((kind, title)) = after.split_once(']') else {
        return line.to_string();
    };
    let title = title.trim_start_matches(['+', '-']).trim();
    let title = if title.is_empty() {
        let mut chars = kind.chars();
        chars.next().map_or(String::new(), |c| {
            c.to_uppercase()
                .chain(chars.flat_map(char::to_lowercase))
                .collect()
        })
    } else {
        title.to_string()
    };
    format!("{quote}**{title}**")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Vault(PathBuf);
    impl Vault {
        fn new(files: &[(&str, &[u8])]) -> Self {
            let dir = std::env::temp_dir().join(format!("obsidian-{}", uuid::Uuid::new_v4()));
            for (path, bytes) in files {
                let full = dir.join(path);
                fs::create_dir_all(full.parent().unwrap()).unwrap();
                fs::write(full, bytes).unwrap();
            }
            Vault(dir)
        }
    }
    impl Drop for Vault {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn convert_one(files: &[(&str, &[u8])], page: &str) -> (Note, Vec<PathBuf>) {
        let vault = Vault::new(files);
        let tree = markdown::read_tree(&vault.0).unwrap();
        let page = tree.pages.iter().find(|p| p.path == page).unwrap();
        let mut copied = Vec::new();
        let note = convert(&tree, page, |path| {
            copied.push(path.strip_prefix(&vault.0).unwrap().to_path_buf());
            Some("stored.png".into())
        });
        (note, copied)
    }

    #[test]
    fn the_registry_lists_vaults_most_recent_first() {
        let json = r#"{"vaults":{"a":{"path":"/old","ts":1},"b":{"path":"/new","ts":9,"open":true},"c":{"ts":5}}}"#;
        assert_eq!(
            registry_vaults(json),
            [PathBuf::from("/new"), PathBuf::from("/old")]
        );
        assert!(registry_vaults("not json").is_empty());
    }

    #[test]
    fn the_config_folder_and_dot_folders_are_not_notes() {
        let vault = Vault::new(&[
            (".obsidian/app.json", b"{}"),
            (".trash/old.md", b"gone"),
            ("Daily/2025-01-01.md", b"hi"),
        ]);
        let tree = markdown::read_tree(&vault.0).unwrap();
        let paths: Vec<&str> = tree.pages.iter().map(|p| p.path.as_str()).collect();
        assert_eq!(paths, ["Daily/2025-01-01.md"]);
    }

    #[test]
    fn frontmatter_becomes_tags_a_date_and_visible_properties() {
        let (note, _) = convert_one(
            &[(
                "Plan.md",
                b"---\ntags:\n  - work\n  - '#a/b'\naliases: [p]\ncreated: 2024-03-05\nsource: https://x.y\n---\nBody line\n",
            )],
            "Plan.md",
        );
        assert_eq!(note.tags, ["work", "a/b"]);
        assert!(note.created_at.is_some());
        assert_eq!(note.body, "# Plan\n\nsource: https://x.y\n\nBody line");
    }

    #[test]
    fn a_tag_string_splits_on_commas_and_spaces() {
        let (note, _) = convert_one(&[("A.md", b"---\ntags: one, two three\n---\nx")], "A.md");
        assert_eq!(note.tags, ["one", "two", "three"]);
    }

    #[test]
    fn broken_frontmatter_is_kept_as_text() {
        let (note, _) = convert_one(&[("A.md", b"---\n: : [\n---\nx")], "A.md");
        assert!(note.body.contains(": : ["));
    }

    #[test]
    fn wikilinks_read_as_text_and_embedded_images_are_copied() {
        let (note, copied) = convert_one(
            &[
                ("Notes/Day.md", b"See [[Plan|the plan]], [[Plan#Goals]], [[Other#^abc12]].\n![[shot.png|300]]\n![[Plan]]\n![[missing.png]]\n"),
                ("assets/shot.png", b"png"),
                ("Plan.md", b"p"),
            ],
            "Notes/Day.md",
        );
        assert_eq!(copied, [PathBuf::from("assets/shot.png")]);
        assert_eq!(
            note.body,
            "# Day\n\nSee the plan, Plan > Goals, Other.\n![](attachments/stored.png)\nPlan\n[Not imported: missing.png]"
        );
    }

    #[test]
    fn markdown_images_resolve_from_the_note_and_links_to_notes_become_text() {
        let (note, copied) = convert_one(
            &[
                (
                    "a/Note.md",
                    b"![x](img/My%20Pic.png) [other](../Other%20Note.md) [web](https://e.com)",
                ),
                ("a/img/My Pic.png", b"png"),
            ],
            "a/Note.md",
        );
        assert_eq!(copied, [PathBuf::from("a/img/My Pic.png")]);
        assert_eq!(
            note.body,
            "# Note\n\n![](attachments/stored.png) other [web](https://e.com)"
        );
    }

    #[test]
    fn comments_block_ids_and_callouts_turn_into_plain_markdown() {
        let (note, _) = convert_one(
            &[(
                "A.md",
                b"# A\nkeep %%hidden%% this ^abc-1\n%%\nmulti\nline\n%%\n> [!warning]- Careful now\n> body\n> [!tip]\n```\n%% code ^x\n```\n",
            )],
            "A.md",
        );
        assert_eq!(
            note.body,
            "# A\nkeep  this\n> **Careful now**\n> body\n> **Tip**\n```\n%% code ^x\n```"
        );
    }

    #[test]
    fn dates_in_common_shapes_parse() {
        for s in [
            "2024-03-05",
            "2024-03-05T10:20",
            "2024-03-05T10:20:30Z",
            "April 10, 2025 6:16 AM",
            "Mar 9, 2020 4:10 PM",
        ] {
            assert!(parse_date(s).is_some(), "{s}");
        }
        assert!(parse_date("someday").is_none());
    }
}
