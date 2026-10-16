#[cfg(not(target_os = "macos"))]
use crate::shell::paint;
use crate::*;

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
pub fn set_window_theme(app: AppHandle, variant: String, background: Option<String>) {
    use tauri::Theme;
    let theme = match variant.as_str() {
        "light" => Theme::Light,
        "dark" => Theme::Dark,
        _ => return,
    };
    if let Some(win) = app.get_webview_window("library") {
        let _ = win.set_theme(Some(theme));
        #[cfg(not(target_os = "macos"))]
        if let Some(paint) = background
            .as_deref()
            .and_then(|hex| paint::WindowPaint::from_parts(&variant, hex))
        {
            let _ = win.set_background_color(Some(paint.color()));
            if let Ok(dir) = app.path().app_data_dir() {
                paint::remember(&dir, &paint);
            }
        }
        #[cfg(target_os = "macos")]
        let _ = background;
    }
}

pub(crate) fn show_painted_library(app: &AppHandle, dir: &std::path::Path) {
    let Some(win) = app.get_webview_window("library") else {
        return;
    };
    #[cfg(not(target_os = "macos"))]
    if let Some(paint) = paint::read(dir) {
        let _ = win.set_theme(Some(paint.theme()));
        let _ = win.set_background_color(Some(paint.color()));
    }
    #[cfg(target_os = "macos")]
    let _ = dir;
    let _ = win.show();
    let _ = win.set_focus();
}

#[tauri::command]
pub fn open_url(app: AppHandle, url: String) {
    let _ = app.opener().open_url(&url, None::<&str>);
}

pub(crate) fn show_library_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("library") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
pub fn open_data_folder(app: AppHandle) {
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
    use super::icon_refresh_needed;

    #[test]
    fn icon_refresh_when_version_changed_or_unknown() {
        assert!(icon_refresh_needed(None, "0.5.3"));
        assert!(icon_refresh_needed(Some("0.5.2"), "0.5.3"));
        assert!(!icon_refresh_needed(Some("0.5.3"), "0.5.3"));
    }
}
