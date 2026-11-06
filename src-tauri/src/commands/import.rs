use crate::*;
use instantnotes_core::domain::derive_title;
use instantnotes_core::import::{markdown, notion, obsidian, rtf, stickies};
use instantnotes_core::store::iso;
use std::collections::HashSet;
use std::io;
use std::path::{Component, Path, PathBuf};

const SOURCE: &str = "stickies";
const MAX_IMAGE_BYTES: u64 = 50 * 1024 * 1024;
const PREVIEW_CHARS: usize = 400;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StickiesScan {
    folder: String,
    readable: bool,
    stickies: Vec<StickyPreview>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StickyPreview {
    id: String,
    title: String,
    text: String,
    color: Option<String>,
    created_at: String,
    updated_at: String,
    images: usize,
    imported: bool,
}

#[tauri::command(async)]
pub fn stickies_location(app: AppHandle) -> Option<String> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let home = app.path().home_dir().ok()?;
    Some(
        home.join(stickies::STICKIES_DIR)
            .to_string_lossy()
            .into_owned(),
    )
}

#[tauri::command(async)]
pub fn scan_stickies(state: State<'_, AppState>, folder: String) -> CmdResult<StickiesScan> {
    let dir = chosen_folder(&folder)?;
    let found = match stickies::read_folder(&dir) {
        Ok(found) => found,
        Err(e) if e.kind() == io::ErrorKind::PermissionDenied => {
            return Ok(StickiesScan {
                folder: dir.to_string_lossy().into_owned(),
                readable: false,
                stickies: Vec::new(),
            })
        }
        Err(e) => return Err(unreadable(e)),
    };
    let imported = locked(&state)?.imported_ids(SOURCE)?;
    let stickies = found
        .into_iter()
        .map(|sticky| {
            let mut images = 0;
            let text = rtf::to_markdown(&sticky.rtf, |_| {
                images += 1;
                Some(String::new())
            });
            StickyPreview {
                title: derive_title(&text),
                text: text.chars().take(PREVIEW_CHARS).collect(),
                color: sticky.color,
                created_at: iso(sticky.created_at),
                updated_at: iso(sticky.updated_at),
                images,
                imported: imported.contains(&sticky.id),
                id: sticky.id,
            }
        })
        .collect();
    Ok(StickiesScan {
        folder: dir.to_string_lossy().into_owned(),
        readable: true,
        stickies,
    })
}

#[tauri::command(async)]
pub fn import_stickies(
    state: State<'_, AppState>,
    app: AppHandle,
    folder: String,
    ids: Vec<String>,
    space: Option<String>,
) -> CmdResult<ImportOutcome> {
    let dir = chosen_folder(&folder)?;
    let wanted: HashSet<String> = ids.iter().map(|id| id.to_uppercase()).collect();
    let done = locked(&state)?.imported_ids(SOURCE)?;
    let found = stickies::read_folder(&dir).map_err(unreadable)?;
    let attachments = attachments_dir(&app)?;
    let mut already = 0;
    let items: Vec<ImportItem> = found
        .into_iter()
        .filter(|sticky| wanted.contains(&sticky.id))
        .filter(|sticky| {
            let fresh = !done.contains(&sticky.id);
            already += usize::from(!fresh);
            fresh
        })
        .map(|sticky| ImportItem {
            body: rtf::to_markdown(&sticky.rtf, |name| {
                let stored = copy_image(&attachments, &sticky.package, name)?;
                Some(format!("![](attachments/{stored})"))
            }),
            source_id: sticky.id,
            tags: Vec::new(),
            created_at: sticky.created_at,
            updated_at: sticky.updated_at,
        })
        .collect();
    let mut outcome = locked(&state)?.import_notes(SOURCE, items, space.as_deref())?;
    outcome.skipped += already;
    request_vault_sync(&app);
    if outcome.imported > 0 {
        emit_notes_changed(&app);
        emit_tags_changed(&app);
        emit_workspaces_changed(&app);
    }
    Ok(outcome)
}

