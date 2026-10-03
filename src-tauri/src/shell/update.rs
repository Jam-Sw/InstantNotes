//! Installs an app update the user accepted. The download and its signature
//! check are the updater plugin's. This adds one fallback, for an AppImage the
//! user cannot write: one installed into a root-owned folder (a pacman/AUR
//! repack under /opt, or a `sudo cp` into /usr/local/bin). There the plugin's
//! in-place swap fails with EACCES and offers no way to grant access (#64), so
//! the verified AppImage is staged in the temp dir and swapped in through
//! `pkexec`, which asks for the password in the system's own polkit dialog.

use crate::*;
use tauri::ipc::Channel;
use tauri::{ResourceId, Webview};
use tauri_plugin_updater::Update;

/// The plugin's own `DownloadEvent` shape, so the store reads progress exactly
/// as it did from `Update.downloadAndInstall`.
#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum UpdateEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

/// Download, verify, and install the update `rid` names (the resource the JS
/// `check()` returned). The app relaunches into it on the next restart.
#[tauri::command]
pub async fn install_update(
    webview: Webview,
    rid: ResourceId,
    on_event: Channel<UpdateEvent>,
) -> CmdResult<()> {
    let update = webview
        .resources_table()
        .get::<Update>(rid)
        .map_err(|e| CmdError::storage(e.to_string()))?;

    let mut started = false;
    let bytes = update
        .download(
            |chunk_length, content_length| {
                if !started {
                    started = true;
                    let _ = on_event.send(UpdateEvent::Started { content_length });
                }
                let _ = on_event.send(UpdateEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(UpdateEvent::Finished);
            },
        )
        .await
        .map_err(|e| CmdError::storage(e.to_string()))?;

    // Windows: install() hands off to the installer and exits the process
    // itself, so pending edits are saved first.
    if cfg!(windows) {
        let app = webview.app_handle().clone();
        tauri::async_runtime::spawn_blocking(move || flush_before_exit(&app))
            .await
            .map_err(|e| CmdError::storage(e.to_string()))?;
    }
    let installed = update.install(&bytes);
    if cfg!(windows) {
        release_quit();
    }
    match installed {
        Ok(()) => Ok(()),
        #[cfg(target_os = "linux")]
        Err(tauri_plugin_updater::Error::Io(e))
            if e.kind() == std::io::ErrorKind::PermissionDenied =>
        {
            let Some(target) = webview.env().appimage.map(std::path::PathBuf::from) else {
                return Err(CmdError::storage(e.to_string()));
            };
            tauri::async_runtime::spawn_blocking(move || elevated::install(&bytes, &target))
                .await
                .map_err(|e| CmdError::storage(e.to_string()))?
        }
        Err(e) => Err(CmdError::storage(e.to_string())),
    }
}

#[cfg(target_os = "linux")]
mod elevated {
    use crate::*;
    use std::io::Write;
    use std::path::Path;
    use std::process::{Command, ExitStatus};

    /// Run as root by pkexec with the staged and target paths as `$1` and `$2`
    /// (never spliced into the script). The copy lands beside the target and is
    /// renamed over it: the running AppImage cannot be written in place (ETXTBSY),
    /// and a rename leaves either the old file or the new one, never half of one.
    pub(super) const SWAP: &str = r#"install -m 755 -- "$1" "$2.new" && mv -f -- "$2.new" "$2" || { rm -f -- "$2.new"; exit 1; }"#;

    pub(super) fn install(bytes: &[u8], target: &Path) -> CmdResult<()> {
        let target = std::fs::canonicalize(target).map_err(|e| CmdError::storage(e.to_string()))?;
        let mut staged = tempfile::Builder::new()
            .prefix("instantnotes-update-")
            .suffix(".AppImage")
            .tempfile()
            .map_err(|e| CmdError::storage(e.to_string()))?;
        staged
            .write_all(bytes)
            .and_then(|_| staged.flush())
            .map_err(|e| CmdError::storage(e.to_string()))?;

        let status = Command::new("pkexec")
            .args(["/bin/sh", "-c", SWAP, "sh"])
            .arg(staged.path())
            .arg(&target)
            .status();
        outcome(status, &target)
    }

    /// Turn pkexec's exit into what the update note says. 126 is a dismissed
    /// or refused password dialog; 127 is no polkit agent to show one.
    pub(super) fn outcome(status: std::io::Result<ExitStatus>, target: &Path) -> CmdResult<()> {
        let manual = format!(
            "Install it by hand with: sudo install -m 755 <downloaded AppImage> {}",
            target.display()
        );
        match status {
            Ok(s) if s.success() => Ok(()),
            Ok(s) if s.code() == Some(126) => Err(CmdError::storage(
                "Permission was not given, so the update was not installed.",
            )),
            Ok(s) if s.code() == Some(127) => Err(CmdError::storage(format!(
                "No system password prompt is available. {manual}"
            ))),
            Ok(s) => Err(CmdError::storage(format!(
                "The update could not be installed ({s}). {manual}"
            ))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(CmdError::storage(format!(
                "{} is in a folder only an administrator can change, and pkexec is not installed. {manual}",
                target.display()
            ))),
            Err(e) => Err(CmdError::storage(e.to_string())),
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::elevated::{outcome, SWAP};
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::process::ExitStatusExt;
    use std::path::Path;
    use std::process::{Command, ExitStatus};

    #[test]
    fn swap_replaces_the_target_and_makes_it_executable() {
        let dir = tempfile::tempdir().unwrap();
        let staged = dir.path().join("staged");
        let target = dir.path().join("InstantNotes.AppImage");
        std::fs::write(&staged, b"new").unwrap();
        std::fs::write(&target, b"old").unwrap();

        let status = Command::new("/bin/sh")
            .args(["-c", SWAP, "sh"])
            .arg(&staged)
            .arg(&target)
            .status()
            .unwrap();

        assert!(status.success());
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
        let mode = std::fs::metadata(&target).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o755);
        assert!(!dir.path().join("InstantNotes.AppImage.new").exists());
    }

    #[test]
    fn swap_leaves_the_target_alone_when_the_copy_fails() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("InstantNotes.AppImage");
        std::fs::write(&target, b"old").unwrap();

        let status = Command::new("/bin/sh")
            .args(["-c", SWAP, "sh"])
            .arg(dir.path().join("missing"))
            .arg(&target)
            .status()
            .unwrap();

        assert!(!status.success());
        assert_eq!(std::fs::read(&target).unwrap(), b"old");
        assert!(!dir.path().join("InstantNotes.AppImage.new").exists());
    }

    fn message(r: crate::CmdResult<()>) -> String {
        serde_json::to_value(r.unwrap_err()).unwrap()["message"]
            .as_str()
            .unwrap()
            .to_owned()
    }

    #[test]
    fn a_dismissed_password_prompt_says_so() {
        let target = Path::new("/opt/instantnotes/InstantNotes.AppImage");
        assert!(outcome(Ok(ExitStatus::from_raw(0)), target).is_ok());
        let dismissed = message(outcome(Ok(ExitStatus::from_raw(126 << 8)), target));
        assert!(dismissed.contains("Permission was not given"));
        let no_agent = message(outcome(Ok(ExitStatus::from_raw(127 << 8)), target));
        assert!(no_agent.contains("sudo install -m 755"));
        let missing = std::io::Error::from(std::io::ErrorKind::NotFound);
        let no_pkexec = message(outcome(Err(missing), target));
        assert!(no_pkexec.contains("pkexec is not installed"));
    }
}
