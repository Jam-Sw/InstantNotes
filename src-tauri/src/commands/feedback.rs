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

#[tauri::command(async)]
pub fn submit_feedback(app: AppHandle, input: FeedbackInput) -> CmdResult<()> {
    let message = input.message.trim();
    if message.is_empty() {
        return Err(CmdError {
            code: "VALIDATION".into(),
            message: "feedback message is empty".into(),
        });
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
    let line = serde_json::to_string(&entry).map_err(|e| CmdError {
        code: "STORAGE_ERROR".into(),
        message: format!("could not encode feedback: {e}"),
    })?;

    let dir = app.path().app_data_dir().map_err(|e| CmdError {
        code: "STORAGE_ERROR".into(),
        message: format!("no app data dir: {e}"),
    })?;
    std::fs::create_dir_all(&dir).map_err(|e| CmdError {
        code: "STORAGE_ERROR".into(),
        message: format!("could not create data dir: {e}"),
    })?;
    let path = dir.join("feedback.jsonl");
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| CmdError {
            code: "STORAGE_ERROR".into(),
            message: format!("could not open feedback log: {e}"),
        })?;
    writeln!(file, "{line}").map_err(|e| CmdError {
        code: "STORAGE_ERROR".into(),
        message: format!("could not write feedback: {e}"),
    })?;
    Ok(())
}