fn chosen_folder(folder: &str) -> CmdResult<PathBuf> {
    let path = Path::new(folder);
    if !path.is_absolute() {
        return Err(CmdError::validation("the folder must be an absolute path"));
    }
    Ok(stickies::resolve_folder(path))
}

fn unreadable(e: io::Error) -> CmdError {
    match e.kind() {
        io::ErrorKind::NotFound => CmdError::validation("that folder is no longer there"),
        io::ErrorKind::NotADirectory => CmdError::validation("that is a file, not a folder"),
        _ => CmdError::storage(format!("could not read the folder: {e}")),
    }
}

fn copy_image(attachments: &Path, package: &Path, name: &str) -> Option<String> {
    if !is_one_component(name) {
        return None;
    }
    copy_image_at(attachments, &package.join(name))
}

fn copy_image_at(attachments: &Path, path: &Path) -> Option<String> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_IMAGE_BYTES {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    store_image(attachments, &bytes).ok()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderScan {
    folder: String,
    readable: bool,
    notes: usize,
    images: usize,
    imported: usize,
    titles: Vec<String>,
}

struct Kind {
    source: &'static str,
    keep: fn(&markdown::Page) -> bool,
    id: fn(&Path, &markdown::Page) -> String,
}

const OBSIDIAN: Kind = Kind {
    source: "obsidian",
    keep: |_| true,
    id: |vault, page| vault.join(&page.path).to_string_lossy().into_owned(),
};
const NOTION: Kind = Kind {
    source: "notion",
    keep: notion::has_content,
    id: |_, page| notion::page_id(page),
};
const SAMPLE_TITLES: usize = 6;
const UNPACK_PREFIX: &str = "instantnotes-notion-";
const MAX_EXPORT_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_EXPORT_ENTRIES: usize = 200_000;
const RECENT_EXPORTS: usize = 3;

#[tauri::command(async)]
pub fn obsidian_vaults(app: AppHandle) -> Vec<String> {
    let mut registries = Vec::new();
    if let Ok(config) = app.path().config_dir() {
        registries.push(config.join(obsidian::REGISTRY));
    }
    if cfg!(target_os = "linux") {
        if let Ok(home) = app.path().home_dir() {
            for sandbox in obsidian::SANDBOXED_CONFIGS {
                registries.push(home.join(sandbox).join(obsidian::REGISTRY));
            }
        }
    }
    let mut vaults: Vec<PathBuf> = Vec::new();
    for registry in registries {
        let Ok(json) = std::fs::read_to_string(&registry) else {
            continue;
        };
        for vault in obsidian::registry_vaults(&json) {
            if vault.is_dir() && !vaults.contains(&vault) {
                vaults.push(vault);
            }
        }
    }
    vaults
        .into_iter()
        .map(|v| v.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command(async)]
pub fn scan_obsidian(state: State<'_, AppState>, folder: String) -> CmdResult<FolderScan> {
    let dir = absolute(&folder)?;
    scan_tree(&state, &dir, &OBSIDIAN, markdown::Page::stem)
}

#[tauri::command(async)]
pub fn import_obsidian(
    state: State<'_, AppState>,
    app: AppHandle,
    folder: String,
    space: Option<String>,
) -> CmdResult<ImportOutcome> {
    let dir = absolute(&folder)?;
    import_tree(&state, &app, &dir, &OBSIDIAN, space, |tree, page, image| {
        obsidian::convert(tree, page, image)
    })
}

#[tauri::command(async)]
pub fn notion_exports(app: AppHandle) -> Vec<String> {
    let Ok(downloads) = app.path().download_dir() else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(downloads) else {
        return Vec::new();
    };
    let mut found: Vec<(std::time::SystemTime, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let is_export = name.starts_with("Export-") && name.to_lowercase().ends_with(".zip");
            let meta = entry.metadata().ok()?;
            if !is_export || !meta.is_file() {
                return None;
            }
            Some((meta.modified().ok()?, entry.path()))
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found
        .into_iter()
        .take(RECENT_EXPORTS)
        .map(|(_, p)| p.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command(async)]
pub fn scan_notion(state: State<'_, AppState>, path: String) -> CmdResult<FolderScan> {
    let chosen = absolute(&path)?;
    let is_zip = chosen.is_file()
        && chosen
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("zip"));
    let unpacked = if is_zip { Some(unpack(&chosen)?) } else { None };
    let dir = notion::resolve_folder(unpacked.as_deref().unwrap_or(&chosen));
    let scan = scan_tree(&state, &dir, &NOTION, notion::page_title);
    if scan.is_err() {
        if let Some(unpacked) = unpacked {
            let _ = std::fs::remove_dir_all(unpacked);
        }
    }
    scan
}

#[tauri::command(async)]
pub fn import_notion(
    state: State<'_, AppState>,
    app: AppHandle,
    folder: String,
    space: Option<String>,
) -> CmdResult<ImportOutcome> {
    let dir = absolute(&folder)?;
    let outcome = import_tree(&state, &app, &dir, &NOTION, space, |tree, page, image| {
        notion::convert(tree, page, image)
    });
    remove_unpacked(&dir);
    outcome
}

fn absolute(path: &str) -> CmdResult<PathBuf> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err(CmdError::validation("the folder must be an absolute path"));
    }
    Ok(path)
}

fn scan_tree(
    state: &State<'_, AppState>,
    dir: &Path,
    kind: &Kind,
    title: fn(&markdown::Page) -> &str,
) -> CmdResult<FolderScan> {
    let folder = dir.to_string_lossy().into_owned();
    let tree = match markdown::read_tree(dir) {
        Ok(tree) => tree,
        Err(e) if e.kind() == io::ErrorKind::PermissionDenied => {
            return Ok(FolderScan {
                folder,
                readable: false,
                notes: 0,
                images: 0,
                imported: 0,
                titles: Vec::new(),
            })
        }
        Err(e) => return Err(unreadable(e)),
    };
    let done = locked(state)?.imported_ids(kind.source)?;
    let pages: Vec<&markdown::Page> = tree.pages.iter().filter(|p| (kind.keep)(p)).collect();
    let imported = pages
        .iter()
        .filter(|p| done.contains(&(kind.id)(dir, p)))
        .count();
    let titles = pages
        .iter()
        .filter(|p| !done.contains(&(kind.id)(dir, p)))
        .take(SAMPLE_TITLES)
        .map(|p| title(p).to_string())
        .collect();
    Ok(FolderScan {
        folder,
        readable: true,
        notes: pages.len(),
        images: tree.images(),
        imported,
        titles,
    })
}

fn import_tree(
    state: &State<'_, AppState>,
    app: &AppHandle,
    dir: &Path,
    kind: &Kind,
    space: Option<String>,
    convert: impl Fn(
        &markdown::Tree,
        &markdown::Page,
        &mut dyn FnMut(&Path) -> Option<String>,
    ) -> markdown::Note,
) -> CmdResult<ImportOutcome> {
    let tree = markdown::read_tree(dir).map_err(unreadable)?;
    let done = locked(state)?.imported_ids(kind.source)?;
    let attachments = attachments_dir(app)?;
    let mut already = 0;
    let items: Vec<ImportItem> = tree
        .pages
        .iter()
        .filter(|page| (kind.keep)(page))
        .filter(|page| {
            let fresh = !done.contains(&(kind.id)(dir, page));
            already += usize::from(!fresh);
            fresh
        })
        .map(|page| {
            let note = convert(&tree, page, &mut |path| copy_image_at(&attachments, path));
            ImportItem {
                source_id: (kind.id)(dir, page),
                body: note.body,
                tags: note.tags,
                created_at: note.created_at.unwrap_or(page.created_at),
                updated_at: note.updated_at.unwrap_or(page.updated_at),
            }
        })
        .collect();
    let mut outcome = locked(state)?.import_notes(kind.source, items, space.as_deref())?;
    outcome.skipped += already;
    request_vault_sync(app);
    if outcome.imported > 0 {
        emit_notes_changed(app);
        emit_tags_changed(app);
        emit_workspaces_changed(app);
    }
    Ok(outcome)
}

fn unpack(zip: &Path) -> CmdResult<PathBuf> {
    let temp = std::env::temp_dir();
    sweep_unpacked(&temp);
    let dir = temp.join(format!("{UNPACK_PREFIX}{}", uuid::Uuid::new_v4()));
    let mut budget = MAX_EXPORT_BYTES;
    let mut entries = 0;
    match unpack_into(zip, &dir, &mut budget, &mut entries, true) {
        Ok(()) => Ok(dir),
        Err(e) => {
            let _ = std::fs::remove_dir_all(&dir);
            Err(CmdError::validation(format!(
                "couldn't open that Notion export: {e}"
            )))
        }
    }
}

fn unpack_into(
    zip: &Path,
    dir: &Path,
    budget: &mut u64,
    entries: &mut usize,
    outer: bool,
) -> io::Result<()> {
    use std::io::Read;
    let mut archive = zip::ZipArchive::new(std::fs::File::open(zip)?).map_err(io::Error::other)?;
    let mut nested = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(io::Error::other)?;
        let Some(rel) = entry.enclosed_name() else {
            continue;
        };
        if entry.is_symlink() || rel.components().any(|c| c.as_os_str() == "__MACOSX") {
            continue;
        }
        let out = dir.join(&rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out)?;
            continue;
        }
        *entries += 1;
        if *entries > MAX_EXPORT_ENTRIES {
            return Err(io::Error::other("it holds too many files"));
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut file = std::fs::File::create(&out)?;
        let written = io::copy(&mut (&mut entry).take(*budget + 1), &mut file)?;
        if written > *budget {
            return Err(io::Error::other("it is too large to unpack"));
        }
        *budget -= written;
        if outer
            && out
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("zip"))
        {
            nested.push(out);
        }
    }
    drop(archive);
    for inner in nested {
        unpack_into(&inner, &inner.with_extension(""), budget, entries, false)?;
        std::fs::remove_file(&inner)?;
    }
    Ok(())
}

