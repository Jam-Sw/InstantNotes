use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeZone};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

pub const MAX_PAGE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ENTRIES: usize = 200_000;
const MAX_DEPTH: usize = 64;
const IMAGE_EXTENSIONS: [&str; 10] = [
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic", "avif",
];

pub struct Note {
    pub body: String,
    pub tags: Vec<String>,
    pub created_at: Option<SystemTime>,
    pub updated_at: Option<SystemTime>,
}

pub struct Page {
    pub path: String,
    pub text: String,
    pub created_at: SystemTime,
    pub updated_at: SystemTime,
}

impl Page {
    pub fn stem(&self) -> &str {
        let name = self.path.rsplit('/').next().unwrap_or(&self.path);
        name.rsplit_once('.').map_or(name, |(stem, _)| stem)
    }
}

pub struct Tree {
    pub root: PathBuf,
    pub pages: Vec<Page>,
    files: Vec<String>,
    by_name: HashMap<String, Vec<usize>>,
}

pub fn read_tree(root: &Path) -> io::Result<Tree> {
    let mut tree = Tree {
        root: root.to_path_buf(),
        pages: Vec::new(),
        files: Vec::new(),
        by_name: HashMap::new(),
    };
    let top = fs::read_dir(root)?;
    let mut stack = vec![(top, String::new(), 0usize)];
    while let Some((entries, prefix, depth)) = stack.pop() {
        for entry in entries.flatten() {
            if tree.files.len() >= MAX_ENTRIES {
                break;
            }
            let Ok(name) = entry.file_name().into_string() else {
                continue;
            };
            if name.starts_with('.') {
                continue;
            }
            let path = entry.path();
            let Ok(meta) = fs::symlink_metadata(&path) else {
                continue;
            };
            let rel = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            if meta.is_dir() {
                if depth < MAX_DEPTH {
                    if let Ok(inner) = fs::read_dir(&path) {
                        stack.push((inner, rel, depth + 1));
                    }
                }
                continue;
            }
            if !meta.is_file() {
                continue;
            }
            if has_extension(&name, &["md", "markdown"]) && meta.len() <= MAX_PAGE_BYTES {
                if let Ok(bytes) = fs::read(&path) {
                    let updated_at = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
                    let created_at = meta.created().unwrap_or(updated_at).min(updated_at);
                    tree.pages.push(Page {
                        path: rel.clone(),
                        text: String::from_utf8_lossy(&bytes).into_owned(),
                        created_at,
                        updated_at,
                    });
                }
            }
            tree.by_name
                .entry(name.to_lowercase())
                .or_default()
                .push(tree.files.len());
            tree.files.push(rel);
        }
    }
    tree.pages.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(tree)
}

impl Tree {
    pub fn path_of(&self, rel: &str) -> PathBuf {
        rel.split('/')
            .fold(self.root.clone(), |p, part| p.join(part))
    }

    pub fn images(&self) -> usize {
        self.files.iter().filter(|f| is_image(f)).count()
    }

    pub fn relative(&self, page: &str, target: &str) -> Option<String> {
        let decoded = percent_decode(target);
        if decoded.starts_with('/') || decoded.contains('\\') {
            return None;
        }
        let mut parts: Vec<&str> = page.split('/').collect();
        parts.pop();
        for part in decoded.split('/') {
            match part {
                "" | "." => {}
                ".." => {
                    parts.pop()?;
                }
                part => parts.push(part),
            }
        }
        let wanted = parts.join("/").to_lowercase();
        let last = wanted.rsplit('/').next()?;
        self.by_name
            .get(last)?
            .iter()
            .map(|&i| &self.files[i])
            .find(|f| f.to_lowercase() == wanted)
            .cloned()
    }

    pub fn named(&self, target: &str) -> Option<String> {
        let wanted = target.trim().trim_start_matches('/').to_lowercase();
        let last = wanted.rsplit('/').next()?;
        [
            (last.to_string(), wanted.clone()),
            (format!("{last}.md"), format!("{wanted}.md")),
        ]
        .into_iter()
        .find_map(|(name, full)| {
            let suffix = format!("/{full}");
            self.by_name
                .get(&name)?
                .iter()
                .map(|&i| &self.files[i])
                .filter(|f| {
                    let f = f.to_lowercase();
                    f == full || f.ends_with(&suffix)
                })
                .min_by_key(|f| f.len())
                .cloned()
        })
    }
}

