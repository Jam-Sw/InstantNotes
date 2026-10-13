use crate::libraries::Library;
use instantnotes_core::attachments::Attachments;
use instantnotes_core::commands;
pub use instantnotes_core::commands::{Outcome, WEB_COMMANDS};
use instantnotes_core::AppError;
use serde_json::{json, Value};

pub fn dispatch(
    lib: &mut Library,
    cmd: &str,
    args: &Value,
    origin: Option<&str>,
) -> Result<Outcome, AppError> {
    if cmd == "app_version" {
        return Ok(Outcome {
            value: json!(env!("CARGO_PKG_VERSION")),
            changes: Vec::new(),
        });
    }
    let place = Attachments::Folder(lib.attachments.clone());
    commands::dispatch(&mut lib.store, &place, cmd, args, origin)
}

pub fn save_attachment(lib: &Library, bytes: &[u8], ext: &str) -> Result<String, AppError> {
    let name = commands::attachment_name(ext)?;
    if bytes.is_empty() {
        return Err(AppError::Validation("attachment is empty".into()));
    }
    std::fs::write(lib.attachments.join(&name), bytes)
        .map_err(|e| AppError::Storage(format!("could not write attachment: {e}")))?;
    Ok(name)
}

pub fn attachment_path(lib: &Library, name: &str) -> Option<std::path::PathBuf> {
    commands::valid_attachment_name(name).then(|| lib.attachments.join(name))
}
