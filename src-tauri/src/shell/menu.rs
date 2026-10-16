use crate::*;
use tauri::menu::{Menu, MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;

pub(crate) struct Item {
    pub id: &'static str,
    pub label: &'static str,
    pub accel: Option<&'static str>,
}

impl Item {
    const fn new(id: &'static str, label: &'static str, accel: Option<&'static str>) -> Self {
        Self { id, label, accel }
    }
}

pub(crate) const SHELL_ONLY: &[&str] = &["app.quit", "app.capture", "app.library"];

const SETTINGS: Item = Item::new("view.settings", "Settings…", Some("CmdOrCtrl+,"));
const QUIT: Item = Item::new("app.quit", "Quit InstantNotes", Some("CmdOrCtrl+Q"));
#[cfg(any(not(target_os = "macos"), test))]
const ABOUT: Item = Item::new("view.about", "About InstantNotes", None);

const FILE_NEW: &[Item] = &[
    Item::new("note.new", "New Note", Some("CmdOrCtrl+N")),
    Item::new(
        "note.newWhiteboard",
        "New Whiteboard",
        Some("CmdOrCtrl+Shift+N"),
    ),
    Item::new("note.newSheet", "New Sheet", None),
];
const FILE_NOTE: &[Item] = &[
    Item::new(
        "note.sticky",
        "Pop Out as Sticky",
        Some("CmdOrCtrl+Shift+O"),
    ),
    Item::new("note.export", "Export Note As…", None),
];
const VIEW: &[Item] = &[
    Item::new("view.palette", "Command Palette", None),
    Item::new("view.graph", "Show Graph", None),
    Item::new("view.agents", "Show Agents", None),
];
// The page leaves these chords to the menu on the desktop, so one press runs once.
const VIEW_PANES: &[Item] = &[
    Item::new(
        "view.sidebar",
        "Show or Hide Sidebar",
        Some("CmdOrCtrl+Backslash"),
    ),
    Item::new(
        "view.noteList",
        "Show or Hide Note List",
        Some("CmdOrCtrl+Shift+L"),
    ),
    Item::new("note.search", "Search Notes", Some("CmdOrCtrl+Shift+F")),
];
const VIEW_ZOOM: &[Item] = &[
    Item::new("view.zoomIn", "Zoom In", None),
    Item::new("view.zoomOut", "Zoom Out", None),
    Item::new("view.zoomReset", "Actual Size", None),
];
const HELP: &[Item] = &[
    Item::new("app.checkUpdates", "Check for Updates…", None),
    Item::new("app.sendFeedback", "Send Feedback…", None),
];
const HELP_LINKS: &[Item] = &[
    Item::new("app.openRepo", "Repository on GitHub", None),
    Item::new("app.openDataFolder", "Open Data Folder", None),
];
const TRAY: &[Item] = &[
    Item::new("app.capture", "New Capture", None),
    Item::new("app.library", "Open Library", None),
];
const TRAY_TAIL: &[Item] = &[
    Item::new("app.checkUpdates", "Check for Updates…", None),
    Item::new("view.settings", "Settings…", None),
    Item::new("app.quit", "Quit InstantNotes", None),
];

#[derive(Clone, Serialize)]
struct MenuCommand {
    id: String,
}

pub(crate) fn run_command(app: &AppHandle, id: &str) {
    if !SHELL_ONLY.contains(&id) {
        show_library_window(app);
        let _ = app.emit_to(
            "library",
            events::MENU_COMMAND,
            MenuCommand { id: id.to_owned() },
        );
        return;
    }
    match id {
        "app.quit" => begin_quit(app),
        "app.capture" => show_capture_window(app),
        _ => show_library_window(app),
    }
}

fn menu_item(app: &tauri::App, item: &Item) -> tauri::Result<MenuItem<tauri::Wry>> {
    MenuItem::with_id(app, item.id, item.label, true, item.accel)
}

fn submenu<'a>(
    app: &'a tauri::App,
    title: &str,
    sections: &[&[Item]],
) -> tauri::Result<SubmenuBuilder<'a, tauri::Wry, tauri::App>> {
    let mut builder = SubmenuBuilder::new(app, title);
    for (i, section) in sections.iter().enumerate() {
        if i > 0 {
            builder = builder.separator();
        }
        for item in *section {
            builder = builder.item(&menu_item(app, item)?);
        }
    }
    Ok(builder)
}