pub fn is_image(name: &str) -> bool {
    has_extension(name, &IMAGE_EXTENSIONS)
}

fn has_extension(name: &str, extensions: &[&str]) -> bool {
    name.rsplit_once('.')
        .is_some_and(|(_, ext)| extensions.iter().any(|e| ext.eq_ignore_ascii_case(e)))
}

pub fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

pub fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = |b: u8| (b as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn is_external(target: &str) -> bool {
    target.contains("://") || target.starts_with("mailto:") || target.starts_with("data:")
}

pub enum Inline<'a> {
    Wiki {
        embed: bool,
        inner: &'a str,
    },
    Link {
        image: bool,
        text: &'a str,
        target: &'a str,
    },
}

pub fn rewrite(text: &str, mut f: impl FnMut(Inline<'_>) -> Option<String>) -> String {
    map_lines(text, |line, out| rewrite_line(line, out, &mut f))
}

pub fn map_lines(text: &str, mut f: impl FnMut(&str, &mut String)) -> String {
    let mut out = String::with_capacity(text.len());
    let mut fence: Option<&str> = None;
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_start();
        let marker = ["```", "~~~"].into_iter().find(|m| trimmed.starts_with(m));
        match (fence, marker) {
            (Some(open), Some(m)) if m == open => {
                fence = None;
                out.push_str(line);
                continue;
            }
            (Some(_), _) => {
                out.push_str(line);
                continue;
            }
            (None, Some(m)) => {
                fence = Some(m);
                out.push_str(line);
                continue;
            }
            (None, None) => {}
        }
        f(line, &mut out);
    }
    out
}

fn rewrite_line(line: &str, out: &mut String, f: &mut impl FnMut(Inline<'_>) -> Option<String>) {
    let mut i = 0;
    while i < line.len() {
        let rest = &line[i..];
        if rest.starts_with('`') {
            let run = rest.len() - rest.trim_start_matches('`').len();
            let ticks = &rest[..run];
            let end = rest[run..]
                .find(ticks)
                .map_or(rest.len(), |at| run + at + run);
            out.push_str(&rest[..end]);
            i += end;
            continue;
        }
        if let Some((len, inline)) = parse_inline(rest) {
            match f(inline) {
                Some(replacement) => out.push_str(&replacement),
                None => out.push_str(&rest[..len]),
            }
            i += len;
            continue;
        }
        let c = rest.chars().next().map_or(1, char::len_utf8);
        out.push_str(&rest[..c]);
        i += c;
    }
}

fn parse_inline(rest: &str) -> Option<(usize, Inline<'_>)> {
    let (embed, after) = match rest.strip_prefix('!') {
        Some(after) => (true, after),
        None => (false, rest),
    };
    let skip = usize::from(embed);
    if let Some(inner_start) = after.strip_prefix("[[") {
        let end = inner_start.find("]]")?;
        let inner = &inner_start[..end];
        if inner.contains('\n') {
            return None;
        }
        return Some((skip + 2 + end + 2, Inline::Wiki { embed, inner }));
    }
    let body = after.strip_prefix('[')?;
    let close = body.find("](")?;
    let text = &body[..close];
    if text.contains('\n') {
        return None;
    }
    let target_start = &body[close + 2..];
    let mut depth = 0usize;
    let mut end = None;
    for (at, c) in target_start.char_indices() {
        match c {
            '(' => depth += 1,
            ')' if depth == 0 => {
                end = Some(at);
                break;
            }
            ')' => depth -= 1,
            '\n' => return None,
            _ => {}
        }
    }
    let end = end?;
    let raw = target_start[..end].trim();
    let target = match raw.strip_prefix('<').and_then(|r| r.split_once('>')) {
        Some((inside, _)) => inside,
        None => raw.split_once(" \"").map_or(raw, |(t, _)| t),
    };
    Some((
        skip + 1 + close + 2 + end + 1,
        Inline::Link {
            image: embed,
            text,
            target,
        },
    ))
}

pub fn embed(
    found: Option<String>,
    target: &str,
    tree: &Tree,
    image: &mut impl FnMut(&Path) -> Option<String>,
) -> String {
    match found.and_then(|rel| image(&tree.path_of(&rel))) {
        Some(stored) => format!("![](attachments/{stored})"),
        None => format!("[Not imported: {}]", file_name(&percent_decode(target))),
    }
}

pub fn parse_date(s: &str) -> Option<SystemTime> {
    let s = s.trim();
    if let Ok(t) = DateTime::parse_from_rfc3339(s) {
        return Some(t.into());
    }
    let local = |naive: NaiveDateTime| {
        Local
            .from_local_datetime(&naive)
            .earliest()
            .map(SystemTime::from)
    };
    for format in [
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%B %d, %Y %I:%M %p",
        "%b %d, %Y %I:%M %p",
    ] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(s, format) {
            return local(naive);
        }
    }
    for format in ["%Y-%m-%d", "%B %d, %Y", "%b %d, %Y"] {
        if let Ok(date) = NaiveDate::parse_from_str(s, format) {
            return local(date.and_hms_opt(0, 0, 0)?);
        }
    }
    None
}

