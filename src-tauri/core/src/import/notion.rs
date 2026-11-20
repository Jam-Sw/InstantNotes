use super::markdown::{self, embed, is_external, parse_date, Inline, Note, Page, Tree};
use std::fs;
use std::path::{Path, PathBuf};

const MAX_WRAPPERS: usize = 8;

pub fn resolve_folder(dir: &Path) -> PathBuf {
    let mut dir = dir.to_path_buf();
    for _ in 0..MAX_WRAPPERS {
        let Ok(entries) = fs::read_dir(&dir) else {
            break;
        };
        let mut folders = Vec::new();
        let mut has_page = false;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || name == "__MACOSX" {
                continue;
            }
            match fs::symlink_metadata(entry.path()) {
                Ok(meta) if meta.is_dir() => folders.push(entry.path()),
                Ok(_) if name.to_lowercase().ends_with(".md") => has_page = true,
                _ => {}
            }
        }
        if has_page || folders.len() != 1 {
            break;
        }
        dir = folders.remove(0);
    }
    dir
}

fn split_id(stem: &str) -> (&str, Option<&str>) {
    match stem.rsplit_once(' ') {
        Some((title, id)) if id.len() == 32 && id.chars().all(|c| c.is_ascii_hexdigit()) => {
            (title, Some(id))
        }
        _ => (stem, None),
    }
}

pub fn page_id(page: &Page) -> String {
    split_id(page.stem())
        .1
        .map_or_else(|| page.path.clone(), str::to_lowercase)
}

pub fn page_title(page: &Page) -> &str {
    split_id(page.stem()).0
}

pub fn has_content(page: &Page) -> bool {
    let mut lines = page
        .text
        .trim_start_matches('\u{feff}')
        .lines()
        .filter(|l| !l.trim().is_empty());
    match lines.next() {
        Some(first) if first.starts_with("# ") => lines.next().is_some(),
        Some(_) => true,
        None => false,
    }
}

pub fn convert(tree: &Tree, page: &Page, mut image: impl FnMut(&Path) -> Option<String>) -> Note {
    let text = page.text.trim_start_matches('\u{feff}');
    let mut tags = Vec::new();
    let mut created_at = None;
    let mut updated_at = None;
    for (key, value) in properties(text) {
        match key.to_lowercase().as_str() {
            "tags" => tags.extend(
                value
                    .split(',')
                    .map(str::trim)
                    .filter(|t| !t.is_empty())
                    .map(str::to_string),
            ),
            "created" | "created time" | "date created" => created_at = parse_date(value),
            "last edited time" | "last edited" | "updated" => updated_at = parse_date(value),
            _ => {}
        }
    }
    let text = markdown::map_lines(text, |line, out| {
        let trimmed = line.trim();
        if trimmed == "<aside>" || trimmed == "</aside>" {
            return;
        }
        out.push_str(strip_icon(line));
    });
    let body = markdown::rewrite(&text, |inline| match inline {
        Inline::Link {
            image: true,
            target,
            ..
        } if !is_external(target) => {
            let found = tree
                .relative(&page.path, target)
                .or_else(|| tree.relative("", target));
            Some(embed(found, target, tree, &mut image))
        }
        Inline::Link {
            image: false,
            text,
            target,
        } if !is_external(target) && !target.starts_with('#') => Some(text.to_string()),
        _ => None,
    });
    Note {
        body: markdown::ensure_title(body.trim_end(), page_title(page)),
        tags,
        created_at,
        updated_at,
    }
}

fn properties(text: &str) -> Vec<(&str, &str)> {
    let mut lines = text.lines().skip_while(|l| l.trim().is_empty());
    if !lines.next().is_some_and(|l| l.starts_with("# ")) {
        return Vec::new();
    }
    lines
        .skip_while(|l| l.trim().is_empty())
        .map_while(|l| {
            let (key, value) = l.split_once(": ")?;
            let plain = !key.is_empty()
                && key.len() <= 60
                && !key.starts_with(['#', '-', '*', '>', '|', '!', '[', ' ']);
            plain.then_some((key, value))
        })
        .collect()
}

