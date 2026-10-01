//! Reading an Apple Stickies folder: one `<UUID>.rtfd` package per sticky,
//! and `.SavedStickiesState` for their colors. Nothing here writes; see the
//! feat-stickies-import design, sections 1 and 3.

use super::rtf::MAX_RTF_BYTES;
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Where Stickies keeps its notes, under the user's home folder (macOS).
pub const STICKIES_DIR: &str = "Library/Containers/com.apple.Stickies/Data/Library/Stickies";
const STATE_FILE: &str = ".SavedStickiesState";
const TEXT_FILE: &str = "TXT.rtf";

pub struct Sticky {
    /// The package name without `.rtfd`, upper-cased: the sticky's UUID.
    pub id: String,
    /// The package folder, which also holds its attachments.
    pub package: PathBuf,
    pub rtf: Vec<u8>,
    /// `#rrggbb`, when the state file knows the sticky.
    pub color: Option<String>,
    pub created_at: SystemTime,
    pub updated_at: SystemTime,
}

/// The folder that holds the packages. Picking Stickies' container, or a
/// folder on the way down to its notes, finds them.
pub fn resolve_folder(dir: &Path) -> PathBuf {
    ["Data/Library/Stickies", "Library/Stickies", "Stickies"]
        .iter()
        .map(|tail| dir.join(tail))
        .find(|candidate| candidate.is_dir())
        .unwrap_or_else(|| dir.to_path_buf())
}

/// Every sticky in `dir`, most recently changed first. Fails only when `dir`
/// itself cannot be listed (`PermissionDenied` is how macOS refuses another
/// app's data); a package that cannot be read is left out.
pub fn read_folder(dir: &Path) -> io::Result<Vec<Sticky>> {
    let colors = read_colors(&dir.join(STATE_FILE));
    let mut stickies: Vec<Sticky> = fs::read_dir(dir)?
        .filter_map(|entry| read_package(&entry.ok()?.path(), &colors))
        .collect();
    stickies.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(stickies)
}

fn read_package(package: &Path, colors: &HashMap<String, String>) -> Option<Sticky> {
    let name = package.file_name()?.to_str()?;
    let id = name.strip_suffix(".rtfd")?.to_uppercase();
    if id.is_empty() || id.starts_with('.') {
        return None;
    }
    // A flat `.rtfd` file is a sticky Stickies has not saved yet, and a
    // symlink is not one of its packages.
    let meta = fs::symlink_metadata(package).ok()?;
    if !meta.is_dir() {
        return None;
    }
    let text = package.join(TEXT_FILE);
    let text_meta = fs::symlink_metadata(&text).ok()?;
    if !text_meta.is_file() || text_meta.len() > MAX_RTF_BYTES as u64 {
        return None;
    }
    let rtf = fs::read(&text).ok()?;
    let updated_at = text_meta.modified().ok()?;
    // Every save replaces TXT.rtf; the package lives as long as the sticky.
    let created_at = meta
        .created()
        .or_else(|_| meta.modified())
        .unwrap_or(updated_at)
        .min(updated_at);
    Some(Sticky {
        color: colors.get(&id).cloned(),
        id,
        package: package.to_path_buf(),
        rtf,
        created_at,
        updated_at,
    })
}

/// UUID to `#rrggbb`, from the state file. Anything unreadable costs only
/// the colors.
fn read_colors(path: &Path) -> HashMap<String, String> {
    let entries = match plist::Value::from_file(path) {
        Ok(plist::Value::Array(entries)) => entries,
        // A future wrapper around the list: take the longest list inside.
        Ok(plist::Value::Dictionary(d)) => d
            .into_iter()
            .filter_map(|(_, v)| v.into_array())
            .max_by_key(Vec::len)
            .unwrap_or_default(),
        _ => return HashMap::new(),
    };
    entries
        .iter()
        .filter_map(|entry| {
            let entry = entry.as_dictionary()?;
            let id = entry.get("UUID")?.as_string()?.to_uppercase();
            let color = entry.get("StickyColor")?.as_dictionary()?;
            let channel = |key: &str| {
                let v = color.get(key)?;
                let x = v
                    .as_real()
                    .or_else(|| v.as_signed_integer().map(|i| i as f64))?;
                Some((x.clamp(0.0, 1.0) * 255.0).round() as u8)
            };
            let hex = format!(
                "#{:02x}{:02x}{:02x}",
                channel("Red")?,
                channel("Green")?,
                channel("Blue")?
            );
            Some((id, hex))
        })
        .collect()
}