pub fn ensure_title(body: &str, title: &str) -> String {
    let first = body.lines().find(|l| !l.trim().is_empty());
    if let Some(heading) = first.and_then(|l| l.trim().strip_prefix("# ")) {
        if heading.trim().eq_ignore_ascii_case(title.trim()) {
            return body.trim_start_matches('\n').to_string();
        }
    }
    let title = title.trim();
    if title.is_empty() {
        return body.to_string();
    }
    format!("# {title}\n\n{}", body.trim_start_matches('\n'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree(files: &[&str]) -> Tree {
        let mut tree = Tree {
            root: PathBuf::from("/vault"),
            pages: Vec::new(),
            files: Vec::new(),
            by_name: HashMap::new(),
        };
        for f in files {
            tree.by_name
                .entry(file_name(f).to_lowercase())
                .or_default()
                .push(tree.files.len());
            tree.files.push(f.to_string());
        }
        tree
    }

    #[test]
    fn a_relative_target_resolves_from_the_page_folder_and_never_leaves_the_root() {
        let t = tree(&["notes/a.md", "notes/img/Shot 1.png", "top.png"]);
        assert_eq!(
            t.relative("notes/a.md", "img/Shot%201.png").as_deref(),
            Some("notes/img/Shot 1.png")
        );
        assert_eq!(
            t.relative("notes/a.md", "../top.png").as_deref(),
            Some("top.png")
        );
        assert_eq!(t.relative("notes/a.md", "../../top.png"), None);
        assert_eq!(t.relative("notes/a.md", "/top.png"), None);
    }

    #[test]
    fn a_name_resolves_anywhere_preferring_the_shortest_path() {
        let t = tree(&["deep/x/Pic.png", "Pic.png", "Notes/Plan.md"]);
        assert_eq!(t.named("pic.png").as_deref(), Some("Pic.png"));
        assert_eq!(t.named("x/Pic.png").as_deref(), Some("deep/x/Pic.png"));
        assert_eq!(t.named("Plan").as_deref(), Some("Notes/Plan.md"));
        assert_eq!(t.named("missing.png"), None);
    }

    #[test]
    fn links_and_wikilinks_are_handed_over_but_code_is_left_alone() {
        let text =
            "a [[One|two]] ![x](p%20q.png) `[[no]]`\n```\n[[fenced]]\n```\n[t](https://e.com)\n";
        let mut seen = Vec::new();
        let out = rewrite(text, |inline| {
            seen.push(match inline {
                Inline::Wiki { embed, inner } => format!("wiki:{embed}:{inner}"),
                Inline::Link {
                    image,
                    text,
                    target,
                } => format!("link:{image}:{text}:{target}"),
            });
            Some("X".into())
        });
        assert_eq!(
            seen,
            [
                "wiki:false:One|two",
                "link:true:x:p%20q.png",
                "link:false:t:https://e.com"
            ]
        );
        assert_eq!(out, "a X X `[[no]]`\n```\n[[fenced]]\n```\nX\n");
    }

    #[test]
    fn declining_a_rewrite_keeps_the_original_text() {
        let text = "see [a](b.md) and ![[c.png|300]] ok";
        assert_eq!(rewrite(text, |_| None), text);
    }

    #[test]
    fn a_title_heading_is_added_once() {
        assert_eq!(ensure_title("body", "Plan"), "# Plan\n\nbody");
        assert_eq!(ensure_title("\n# plan\nbody", "Plan"), "# plan\nbody");
        assert_eq!(
            ensure_title("# Other\nbody", "Plan"),
            "# Plan\n\n# Other\nbody"
        );
    }

    #[test]
    fn percent_escapes_decode_and_stray_percents_stay() {
        assert_eq!(percent_decode("a%20b%C3%A9"), "a bé");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }
}