fn is_unpacked(temp: &Path, dir: &Path) -> bool {
    dir.parent() == Some(temp)
        && dir
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with(UNPACK_PREFIX))
}

fn sweep_unpacked(temp: &Path) {
    let Ok(entries) = std::fs::read_dir(temp) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if is_unpacked(temp, &path) && path.is_dir() {
            let _ = std::fs::remove_dir_all(&path);
        }
    }
}

fn remove_unpacked(dir: &Path) {
    let temp = std::env::temp_dir();
    if let Some(unpacked) = dir.ancestors().find(|a| is_unpacked(&temp, a)) {
        let _ = std::fs::remove_dir_all(unpacked);
    }
}

fn is_one_component(name: &str) -> bool {
    let mut parts = Path::new(name).components();
    matches!(
        (parts.next(), parts.next()),
        (Some(Component::Normal(_)), None)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("instantnotes-import-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n not really the rest of a png";

    #[test]
    fn only_a_plain_file_name_is_an_attachment_name() {
        for ok in ["Attachment.png", "Pasted Graphic 2.tiff", "a..b.png"] {
            assert!(is_one_component(ok), "{ok}");
        }
        for bad in ["", ".", "..", "../x.png", "a/b.png", "/etc/passwd"] {
            assert!(!is_one_component(bad), "{bad}");
        }
    }

    #[test]
    fn an_image_in_the_package_is_copied_in_under_a_new_name() {
        let (package, attachments) = (Scratch::new(), Scratch::new());
        std::fs::write(package.0.join("Attachment.png"), PNG).unwrap();
        let stored = copy_image(&attachments.0, &package.0, "Attachment.png").unwrap();
        assert!(stored.ends_with(".png") && stored != "Attachment.png");
        assert_eq!(std::fs::read(attachments.0.join(&stored)).unwrap(), PNG);
    }

    #[test]
    fn a_name_that_leaves_the_package_is_refused() {
        let (root, attachments) = (Scratch::new(), Scratch::new());
        let package = root.0.join("A.rtfd");
        std::fs::create_dir(&package).unwrap();
        std::fs::write(root.0.join("outside.png"), PNG).unwrap();
        assert_eq!(copy_image(&attachments.0, &package, "../outside.png"), None);
        assert_eq!(std::fs::read_dir(&attachments.0).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn a_link_inside_the_package_is_not_followed() {
        let (package, elsewhere, attachments) = (Scratch::new(), Scratch::new(), Scratch::new());
        std::fs::write(elsewhere.0.join("secret.png"), PNG).unwrap();
        std::os::unix::fs::symlink(elsewhere.0.join("secret.png"), package.0.join("a.png"))
            .unwrap();
        assert_eq!(copy_image(&attachments.0, &package.0, "a.png"), None);
    }

    fn zipped(files: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write;
        let mut w = zip::ZipWriter::new(io::Cursor::new(Vec::new()));
        let stored = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (name, bytes) in files {
            w.start_file(*name, stored).unwrap();
            w.write_all(bytes).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    fn unpack_all(zip: &Path, dir: &Path, budget: u64) -> io::Result<()> {
        let mut budget = budget;
        let mut entries = 0;
        unpack_into(zip, dir, &mut budget, &mut entries, true)
    }

    #[test]
    fn an_entry_that_would_leave_the_folder_is_skipped() {
        let root = Scratch::new();
        let zip = root.0.join("Export.zip");
        std::fs::write(
            &zip,
            zipped(&[("../escaped.md", b"no"), ("Page.md", b"# Page")]),
        )
        .unwrap();
        let out = root.0.join("out");
        unpack_all(&zip, &out, MAX_EXPORT_BYTES).unwrap();
        assert_eq!(std::fs::read(out.join("Page.md")).unwrap(), b"# Page");
        assert!(!root.0.join("escaped.md").exists());
    }

    #[test]
    fn a_zip_inside_the_export_is_unpacked_in_its_place() {
        let root = Scratch::new();
        let inner = zipped(&[("Inner Page.md", b"# Inner")]);
        let zip = root.0.join("Export.zip");
        std::fs::write(&zip, zipped(&[("Part-1.zip", &inner)])).unwrap();
        let out = root.0.join("out");
        unpack_all(&zip, &out, MAX_EXPORT_BYTES).unwrap();
        assert_eq!(
            std::fs::read(out.join("Part-1").join("Inner Page.md")).unwrap(),
            b"# Inner"
        );
        assert!(!out.join("Part-1.zip").exists());
    }

    #[test]
    fn unpacking_stops_once_the_byte_budget_is_spent() {
        let root = Scratch::new();
        let zip = root.0.join("Export.zip");
        std::fs::write(&zip, zipped(&[("Big.md", &[b'x'; 64])])).unwrap();
        let err = unpack_all(&zip, &root.0.join("out"), 10).unwrap_err();
        assert!(err.to_string().contains("too large"), "{err}");
    }

    #[test]
    fn only_an_unpacked_export_in_the_temp_folder_is_removed() {
        let temp = std::env::temp_dir();
        let unpacked = temp.join(format!("{UNPACK_PREFIX}{}", uuid::Uuid::new_v4()));
        let inside = unpacked.join("Export").join("Pages");
        std::fs::create_dir_all(&inside).unwrap();
        remove_unpacked(&inside);
        assert!(!unpacked.exists());

        let other = Scratch::new();
        let kept = other.0.join("Export");
        std::fs::create_dir_all(&kept).unwrap();
        remove_unpacked(&kept);
        assert!(kept.exists());
    }

    #[test]
    fn a_file_that_is_no_image_is_not_brought_in() {
        let (package, attachments) = (Scratch::new(), Scratch::new());
        std::fs::write(
            package.0.join("notes.png"),
            b"plain text, whatever the name says",
        )
        .unwrap();
        assert_eq!(copy_image(&attachments.0, &package.0, "notes.png"), None);
    }
}
