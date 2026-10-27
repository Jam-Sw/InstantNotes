use crate::*;

fn validate_theme_path(path: &str) -> CmdResult<()> {
    let p = std::path::Path::new(path);
    if !p.is_absolute() {
        return Err(CmdError::storage("theme path must be absolute"));
    }
    let is_json = p
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("json"));
    if !is_json {
        return Err(CmdError::storage("theme file must have a .json extension"));
    }
    Ok(())
}

#[tauri::command(async)]
pub fn export_theme_file(path: String, contents: String) -> CmdResult<()> {
    validate_theme_path(&path)?;
    std::fs::write(&path, contents)
        .map_err(|e| CmdError::storage(format!("could not write theme file: {e}")))
}

#[tauri::command(async)]
pub fn import_theme_file(path: String) -> CmdResult<String> {
    validate_theme_path(&path)?;
    std::fs::read_to_string(&path)
        .map_err(|e| CmdError::storage(format!("could not read theme file: {e}")))
}

fn validate_export_path(path: &str) -> CmdResult<()> {
    let p = std::path::Path::new(path);
    if !p.is_absolute() {
        return Err(CmdError::storage("export path must be absolute"));
    }
    let is_allowed = p.extension().and_then(|e| e.to_str()).is_some_and(|e| {
        matches!(
            e.to_ascii_lowercase().as_str(),
            "md" | "txt" | "excalidraw" | "csv"
        )
    });
    if !is_allowed {
        return Err(CmdError::storage(
            "export file must have a .md, .txt, .excalidraw, or .csv extension",
        ));
    }
    Ok(())
}

#[tauri::command(async)]
pub fn export_note_file(path: String, contents: String) -> CmdResult<()> {
    validate_export_path(&path)?;
    std::fs::write(&path, contents)
        .map_err(|e| CmdError::storage(format!("could not write export file: {e}")))
}

const ATTACHMENT_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];

pub fn attachments_dir(app: &AppHandle) -> CmdResult<std::path::PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| CmdError::storage(format!("no app data dir: {e}")))?
        .join("attachments");
    std::fs::create_dir_all(&dir)
        .map_err(|e| CmdError::storage(format!("could not create attachments dir: {e}")))?;
    Ok(dir)
}

#[tauri::command(async)]
pub fn get_attachments_dir(app: AppHandle) -> CmdResult<String> {
    Ok(attachments_dir(&app)?.to_string_lossy().into_owned())
}

#[tauri::command(async)]
pub fn save_attachment(app: AppHandle, request: tauri::ipc::Request<'_>) -> CmdResult<String> {
    let ext = request
        .headers()
        .get("x-attachment-ext")
        .and_then(|v| v.to_str().ok())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !ATTACHMENT_EXTS.contains(&ext.as_str()) {
        return Err(CmdError::validation(format!(
            "unsupported attachment type: {ext:?}"
        )));
    }
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(CmdError::validation("attachment body must be raw bytes"));
    };
    if bytes.is_empty() {
        return Err(CmdError::validation("attachment is empty"));
    }
    let name = write_attachment(&attachments_dir(&app)?, bytes, &ext)?;
    request_vault_sync(&app);
    Ok(name)
}

fn write_attachment(dir: &std::path::Path, bytes: &[u8], ext: &str) -> CmdResult<String> {
    let name = format!("{}.{ext}", uuid::Uuid::new_v4());
    std::fs::write(dir.join(&name), bytes)
        .map_err(|e| CmdError::storage(format!("could not write attachment: {e}")))?;
    Ok(name)
}

pub(crate) fn store_image(dir: &std::path::Path, bytes: &[u8]) -> CmdResult<String> {
    if let Some(ext) = sniff_image(bytes) {
        return write_attachment(dir, bytes, ext);
    }
    let png =
        to_png(bytes).ok_or_else(|| CmdError::validation("not an image this app can show"))?;
    write_attachment(dir, &png, "png")
}

fn sniff_image(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") {
        Some("gif")
    } else if b.len() >= 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