fn strip_icon(line: &str) -> &str {
    let trimmed = line.trim_start();
    if let Some(rest) = trimmed.strip_prefix("<img src=\"https://www.notion.so/icons/") {
        if let Some(end) = rest.find("/>") {
            return rest[end + 2..].trim_start();
        }
    }
    line
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Export(PathBuf);
    impl Export {
        fn new(files: &[(&str, &str)]) -> Self {
            let dir = std::env::temp_dir().join(format!("notion-{}", uuid::Uuid::new_v4()));
            for (path, text) in files {
                let full = dir.join(path);
                fs::create_dir_all(full.parent().unwrap()).unwrap();
                fs::write(full, text).unwrap();
            }
            Export(dir)
        }
    }
    impl Drop for Export {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const ROOT: &str = "Export-d2b14fbf-86de-4508-a1b2-6515ff8d7aab";

    #[test]
    fn the_export_wrapper_folders_are_skipped() {
        let export = Export::new(&[
            (
                &format!("Part-1/{ROOT}/Home 2a889dba369b48709ec62508d5020d93.md"),
                "# Home\n\nx",
            ),
            (&format!("Part-1/{ROOT}/index.html"), "<ul></ul>"),
        ]);
        assert_eq!(
            resolve_folder(&export.0),
            export.0.join("Part-1").join(ROOT)
        );
    }

    #[test]
    fn the_id_is_the_hex_suffix_and_the_title_is_the_rest() {
        let export = Export::new(&[
            (
                "@April 10, 2025 1d1bb52ee2b581e88b4cdabcc5f86464.md",
                "# @April 10, 2025\n\nx",
            ),
            ("Plain.md", "# Plain\n\nx"),
        ]);
        let tree = markdown::read_tree(&export.0).unwrap();
        let ids: Vec<String> = tree.pages.iter().map(page_id).collect();
        let titles: Vec<&str> = tree.pages.iter().map(page_title).collect();
        assert_eq!(ids, ["1d1bb52ee2b581e88b4cdabcc5f86464", "Plain.md"]);
        assert_eq!(titles, ["@April 10, 2025", "Plain"]);
    }

    #[test]
    fn a_page_with_only_its_title_has_no_content() {
        let export = Export::new(&[
            ("My tasks c86dcb5c74ae4e5399086dd0b8272e87.md", "# My tasks"),
            (
                "Home 2a889dba369b48709ec62508d5020d93.md",
                "# Home\n\nHello",
            ),
        ]);
        let tree = markdown::read_tree(&export.0).unwrap();
        let full: Vec<bool> = tree.pages.iter().map(has_content).collect();
        assert_eq!(full, [true, false]);
    }

    #[test]
    fn a_real_page_keeps_its_text_and_loses_links_to_pages() {
        let page = "\u{feff}# Getting Started on Mobile\n\n👋 Welcome to Notion!\n\n- [ ]  Tap anywhere\n    \n    [Example sub page](Getting%20Started%20on%20Mobile%20152bb52ee2b580179846fd78b2b60ea9/Example%20sub%20page%2025592a85546546a48b02dfa4fb545e1d.md)\n    \n<aside>\n<img src=\"https://www.notion.so/icons/code_lightgray.svg\" alt=\"x\" width=\"40px\" /> **Tip:** read\n</aside>\n[web](https://notion.so)";
        let export = Export::new(&[(
            "Getting Started on Mobile 152bb52ee2b580179846fd78b2b60ea9.md",
            page,
        )]);
        let tree = markdown::read_tree(&export.0).unwrap();
        let note = convert(&tree, &tree.pages[0], |_| None);
        assert_eq!(
            note.body,
            "# Getting Started on Mobile\n\n👋 Welcome to Notion!\n\n- [ ]  Tap anywhere\n    \n    Example sub page\n    \n**Tip:** read\n[web](https://notion.so)"
        );
    }

    #[test]
    fn properties_give_tags_and_dates_and_stay_visible() {
        let export = Export::new(&[(
            "Epics 0123456789abcdef0123456789abcdef.md",
            "# Epics\n\nCreated: February 24, 2023 5:26 PM\nLast edited time: March 2, 2023 7:48 PM\nTags: document, project plan\n\nBody",
        )]);
        let tree = markdown::read_tree(&export.0).unwrap();
        let note = convert(&tree, &tree.pages[0], |_| None);
        assert_eq!(note.tags, ["document", "project plan"]);
        assert!(note.created_at.is_some() && note.updated_at.is_some());
        assert!(note.created_at < note.updated_at);
        assert!(note
            .body
            .starts_with("# Epics\n\nCreated: February 24, 2023 5:26 PM\n"));
    }

    #[test]
    fn images_resolve_from_the_page_or_the_export_root() {
        let export = Export::new(&[
            ("Mar 6 ec33051546b344b6b325d91f7670e1ec.md", "# Mar 6\n\n![Mar%206%20ec33051546b344b6b325d91f7670e1ec/Untitled.png](Mar%206%20ec33051546b344b6b325d91f7670e1ec/Untitled.png)"),
            ("Mar 6 ec33051546b344b6b325d91f7670e1ec/Untitled.png", "png"),
            ("Mar 6 ec33051546b344b6b325d91f7670e1ec/Sub 11111111111111111111111111111111.md", "# Sub\n\n![a](Mar%206%20ec33051546b344b6b325d91f7670e1ec/Untitled.png) ![b](gone.png)"),
        ]);
        let tree = markdown::read_tree(&export.0).unwrap();
        let mut copied = 0;
        let bodies: Vec<String> = tree
            .pages
            .iter()
            .map(|p| {
                convert(&tree, p, |_| {
                    copied += 1;
                    Some("s.png".into())
                })
                .body
            })
            .collect();
        assert_eq!(copied, 2);
        assert_eq!(bodies[0], "# Mar 6\n\n![](attachments/s.png)");
        assert_eq!(
            bodies[1],
            "# Sub\n\n![](attachments/s.png) [Not imported: gone.png]"
        );
    }
}
