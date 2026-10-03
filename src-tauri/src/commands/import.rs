//! Settings > Import: Apple Stickies into the library. Reading a Stickies
//! folder and converting its RTF live in `instantnotes_core::import`; this
//! module copies in the images a sticky refers to and hands the notes to the
//! store. Nothing here ever writes under the chosen folder.

use crate::*;
use instantnotes_core::domain::derive_title;
use instantnotes_core::import::{rtf, stickies};
use instantnotes_core::store::iso;
use std::collections::HashSet;
use std::io;
use std::path::{Component, Path, PathBuf};

/// The name the store records these imports under (`import.stickies`).
const SOURCE: &str = "stickies";
/// A sticky's image larger than this is left out, and the note says so.
const MAX_IMAGE_BYTES: u64 = 50 * 1024 * 1024;
/// Enough of a sticky's text to fill its miniature.
const PREVIEW_CHARS: usize = 400;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StickiesScan {
    /// Where the stickies were found: the chosen folder, or the Stickies
    /// folder inside it. `import_stickies` takes this back.
    folder: String,
    /// False when macOS refused to let the app read the folder.
    readable: bool,
    stickies: Vec<StickyPreview>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StickyPreview {
    id: String,
    title: String,
    /// The start of the note's Markdown.
    text: String,
    /// `#rrggbb`, the sticky's paper.
    color: Option<String>,
    created_at: String,
    updated_at: String,
    images: usize,
    /// Imported before, and its note still exists.
    imported: bool,
}

/// Where Stickies keeps its notes, for the folder picker to open at. `None`
/// off macOS, where there is no Stickies.
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

/// Every sticky in the folder the user picked, converted, for the preview.
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

/// Import the stickies `ids` from `folder` as notes, filed in the Space named
/// `space` (none when blank). Read again from disk, not from the preview, so
/// what lands is each sticky as it is now.
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
    // Leave out what is already in before copying any image for it; the
    // store checks again inside its transaction.
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
            created_at: sticky.created_at,
            updated_at: sticky.updated_at,
        })
        .collect();
    let mut outcome = locked(&state)?.import_notes(SOURCE, items, space.as_deref())?;
    outcome.skipped += already;
    // Best effort, as after a paste: the next launch mirrors what this misses.
    let _ = mirror_attachments(&app);
    if outcome.imported > 0 {
        emit_notes_changed(&app);
        emit_tags_changed(&app);
        emit_workspaces_changed(&app);
    }
    Ok(outcome)
}

/// The folder the picker returned, where its stickies are.
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

/// Copy the image a sticky names into the attachments folder, returning its
/// stored name. The name comes from a file, so it must be a plain file name
/// inside the sticky's own package, a regular file (a link is not
/// followed), no larger than `MAX_IMAGE_BYTES`, and an image.
fn copy_image(attachments: &Path, package: &Path, name: &str) -> Option<String> {
    if !is_one_component(name) {
        return None;
    }
    let path = package.join(name);
    let meta = std::fs::symlink_metadata(&path).ok()?;
    if !meta.is_file() || meta.len() > MAX_IMAGE_BYTES {
        return None;
    }
    let bytes = std::fs::read(&path).ok()?;
    store_image(attachments, &bytes).ok()
}

/// Looser on purpose than the attachments folder's own name rule
/// (`instantnotes_core::attachments`): a Stickies image is called whatever
/// the user pasted ("Pasted Graphic 2.tiff"), and is renamed on the way in.
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