#[cfg(target_os = "macos")]
fn to_png(bytes: &[u8]) -> Option<Vec<u8>> {
    use std::process::{Command, Stdio};
    let tmp = std::env::temp_dir().join(format!("instantnotes-image-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&tmp).ok()?;
    let (src, out) = (tmp.join("source"), tmp.join("converted.png"));
    let png = std::fs::write(&src, bytes).ok().and_then(|()| {
        let converted = Command::new("/usr/bin/sips")
            .args(["-s", "format", "png"])
            .arg(&src)
            .arg("--out")
            .arg(&out)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .ok()?
            .success();
        converted.then(|| std::fs::read(&out).ok()).flatten()
    });
    let _ = std::fs::remove_dir_all(&tmp);
    png.filter(|png| sniff_image(png) == Some("png"))
}

#[cfg(not(target_os = "macos"))]
fn to_png(_bytes: &[u8]) -> Option<Vec<u8>> {
    None
}

fn image_ext(path: &std::path::Path) -> CmdResult<String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !ATTACHMENT_EXTS.contains(&ext.as_str()) {
        return Err(CmdError::validation(format!(
            "unsupported image type: {ext:?}"
        )));
    }
    Ok(ext)
}

#[tauri::command(async)]
pub fn import_image_file(app: AppHandle, path: String) -> CmdResult<String> {
    let src = std::path::Path::new(&path);
    if !src.is_absolute() {
        return Err(CmdError::validation("image path must be absolute"));
    }
    let ext = image_ext(src)?;
    let bytes =
        std::fs::read(src).map_err(|e| CmdError::storage(format!("could not read image: {e}")))?;
    if bytes.is_empty() {
        return Err(CmdError::validation("image is empty"));
    }
    let name = write_attachment(&attachments_dir(&app)?, &bytes, &ext)?;
    request_vault_sync(&app);
    Ok(name)
}

pub const LINKED_FOLDERS_KEY: &str = "images.linkedFolders";
const FOLDERS_SHOWN: usize = 5;

#[derive(Default)]
pub struct LinkedImageState {
    declined: Mutex<std::collections::HashSet<std::path::PathBuf>>,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum LinkedImage {
    Allow,
    Ask(std::path::PathBuf),
    Skip,
}

pub(crate) fn linked_image_decision(
    canonical: &std::path::Path,
    roots: &[std::path::PathBuf],
    allowed: &[std::path::PathBuf],
    declined: &std::collections::HashSet<std::path::PathBuf>,
) -> LinkedImage {
    if roots
        .iter()
        .chain(allowed)
        .any(|dir| canonical.starts_with(dir))
    {
        return LinkedImage::Allow;
    }
    match canonical.parent() {
        Some(folder) if declined.contains(folder) => LinkedImage::Skip,
        Some(folder) => LinkedImage::Ask(folder.to_path_buf()),
        None => LinkedImage::Skip,
    }
}

fn linked_folders(store: &Store) -> Vec<std::path::PathBuf> {
    match store.get_setting(LINKED_FOLDERS_KEY) {
        Ok(Some(serde_json::Value::Array(items))) => items
            .iter()
            .filter_map(serde_json::Value::as_str)
            .map(std::path::PathBuf::from)
            .collect(),
        _ => Vec::new(),
    }
}

fn remember_folders(store: &mut Store, folders: &[std::path::PathBuf]) -> CmdResult<bool> {
    let mut known = linked_folders(store);
    let before = known.len();
    for folder in folders {
        if !known.contains(folder) {
            known.push(folder.clone());
        }
    }
    if known.len() == before {
        return Ok(false);
    }
    let listed: Vec<String> = known
        .iter()
        .map(|f| f.to_string_lossy().into_owned())
        .collect();
    store.set_setting(LINKED_FOLDERS_KEY, serde_json::json!(listed))?;
    Ok(true)
}

fn settled(dir: &std::path::Path) -> std::path::PathBuf {
    std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf())
}

pub(crate) fn canonical_image(path: &str) -> Option<std::path::PathBuf> {
    let p = std::path::Path::new(path);
    if !p.is_absolute() || image_ext(p).is_err() {
        return None;
    }
    let canonical = std::fs::canonicalize(p).ok()?;
    canonical.is_file().then_some(canonical)
}

fn allow_asset(
    app: &AppHandle,
    shown: &std::path::Path,
    canonical: &std::path::Path,
) -> CmdResult<()> {
    let scope = app.asset_protocol_scope();
    for p in [shown, canonical] {
        scope
            .allow_file(p)
            .map_err(|e| CmdError::storage(format!("could not allow image: {e}")))?;
    }
    Ok(())
}

pub(crate) fn folder_lines(folders: &[std::path::PathBuf]) -> String {
    let mut lines: Vec<String> = folders
        .iter()
        .take(FOLDERS_SHOWN)
        .map(|f| f.to_string_lossy().into_owned())
        .collect();
    if folders.len() > FOLDERS_SHOWN {
        lines.push(format!("+{} more", folders.len() - FOLDERS_SHOWN));
    }
    lines.join("\n")
}

fn ask_about_folders(app: &AppHandle, folders: &[std::path::PathBuf]) -> bool {
    app.dialog()
        .message(format!(
            "This note links to images in:\n{}\n\nInstantNotes loads images only from its attachments, your vault folder and folders you allow. Allowing a folder lets any note show images from it, now and later. Settings > Images lists them.",
            folder_lines(folders)
        ))
        .title("Show images from outside your library?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Allow".into(),
            "Keep hidden".into(),
        ))
        .blocking_show()
}