fn capture_label() -> &'static str {
    if !cfg!(target_os = "macos") {
        "New Capture"
    } else if cfg!(debug_assertions) {
        "New Capture\t⌥⇧Space"
    } else {
        "New Capture\t⌥Space"
    }
}

pub(crate) fn install(app: &tauri::App) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    let app_submenu = SubmenuBuilder::new(app, "InstantNotes")
        .about(None)
        .separator()
        .item(&menu_item(app, &SETTINGS)?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&menu_item(app, &QUIT)?)
        .build()?;
    let file = {
        let builder = submenu(app, "File", &[FILE_NEW, FILE_NOTE])?;
        #[cfg(not(target_os = "macos"))]
        let builder = builder
            .separator()
            .item(&menu_item(app, &SETTINGS)?)
            .separator()
            .item(&menu_item(app, &QUIT)?);
        builder.build()?
    };
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view = submenu(app, "View", &[VIEW, VIEW_PANES, VIEW_ZOOM])?.build()?;
    let help = {
        let builder = submenu(app, "Help", &[HELP, HELP_LINKS])?;
        #[cfg(not(target_os = "macos"))]
        let builder = builder.separator().item(&menu_item(app, &ABOUT)?);
        builder.build()?
    };
    #[cfg(target_os = "macos")]
    let menu = MenuBuilder::new(app)
        .items(&[&app_submenu, &file, &edit, &view, &help])
        .build()?;
    #[cfg(not(target_os = "macos"))]
    let menu = MenuBuilder::new(app)
        .items(&[&file, &edit, &view, &help])
        .build()?;
    #[cfg(target_os = "macos")]
    app.set_menu(menu)?;
    #[cfg(not(target_os = "macos"))]
    if let Some(library) = app.get_webview_window("library") {
        library.set_menu(menu)?;
    }
    app.on_menu_event(|app, event| run_command(app, event.id().as_ref()));

    let capture = MenuItem::with_id(app, TRAY[0].id, capture_label(), true, None::<&str>)?;
    let library = menu_item(app, &TRAY[1])?;
    let updates = menu_item(app, &TRAY_TAIL[0])?;
    let settings = menu_item(app, &TRAY_TAIL[1])?;
    let quit = menu_item(app, &TRAY_TAIL[2])?;
    let tray_menu = Menu::with_items(
        app,
        &[
            &capture,
            &library,
            &PredefinedMenuItem::separator(app)?,
            &updates,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    TrayIconBuilder::with_id("main-tray")
        .icon(tauri::include_image!("icons/tray.png"))
        .icon_as_template(true)
        .menu(&tray_menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| run_command(app, event.id.as_ref()))
        .build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn every_item() -> Vec<&'static Item> {
        [
            FILE_NEW, FILE_NOTE, VIEW, VIEW_PANES, VIEW_ZOOM, HELP, HELP_LINKS, TRAY, TRAY_TAIL,
        ]
        .iter()
        .flat_map(|section| section.iter())
        .chain([&SETTINGS, &QUIT, &ABOUT])
        .collect()
    }

    #[test]
    fn every_id_is_a_dotted_command_id() {
        for item in every_item() {
            assert!(item.id.contains('.'), "{}", item.id);
            assert!(!item.id.contains(' '), "{}", item.id);
            assert!(!item.label.is_empty(), "{}", item.id);
        }
    }

    #[test]
    fn the_shell_only_ids_are_menu_ids() {
        let ids: Vec<&str> = every_item().iter().map(|item| item.id).collect();
        for id in SHELL_ONLY {
            assert!(ids.contains(id), "{id}");
        }
    }

    #[test]
    fn no_two_items_share_an_accelerator() {
        let mut seen = std::collections::HashSet::new();
        for item in every_item() {
            if let Some(accel) = item.accel {
                assert!(seen.insert(accel), "{accel} on {}", item.id);
            }
        }
    }
}
