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

#[tauri::command]
pub fn set_window_vibrancy(app: AppHandle, material: Option<String>) {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial};
        let Some(win) = app.get_webview_window("library") else {
            return;
        };
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

pub(crate) fn show_capture_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("capture") {
        if let Some(metrics) = app.try_state::<CaptureMetrics>() {
            metrics.mark_shown();
        }
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit(events::CAPTURE_SHOWN, ());
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

pub(crate) fn asks_for_capture<S: AsRef<str>>(args: &[S]) -> bool {
    args.get(1).is_some_and(|arg| arg.as_ref() == "capture")
}

pub(crate) fn show_library_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("library") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub(crate) const REPO_URL: &str = "https://github.com/Jam-Sw/InstantNotes";

pub(crate) fn open_data_folder(app: &AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = app.opener().open_path(dir.to_string_lossy(), None::<&str>);
    }
}

fn icon_refresh_needed(previous: Option<&str>, current: &str) -> bool {
    previous != Some(current)
}

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

#[cfg(target_os = "macos")]
fn current_app_bundle() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let bundle = exe.parent()?.parent()?.parent()?;
    if bundle.extension()?.to_str()? == "app" {
        Some(bundle.to_path_buf())
    } else {
        None
    }
}

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
    use super::{asks_for_capture, icon_refresh_needed};

    #[test]
    fn only_a_capture_argument_opens_the_capture_panel() {
        assert!(asks_for_capture(&["instantnotes", "capture"]));
        assert!(!asks_for_capture(&["instantnotes"]));
        assert!(!asks_for_capture(&["instantnotes", "mcp", "capture"]));
        assert!(!asks_for_capture(&["capture"]));
    }

    #[test]
    fn icon_refresh_when_version_changed_or_unknown() {
        assert!(icon_refresh_needed(None, "0.5.3"));
        assert!(icon_refresh_needed(Some("0.5.2"), "0.5.3"));
        assert!(!icon_refresh_needed(Some("0.5.3"), "0.5.3"));
    }
}