#[tauri::command(async)]
pub fn allow_linked_images(
    state: State<'_, AppState>,
    linked: State<'_, LinkedImageState>,
    app: AppHandle,
    paths: Vec<String>,
) -> CmdResult<Vec<String>> {
    let (roots, allowed) = {
        let store = locked(&state)?;
        let roots: Vec<_> = store.vault_root().map(settled).into_iter().collect();
        let allowed: Vec<_> = linked_folders(&store).iter().map(|f| settled(f)).collect();
        (roots, allowed)
    };
    let mut granted = Vec::new();
    let mut asking: Vec<std::path::PathBuf> = Vec::new();
    let mut waiting: Vec<(String, std::path::PathBuf)> = Vec::new();
    {
        let declined = linked
            .declined
            .lock()
            .map_err(|_| CmdError::storage("linked image state lock poisoned"))?;
        for path in paths {
            let Some(canonical) = canonical_image(&path) else {
                continue;
            };
            match linked_image_decision(&canonical, &roots, &allowed, &declined) {
                LinkedImage::Allow => {
                    allow_asset(&app, std::path::Path::new(&path), &canonical)?;
                    granted.push(path);
                }
                LinkedImage::Ask(folder) => {
                    if !asking.contains(&folder) {
                        asking.push(folder);
                    }
                    waiting.push((path, canonical));
                }
                LinkedImage::Skip => {}
            }
        }
    }
    if asking.is_empty() {
        return Ok(granted);
    }
    if ask_about_folders(&app, &asking) {
        let changed = {
            let mut store = locked(&state)?;
            remember_folders(&mut store, &asking)?
        };
        if changed {
            let _ = app.emit(events::SETTINGS_CHANGED, ());
        }
        for (path, canonical) in waiting {
            allow_asset(&app, std::path::Path::new(&path), &canonical)?;
            granted.push(path);
        }
    } else if let Ok(mut declined) = linked.declined.lock() {
        declined.extend(asking);
    }
    Ok(granted)
}

#[tauri::command(async)]
pub fn pick_linked_image(state: State<'_, AppState>, app: AppHandle) -> CmdResult<Option<String>> {
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter("Images", ATTACHMENT_EXTS)
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| CmdError::storage(format!("could not use the picked file: {e}")))?;
    let shown = path.to_string_lossy().into_owned();
    let canonical = canonical_image(&shown)
        .ok_or_else(|| CmdError::validation("not an image this app can show"))?;
    allow_asset(&app, &path, &canonical)?;
    if let Some(folder) = canonical.parent() {
        let changed = {
            let mut store = locked(&state)?;
            remember_folders(&mut store, &[folder.to_path_buf()])?
        };
        if changed {
            let _ = app.emit(events::SETTINGS_CHANGED, ());
        }
    }
    Ok(Some(shown))
}

#[tauri::command(async)]
pub fn open_attachments_folder(app: AppHandle) -> CmdResult<()> {
    let dir = attachments_dir(&app)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| CmdError::storage(format!("could not open attachments folder: {e}")))?;
    Ok(())
}

