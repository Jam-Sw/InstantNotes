//! Path-validated byte I/O for paths the user picks through native dialogs:
//! portable `.intheme.json` themes, note export, and pasted/dropped image
//! attachments. The dialogs run in JS; Rust only reads/writes the chosen path,
//! so no broad filesystem capability is needed.

use crate::*;

/// Reject anything that isn't an absolute path to a `.json` file. The path is
/// chosen by the user through a native save/open dialog but arrives here from the
/// webview, so this guard keeps the command from becoming a way to read or write
/// arbitrary files anywhere on disk.
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
    let is_allowed = p
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "md" | "txt" | "excalidraw"));
    if !is_allowed {
        return Err(CmdError::storage(
            "export file must have a .md, .txt, or .excalidraw extension",
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

// Pasted/dropped images live as files under <app data>/attachments and notes
// reference them by relative `attachments/<name>` markdown paths, so exported
// markdown stays portable and the DB stays lean. The webview reads them back
// through the asset protocol (scoped to this directory in tauri.conf.json).

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

/// Store one image. The body is the raw bytes (not JSON) so a screenshot paste
/// doesn't pay for number-array serialization; the extension rides in a header.
/// Returns the generated filename; the caller builds `attachments/<name>`.
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
    // Best effort: a vault that can't take it now gets it at next launch.
    let _ = mirror_attachments(&app);
    Ok(name)
}

/// Write one image into the attachments folder under a new name. The caller
/// builds `attachments/<name>` and mirrors the folder into the vault.
fn write_attachment(dir: &std::path::Path, bytes: &[u8], ext: &str) -> CmdResult<String> {
    let name = format!("{}.{ext}", uuid::Uuid::new_v4());
    std::fs::write(dir.join(&name), bytes)
        .map_err(|e| CmdError::storage(format!("could not write attachment: {e}")))?;
    Ok(name)
}

/// Store image bytes brought in from elsewhere (an imported sticky): PNG,
/// JPEG, GIF, and WebP as they are, known by their first bytes rather than a
/// file name; anything else converted to PNG where the system can.
pub(crate) fn store_image(dir: &std::path::Path, bytes: &[u8]) -> CmdResult<String> {
    if let Some(ext) = sniff_image(bytes) {
        return write_attachment(dir, bytes, ext);
    }
    let png =
        to_png(bytes).ok_or_else(|| CmdError::validation("not an image this app can show"))?;
    write_attachment(dir, &png, "png")
}

/// The attachment extension for bytes in a format every webview shows.
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

/// TIFF (a pasted "Pasted Graphic.tiff"), HEIC, BMP, and the rest ImageIO
/// reads, as PNG, by the system's own `sips`. It works on a copy in a fresh
/// temporary folder, so it never reads the folder the image came from.
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

/// Copy an image the user picked through a file dialog into the attachments
/// directory (the "copy in" storage mode). Returns the stored filename; the
/// caller builds `attachments/<name>`, exactly like a pasted image.
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
    let _ = mirror_attachments(&app);
    Ok(name)
}

/// Allow one existing local image to load through the asset protocol (the
/// "link the original file" storage mode). Only an existing image file is
/// permitted, and only that specific file, so the scope is never widened to a
/// whole directory. Idempotent: re-allowing on every note open is fine.
#[tauri::command(async)]
pub fn allow_image_file(app: AppHandle, path: String) -> CmdResult<()> {
    let p = std::path::Path::new(&path);
    if !p.is_absolute() {
        return Err(CmdError::validation("image path must be absolute"));
    }
    image_ext(p)?;
    if !p.is_file() {
        return Err(CmdError::storage("image file not found"));
    }
    app.asset_protocol_scope()
        .allow_file(p)
        .map_err(|e| CmdError::storage(format!("could not allow image: {e}")))?;
    Ok(())
}

/// Reveal the attachments folder in the OS file manager, from the Images
/// settings page. Uses the opener from Rust (like `open_url`), so it needs no
/// frontend opener capability.
#[tauri::command(async)]
pub fn open_attachments_folder(app: AppHandle) -> CmdResult<()> {
    let dir = attachments_dir(&app)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| CmdError::storage(format!("could not open attachments folder: {e}")))?;
    Ok(())
}

/// How long the Settings cleanup leaves a new image alone: a fresh paste can
/// belong to an edit that has not saved yet.
const CLEANUP_GRACE: std::time::Duration = std::time::Duration::from_secs(3600);

/// Stored images nothing references, older than `CLEANUP_GRACE`, with their
/// total size.
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

/// How many stored images no note uses any more, for Settings > Images.
#[tauri::command(async)]
pub fn unused_attachments(
    state: State<'_, AppState>,
    app: AppHandle,
) -> CmdResult<AttachmentCleanup> {
    let dir = attachments_dir(&app)?;
    let store = locked(&state)?;
    Ok(unused_attachment_files(&store, &dir)?.1)
}

/// Remove the stored images no note uses (and their unchanged copies in the
/// live vault). The store stays locked throughout, so nothing can start
/// referencing one of them mid-cleanup.
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

/// Best-effort count and total byte size of stored attachments, for the
/// dashboard. A missing or unreadable directory reports zero rather than
/// failing the whole stats call.
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
        export_theme_file, import_theme_file, sniff_image, store_image, validate_export_path,
    };

    /// A real PNG, the one `textutil` put in the Stickies fixture.
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
        // A genuine TIFF, as a pasted "Pasted Graphic.tiff" would be.
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
    fn note_export_accepts_markdown_text_and_excalidraw_only() {
        // What counts as absolute is platform specific: on Windows a leading
        // separator is not enough without a drive prefix, so "/tmp/a.md" is a
        // relative path there and would fail the absolute check before the
        // extension is ever looked at. Build the fixtures from temp_dir(),
        // which is absolute everywhere.
        let dir = std::env::temp_dir();
        let path = |name: &str| dir.join(name).to_string_lossy().into_owned();

        for name in ["a.md", "a.TXT", "board.excalidraw"] {
            let p = path(name);
            assert!(validate_export_path(&p).is_ok(), "{p}");
        }
        for name in ["a.json", "a"] {
            let p = path(name);
            assert!(validate_export_path(&p).is_err(), "{p}");
        }
        // A relative path is refused whatever its extension.
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
        // Relative path -> rejected before any filesystem access.
        assert!(export_theme_file("relative/theme.json".into(), "{}".into()).is_err());
        assert!(import_theme_file("relative/theme.json".into()).is_err());
        // Absolute but not a .json file -> rejected.
        assert!(import_theme_file("/tmp/not-a-theme.txt".into()).is_err());
    }
}
