//! In-app feedback: append one submission to `feedback.jsonl` in the app data
//! directory. This is the durable local record; delivery to the project (a
//! prefilled GitHub issue) happens on the frontend through `open_url`.

use crate::*;
use std::io::Write;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackInput {
    category: String,
    message: String,
    #[serde(default)]
    app_version: Option<String>,
    /// Opt-in diagnostics snapshot (version, platform, stats). Whatever the
    /// user agreed to attach, stored verbatim so the record matches what was
    /// shown to them.
    #[serde(default)]
    diagnostics: Option<serde_json::Value>,
}

fn feedback_log_path(app: &AppHandle) -> CmdResult<std::path::PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| CmdError::storage(format!("no app data dir: {e}")))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| CmdError::storage(format!("could not create data dir: {e}")))?;
    Ok(dir.join("feedback.jsonl"))
}

#[tauri::command(async)]
pub fn submit_feedback(app: AppHandle, input: FeedbackInput) -> CmdResult<()> {
    let message = input.message.trim();
    if message.is_empty() {
        return Err(CmdError::validation("feedback message is empty"));
    }
    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let entry = serde_json::json!({
        "at": at,
        "category": input.category,
        "message": message,
        "appVersion": input.app_version,
        "diagnostics": input.diagnostics,
    });
    let line = serde_json::to_string(&entry)
        .map_err(|e| CmdError::storage(format!("could not encode feedback: {e}")))?;

    let path = feedback_log_path(&app)?;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| CmdError::storage(format!("could not open feedback log: {e}")))?;
    writeln!(file, "{line}")
        .map_err(|e| CmdError::storage(format!("could not write feedback: {e}")))?;
    Ok(())
}

/// Reveal `feedback.jsonl` in the OS file manager, from the Feedback settings
/// page — the only way a user can see what has accumulated there, since
/// nothing else surfaces or prunes it (recorded in
/// `openspec/changes/archive/feat-in-app-feedback/tasks.md`). Reveals rather
/// than opens: the file is meant to be located, not edited.
#[tauri::command(async)]
pub fn open_feedback_log(app: AppHandle) -> CmdResult<()> {
    let path = feedback_log_path(&app)?;
    if !path.exists() {
        std::fs::write(&path, "")
            .map_err(|e| CmdError::storage(format!("could not create feedback log: {e}")))?;
    }
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| CmdError::storage(format!("could not reveal feedback log: {e}")))?;
    Ok(())
}