const CLEANUP_GRACE: std::time::Duration = std::time::Duration::from_secs(3600);

fn unused_attachment_files(
    store: &Store,
    dir: &std::path::Path,
) -> CmdResult<(Vec<String>, AttachmentCleanup)> {
    let cutoff = std::time::SystemTime::now() - CLEANUP_GRACE;
    let files = instantnotes_core::attachments::list_attachments(dir, Some(cutoff))
        .map_err(|e| CmdError::storage(format!("could not list attachments: {e}")))?;
    let unused = store.unreferenced_attachments(files.iter().map(|(n, _)| n.clone()))?;
    let bytes = files
        .iter()
        .filter(|(n, _)| unused.contains(n))
        .map(|(_, size)| size)
        .sum();
    let summary = AttachmentCleanup {
        count: unused.len(),
        bytes,
    };
    Ok((unused, summary))
}

#[tauri::command(async)]
pub fn unused_attachments(
    state: State<'_, AppState>,
    app: AppHandle,
) -> CmdResult<AttachmentCleanup> {
    let dir = attachments_dir(&app)?;
    let store = locked(&state)?;
    Ok(unused_attachment_files(&store, &dir)?.1)
}

#[tauri::command(async)]
pub fn remove_unused_attachments(
    state: State<'_, AppState>,
    app: AppHandle,
) -> CmdResult<AttachmentCleanup> {
    let dir = attachments_dir(&app)?;
    let store = locked(&state)?;
    let (unused, _) = unused_attachment_files(&store, &dir)?;
    Ok(store.remove_unreferenced_attachments(&dir, unused)?)
}

pub fn attachments_stats(app: &AppHandle) -> (i64, i64) {
    let Ok(dir) = attachments_dir(app) else {
        return (0, 0);
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return (0, 0);
    };
    let (mut count, mut bytes) = (0i64, 0i64);
    for entry in entries.flatten() {
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                count += 1;
                bytes += meta.len() as i64;
            }
        }
    }
    (count, bytes)
}

#[cfg(test)]
mod tests {
    use super::{
        canonical_image, export_theme_file, folder_lines, import_theme_file, linked_image_decision,
        sniff_image, store_image, validate_export_path, LinkedImage,
    };
    use std::collections::HashSet;
    use std::path::{Path, PathBuf};

    #[test]
    fn a_linked_image_loads_from_the_vault_or_an_allowed_folder_and_asks_elsewhere() {
        let roots = [PathBuf::from("/home/me/vault")];
        let allowed = [PathBuf::from("/home/me/Pictures")];
        let mut declined = HashSet::new();
        let decide = |path: &str, declined: &HashSet<PathBuf>| {
            linked_image_decision(Path::new(path), &roots, &allowed, declined)
        };
        assert_eq!(
            decide("/home/me/vault/img/a.png", &declined),
            LinkedImage::Allow
        );
        assert_eq!(
            decide("/home/me/Pictures/2026/b.jpg", &declined),
            LinkedImage::Allow
        );
        assert_eq!(
            decide("/home/me/vaulted/c.png", &declined),
            LinkedImage::Ask(PathBuf::from("/home/me/vaulted"))
        );
        assert_eq!(decide("/", &declined), LinkedImage::Skip);
        declined.insert(PathBuf::from("/home/me/vaulted"));
        assert_eq!(
            decide("/home/me/vaulted/c.png", &declined),
            LinkedImage::Skip
        );
        assert_eq!(
            decide("/home/me/vaulted/deeper/d.png", &declined),
            LinkedImage::Ask(PathBuf::from("/home/me/vaulted/deeper"))
        );
    }

    #[test]
    fn the_dialog_lists_five_folders_and_counts_the_rest() {
        let folders: Vec<PathBuf> = (1..=7).map(|i| PathBuf::from(format!("/f{i}"))).collect();
        assert_eq!(folder_lines(&folders[..2]), "/f1\n/f2");
        assert_eq!(folder_lines(&folders), "/f1\n/f2\n/f3\n/f4\n/f5\n+2 more");
    }

