//! Library and capture window show/hide, native macOS vibrancy and theme, the
//! external-link opener, and the icon-cache refresh the in-place updater needs.

use crate::shell::capture::CaptureMetrics;
use crate::*;

#[tauri::command]
pub fn hide_capture(app: AppHandle) {
    hide_capture_window(&app);
}

#[tauri::command]
pub fn open_library(app: AppHandle) {
    show_library_window(&app);
}

/// Apply a native macOS vibrancy material to the library window, or clear it when
/// `material` is None/unknown. Vibrancy is the closest a webview app gets to the
/// Tahoe "Liquid Glass" look; it requires the always-transparent window and a
/// translucent surface above it (the theme's sidebar token). A no-op off macOS.
#[tauri::command]
pub fn set_window_vibrancy(app: AppHandle, material: Option<String>) {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial};
        let Some(win) = app.get_webview_window("library") else {
            return;
        };
        // Any known material applies; None or an unknown string clears.
        let chosen = material.as_deref().and_then(|m| match m {
            "sidebar" => Some(NSVisualEffectMaterial::Sidebar),
            "under-window" => Some(NSVisualEffectMaterial::UnderWindowBackground),
            "header" => Some(NSVisualEffectMaterial::HeaderView),
            "menu" => Some(NSVisualEffectMaterial::Menu),
            "popover" => Some(NSVisualEffectMaterial::Popover),
            "hud" => Some(NSVisualEffectMaterial::HudWindow),
            _ => None,
        });
        match chosen {
            Some(m) => {
                let _ = apply_vibrancy(&win, m, None, None);
            }
            None => {
                let _ = clear_vibrancy(&win);
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, material);
    }
}

/// Match the native library window's theme (titlebar and traffic-light treatment)
/// to the in-app light/dark variant. Tauri maps this to the window's OS appearance,
/// so the chrome follows the active theme instead of the launch-time system setting.
/// An unknown variant is a no-op; the borderless capture window has no native chrome
/// and is left alone.
#[tauri::command]
pub fn set_window_theme(app: AppHandle, variant: String) {
    use tauri::Theme;
    let theme = match variant.as_str() {
        "light" => Theme::Light,
        "dark" => Theme::Dark,
        _ => return,
    };
    if let Some(win) = app.get_webview_window("library") {
        let _ = win.set_theme(Some(theme));
    }
}

#[tauri::command]
pub fn open_url(app: AppHandle, url: String) {
    let _ = app.opener().open_url(&url, None::<&str>);
}

// ---- window helpers ----

pub(crate) fn show_capture_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("capture") {
        // Stamp before any window work so the sample covers the whole reveal.
        if let Some(metrics) = app.try_state::<CaptureMetrics>() {
            metrics.mark_shown();
        }
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
        // Frontend focuses the textarea and restores any preserved draft.
        let _ = w.emit("capture:shown", ());
    }
}

pub(crate) fn hide_capture_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("capture") {
        let _ = w.hide();
    }
}

pub(crate) fn toggle_capture_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("capture") {
        if w.is_visible().unwrap_or(false) {
            hide_capture_window(app);
        } else {
            show_capture_window(app);
        }
    }
}

pub(crate) fn show_library_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("library") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

// ---- data folder + icon cache refresh ----

pub(crate) const REPO_URL: &str = "https://github.com/Jam-Sw/InstantNotes";

pub(crate) fn open_data_folder(app: &AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        // Via the opener plugin rather than a raw `open` subprocess, so it stays
        // on Tauri's permission-checked path. Called only from Rust with our own
        // data directory - never a webview-supplied path.
        let _ = app.opener().open_path(dir.to_string_lossy(), None::<&str>);
    }
}

// macOS caches an app's icon per bundle path (LaunchServices + iconservicesd).
// The in-app updater swaps the bundle in place at the same path and identifier,
// so without a nudge the Dock/Finder keep showing the icon cached for the old
// build. We record the version that last launched and, when it changes, ask
// macOS to re-read the bundle once.

/// True when the icon cache should be refreshed: the recorded last-launched
/// version is missing (pre-marker install or first launch) or differs from the
/// running version. Pure so it can be unit-tested without a real bundle.
fn icon_refresh_needed(previous: Option<&str>, current: &str) -> bool {
    previous != Some(current)
}

/// Record the running version next to the database and, when it changed since
/// the last launch, refresh the macOS icon cache. A no-op on the happy path
/// (same version) and in dev builds (no `.app` bundle).
pub(crate) fn refresh_icon_cache_if_updated(data_dir: &std::path::Path) {
    let current = env!("CARGO_PKG_VERSION");
    let marker = data_dir.join(".last_version");
    let stored = std::fs::read_to_string(&marker).ok();
    let previous = stored.as_deref().map(str::trim);
    if !icon_refresh_needed(previous, current) {
        return;
    }
    let _ = std::fs::write(&marker, current);
    #[cfg(target_os = "macos")]
    if let Some(bundle) = current_app_bundle() {
        refresh_macos_icon(bundle);
    }
}

/// Path to the running `.app` bundle, or `None` in a dev build where the
/// executable is not inside a `*.app/Contents/MacOS/` layout.
#[cfg(target_os = "macos")]
fn current_app_bundle() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let bundle = exe.parent()?.parent()?.parent()?; // MacOS -> Contents -> .app
    if bundle.extension()?.to_str()? == "app" {
        Some(bundle.to_path_buf())
    } else {
        None
    }
}

/// Nudge macOS to re-read the bundle's icon: re-register with LaunchServices,
/// bump the bundle mtime (part of the icon cache key), then relaunch the Dock.
/// Runs off the main thread; every step is best-effort.
#[cfg(target_os = "macos")]
fn refresh_macos_icon(bundle: std::path::PathBuf) {
    std::thread::spawn(move || {
        const LSREGISTER: &str = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
        let _ = std::process::Command::new(LSREGISTER)
            .arg("-f")
            .arg(&bundle)
            .status();
        let _ = std::process::Command::new("touch").arg(&bundle).status();
        let _ = std::process::Command::new("killall").arg("Dock").status();
    });
}

#[cfg(test)]
mod tests {
    use super::icon_refresh_needed;

    #[test]
    fn icon_refresh_when_version_changed_or_unknown() {
        // First launch / upgrade from a build that never wrote the marker.
        assert!(icon_refresh_needed(None, "0.5.3"));
        // In-place update from an older recorded version.
        assert!(icon_refresh_needed(Some("0.5.2"), "0.5.3"));
        // Same version relaunch: nothing to refresh.
        assert!(!icon_refresh_needed(Some("0.5.3"), "0.5.3"));
    }
}
