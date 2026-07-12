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
        return Err(CmdError {
            code: "STORAGE_ERROR".into(),
            message: "theme path must be absolute".into(),
        });
    }
    let is_json = p
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("json"));
    if !is_json {
        return Err(CmdError {
            code: "STORAGE_ERROR".into(),
            message: "theme file must have a .json extension".into(),
        });
    }
    Ok(())
}

#[tauri::command(async)]
pub fn export_theme_file(path: String, contents: String) -> CmdResult<()> {
    validate_theme_path(&path)?;
    std::fs::write(&path, contents).map_err(|e| CmdError {
        code: "STORAGE_ERROR".into(),
        message: format!("could not write theme file: {e}"),
    })
}

#[tauri::command(async)]
pub fn import_theme_file(path: String) -> CmdResult<String> {
    validate_theme_path(&path)?;
    std::fs::read_to_string(&path).map_err(|e| CmdError {
        code: "STORAGE_ERROR".into(),
        message: format!("could not read theme file: {e}"),
    })
}

fn validate_export_path(path: &str) -> CmdResult<()> {
    let p = std::path::Path::new(path);
    if !p.is_absolute() {
        return Err(CmdError {
            code: "STORAGE_ERROR".into(),
            message: "export path must be absolute".into(),
        });
    }
    let is_allowed = p
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "md" | "txt"));
    if !is_allowed {
        return Err(CmdError {
            code: "STORAGE_ERROR".into(),
            message: "export file must have a .md or .txt extension".into(),
        });
    }
    Ok(())
}

#[tauri::command(async)]
pub fn export_note_file(path: String, contents: String) -> CmdResult<()> {
    validate_export_path(&path)?;
    std::fs::write(&path, contents).map_err(|e| CmdError {
        code: "STORAGE_ERROR".into(),
        message: format!("could not write export file: {e}"),
    })
}

// Pasted/dropped images live as files under <app data>/attachments and notes
// reference them by relative `attachments/<name>` markdown paths, so exported
// markdown stays portable and the DB stays lean. The webview reads them back
// through the asset protocol (scoped to this directory in tauri.conf.json).

const ATTACHMENT_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];

fn attachments_dir(app: &AppHandle) -> CmdResult<std::path::PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| CmdError {
            code: "STORAGE_ERROR".into(),
            message: format!("no app data dir: {e}"),
        })?
        .join("attachments");
    std::fs::create_dir_all(&dir).map_err(|e| CmdError {
        code: "STORAGE_ERROR".into(),
        message: format!("could not create attachments dir: {e}"),
    })?;
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
        return Err(CmdError {
            code: "VALIDATION".into(),
            message: format!("unsupported attachment type: {ext:?}"),
        });
    }
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(CmdError {
            code: "VALIDATION".into(),
            message: "attachment body must be raw bytes".into(),
        });
    };
    if bytes.is_empty() {
        return Err(CmdError {
            code: "VALIDATION".into(),
            message: "attachment is empty".into(),
        });
    }
    let name = format!("{}.{ext}", uuid::Uuid::new_v4());
    let path = attachments_dir(&app)?.join(&name);
    std::fs::write(&path, bytes).map_err(|e| CmdError {
        code: "STORAGE_ERROR".into(),
        message: format!("could not write attachment: {e}"),
    })?;
    Ok(name)
}

fn image_ext(path: &std::path::Path) -> CmdResult<String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !ATTACHMENT_EXTS.contains(&ext.as_str()) {
        return Err(CmdError {
            code: "VALIDATION".into(),
            message: format!("unsupported image type: {ext:?}"),
        });
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
        return Err(CmdError {
            code: "VALIDATION".into(),
            message: "image path must be absolute".into(),
        });
    }
    let ext = image_ext(src)?;
    let bytes = std::fs::read(src).map_err(|e| CmdError {
        code: "STORAGE_ERROR".into(),
        message: format!("could not read image: {e}"),
    })?;
    if bytes.is_empty() {
        return Err(CmdError {
            code: "VALIDATION".into(),
            message: "image is empty".into(),
        });
    }
    let name = format!("{}.{ext}", uuid::Uuid::new_v4());
    let dest = attachments_dir(&app)?.join(&name);
    std::fs::write(&dest, bytes).map_err(|e| CmdError {
        code: "STORAGE_ERROR".into(),
        message: format!("could not write attachment: {e}"),
    })?;
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
        return Err(CmdError {
            code: "VALIDATION".into(),
            message: "image path must be absolute".into(),
        });
    }
    image_ext(p)?;
    if !p.is_file() {
        return Err(CmdError {
            code: "STORAGE_ERROR".into(),
            message: "image file not found".into(),
        });
    }
    app.asset_protocol_scope()
        .allow_file(p)
        .map_err(|e| CmdError {
            code: "STORAGE_ERROR".into(),
            message: format!("could not allow image: {e}"),
        })?;
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
        .map_err(|e| CmdError {
            code: "STORAGE_ERROR".into(),
            message: format!("could not open attachments folder: {e}"),
        })?;
    Ok(())
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
    use super::{export_theme_file, import_theme_file};

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
        assert_eq!(res.unwrap_err().code, "STORAGE_ERROR");
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