    #[test]
    fn only_an_existing_absolute_image_file_resolves() {
        let dir =
            std::env::temp_dir().join(format!("instantnotes-linked-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let png = dir.join("a.png");
        std::fs::write(&png, PNG).unwrap();
        std::fs::write(dir.join("b.txt"), b"text").unwrap();
        let shown = |name: &str| dir.join(name).to_string_lossy().into_owned();

        assert_eq!(
            canonical_image(&shown("a.png")),
            Some(std::fs::canonicalize(&png).unwrap())
        );
        assert_eq!(canonical_image(&shown("b.txt")), None);
        assert_eq!(canonical_image(&shown("missing.png")), None);
        assert_eq!(canonical_image("relative/a.png"), None);
        assert_eq!(canonical_image(&dir.to_string_lossy()), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    const PNG: &[u8] = include_bytes!(
        "../../core/tests/fixtures/stickies/6E2F9C31-8B4A-4D7E-A1C5-2D9E7F3B8A64.rtfd/Attachment.png"
    );

    #[test]
    fn image_formats_are_known_by_their_first_bytes() {
        assert_eq!(sniff_image(PNG), Some("png"));
        assert_eq!(sniff_image(b"\xFF\xD8\xFF\xE0rest"), Some("jpg"));
        assert_eq!(sniff_image(b"GIF89a..."), Some("gif"));
        assert_eq!(sniff_image(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(sniff_image(b"II*\0 a tiff"), None);
        assert_eq!(sniff_image(b""), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_tiff_is_stored_as_a_png() {
        let dir = std::env::temp_dir().join(format!("instantnotes-tiff-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let (png, tiff) = (dir.join("in.png"), dir.join("in.tiff"));
        std::fs::write(&png, PNG).unwrap();
        let made = std::process::Command::new("/usr/bin/sips")
            .args(["-s", "format", "tiff"])
            .arg(&png)
            .arg("--out")
            .arg(&tiff)
            .output()
            .unwrap();
        assert!(made.status.success());
        let tiff_bytes = std::fs::read(&tiff).unwrap();
        assert_eq!(sniff_image(&tiff_bytes), None, "not a web format as it is");

        let attachments = dir.join("attachments");
        std::fs::create_dir(&attachments).unwrap();
        let stored = store_image(&attachments, &tiff_bytes).unwrap();
        assert!(stored.ends_with(".png"), "{stored}");
        let written = std::fs::read(attachments.join(&stored)).unwrap();
        assert_eq!(sniff_image(&written), Some("png"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn bytes_that_are_no_image_are_refused() {
        let dir = std::env::temp_dir().join(format!("instantnotes-noimg-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(store_image(&dir, b"just some text").is_err());
        assert_eq!(
            std::fs::read_dir(&dir).unwrap().count(),
            0,
            "nothing written"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn note_export_accepts_markdown_text_excalidraw_and_csv_only() {
        let dir = std::env::temp_dir();
        let path = |name: &str| dir.join(name).to_string_lossy().into_owned();

        for name in ["a.md", "a.TXT", "board.excalidraw", "sheet.csv"] {
            let p = path(name);
            assert!(validate_export_path(&p).is_ok(), "{p}");
        }
        for name in ["a.json", "a"] {
            let p = path(name);
            assert!(validate_export_path(&p).is_err(), "{p}");
        }
        assert!(validate_export_path("relative/a.md").is_err());
    }

    #[test]
    fn theme_file_round_trip() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!(
            "instantnotes-theme-{}.intheme.json",
            std::process::id()
        ));
        let path_str = path.to_string_lossy().to_string();
        let json = r#"{"id":"x","name":"X","version":1}"#.to_string();

        export_theme_file(path_str.clone(), json.clone()).expect("write");
        let read_back = import_theme_file(path_str.clone()).expect("read");
        assert_eq!(read_back, json);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn import_missing_file_errors() {
        let res = import_theme_file("/nonexistent/path/theme.intheme.json".into());
        assert!(res.is_err());
        assert_eq!(res.unwrap_err().code(), crate::error::ErrorCode::Storage);
    }

    #[test]
    fn theme_path_validation_rejects_non_absolute_and_non_json() {
        assert!(export_theme_file("relative/theme.json".into(), "{}".into()).is_err());
        assert!(import_theme_file("relative/theme.json".into()).is_err());
        assert!(import_theme_file("/tmp/not-a-theme.txt".into()).is_err());
    }
}
