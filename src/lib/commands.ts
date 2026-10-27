import { library } from "$lib/stores/library.svelte";
import { sidebar } from "$lib/stores/sidebar.svelte";
import { theme } from "$lib/stores/theme.svelte";
import { agents } from "$lib/stores/agents.svelte";
import { contexting } from "$lib/stores/contexting.svelte";
import { confirmConvertToWhiteboard } from "$lib/whiteboard/convert";
import { exportTheme, importTheme } from "$lib/themes/share";
import { BODY_FONTS } from "$lib/themes/fonts";
import { shell } from "$lib/stores/shell.svelte";
import { editorPrefs } from "$lib/stores/editor.svelte";
import { updater } from "$lib/stores/updater.svelte";
import { licenseSpace } from "$lib/stores/license-space.svelte";
import { exportSelectedNote } from "$lib/note-export";
import { backupNow, openDataFolder, openUrl, requestQuit } from "$lib/api/client";
import { exportArchiveDownload, exportVaultToFolder } from "$lib/vault-export";
import { toasts } from "$lib/stores/toasts.svelte";
import { openElsewhere } from "$lib/stores/open-elsewhere.svelte";
import { modKey, shiftKey } from "$lib/platform";
import { isWeb } from "$lib/api/runtime";
import { isSyntheticNoteId } from "$lib/synthetic";
import { findCommand, type Command } from "$lib/command-filter";
import { focusSearch } from "$lib/search-focus";

const REPO_URL = "https://github.com/Jam-Sw/InstantNotes";

async function runExport(): Promise<void> {
  const result = isWeb ? await exportArchiveDownload() : await exportVaultToFolder();
  if ("error" in result) toasts.show(`Couldn't export. ${result.error}`);
  else if ("ok" in result) toasts.show("Exported. Every note is a plain Markdown file in the copy.");
}

export type { Command } from "$lib/command-filter";
export {
  filterCommands,
  recentCommands,
  recordRecent,
  childrenOf,
  findCommand,
  resolveActivation,
} from "$lib/command-filter";

function buildBodyFontCommands(): Command[] {
  const reset: Command = {
    id: "font.body.default",
    title: "Use theme default",
    group: "Font",
    parent: "font.body",
    isActive: () => theme.bodyFontId === null,
    keepOpenAfterRun: true,
    run: () => theme.setBodyFont(null),
  };
  const picks = BODY_FONTS.map((f) => ({
    id: `font.body.${f.id}`,
    title: f.label,
    group: "Font",
    parent: "font.body",
    isActive: () => theme.bodyFontId === f.id,
    keepOpenAfterRun: true,
    run: () => theme.setBodyFont(f.id),
  }));
  return [reset, ...picks];
}

function buildThemeCommands(): Command[] {
  return theme.allThemes.map((t) => ({
    id: `theme.set.${t.id}`,
    title: t.name,
    group: "Theme",
    parent: "themes",
    isActive: () => theme.activeId === t.id,
    keepOpenAfterRun: true,
    run: () => theme.setTheme(t.id),
  }));
}

export function buildCommands(): Command[] {
  const commands: Command[] = [
    {
      id: "note.new",
      title: "New note",
      group: "Notes",
      shortcut: `${modKey}N`,
      run: () => {
        shell.closeSettings();
        return library.newNote();
      },
    },
    {
      id: "note.newWhiteboard",
      title: "New whiteboard",
      group: "Notes",
      shortcut: `${modKey}${shiftKey}N`,
      run: () => {
        shell.closeSettings();
        return library.newWhiteboard();
      },
    },
    {
      id: "note.newSheet",
      title: "New sheet",
      group: "Notes",
      run: () => {
        shell.closeSettings();
        return library.newSheet();
      },
    },
    {
      id: "view.graph",
      title: "Show graph",
      group: "View",
      run: () => {
        shell.closeSettings();
        library.selectGraph();
      },
    },
    {
      id: "view.sidebar",
      title: sidebar.hidden ? "Show Sidebar" : "Hide Sidebar",
      group: "View",
      shortcut: `${modKey}\\`,
      run: () => sidebar.toggle(),
    },
    {
      id: "view.noteList",
      title: sidebar.listHidden ? "Show Note List" : "Hide Note List",
      group: "View",
      shortcut: `${modKey}${shiftKey}L`,
      run: () => sidebar.toggleList(),
    },
    {
      id: "note.search",
      title: "Search notes",
      group: "Notes",
      shortcut: isWeb ? undefined : `${modKey}${shiftKey}F`,
      run: () => void focusSearch(),
    },
    {
      id: "view.agents",
      title: "Show Agents",
      group: "View",
      shortcut: `${modKey}${shiftKey}A`,
      run: () => agents.show(),
    },
    {
      id: "view.settings",
      title: "Open settings",
      group: "View",
      shortcut: `${modKey},`,
      run: () => shell.openSettings(),
    },
    {
      id: "view.about",
      title: "About InstantNotes",
      group: "View",
      run: () => shell.openSettings("about"),
    },
    {
      id: "view.palette",
      title: "Command palette",
      group: "View",
      shortcut: `${modKey}K`,
      hidden: true,
      run: () => shell.togglePalette(),
    },
    {
      id: "view.toolbar",
      title: editorPrefs.toolbarOpen ? "Hide formatting toolbar" : "Show formatting toolbar",
      group: "View",
      run: () => editorPrefs.toggleToolbar(),
    },
    {
      id: "view.markdownSource",
      title: editorPrefs.sourceMode ? "Hide Markdown source" : "Show Markdown source",
      group: "View",
      run: () => editorPrefs.toggleSourceMode(),
    },
    {
      id: "view.zoomIn",
      title: "Zoom in",
      group: "View",
      shortcut: `${modKey}=`,
      keepOpenAfterRun: true,
      run: () => editorPrefs.zoomIn(),
    },
    {
      id: "view.zoomOut",
      title: "Zoom out",
      group: "View",
      shortcut: `${modKey}-`,
      keepOpenAfterRun: true,
      run: () => editorPrefs.zoomOut(),
    },
    {
      id: "view.zoomReset",
      title: "Actual size",
      group: "View",
      shortcut: `${modKey}0`,
      run: () => editorPrefs.resetZoom(),
    },
  ];

  if (library.selected) {
    const n = library.selected;
    const notePrefix = n.title || "Untitled";
    commands.push(
      {
        id: "note.pin",
        title: n.isPinned ? "Unpin note" : "Pin note",
        group: "Notes",
        prefix: notePrefix,
        run: () => library.togglePinned(),
      },
      {
        id: "note.archive",
        title: n.isArchived ? "Unarchive note" : "Archive note",
        group: "Notes",
        prefix: notePrefix,
        run: () => library.toggleArchived(),
      },
      {
        id: "note.delete",
        title: n.isDeleted ? "Restore note" : "Delete note",
        group: "Notes",
        prefix: notePrefix,
        run: () => (n.isDeleted ? library.restoreSelected() : library.deleteSelected()),
      },
      {
        id: "note.copyContext",
        title: "Copy note as context",
        group: "Notes",
        prefix: notePrefix,
        run: async () => {
          library.flushPendingEdits();
          const note = library.selected;
          if (!note) return;
          await navigator.clipboard.writeText(contexting.render(note, library.selectedTags));
        },
      },
    );
    if (!n.isDeleted && !isSyntheticNoteId(n.id)) {
      commands.push({
        id: "note.openElsewhere",
        title: "Open on another device…",
        group: "Notes",
        prefix: notePrefix,
        run: () => void openElsewhere.show(n.id),
      });
    }
    if (!isWeb && !n.isDeleted && !isSyntheticNoteId(n.id)) {
      const out = library.isSticky(n.id);
      commands.push({
        id: "note.sticky",
        title: out ? "Bring back from sticky" : "Open as sticky",
        group: "Notes",
        prefix: notePrefix,
        shortcut: `${modKey}${shiftKey}O`,
        run: () => library.toggleSticky(),
      });
    }
    if (!n.isDeleted && n.contentKind !== "whiteboard" && !library.isSticky(n.id)) {
      commands.push({
        id: "note.toWhiteboard",
        title: "Turn into whiteboard…",
        group: "Notes",
        prefix: notePrefix,
        run: () => void confirmConvertToWhiteboard(),
      });
    }
    if (!isWeb && !isSyntheticNoteId(n.id)) {
      commands.push({
        id: "note.export",
        title: "Export note as…",
        group: "Notes",
        prefix: notePrefix,
        run: () => exportSelectedNote(),
      });
    }
  }

  commands.push(
    {
      id: "font.body",
      title: "Body Font",
      group: "Font",
      run: () => {},
    },
    ...buildBodyFontCommands(),
    {
      id: "themes",
      title: "Themes",
      group: "Theme",
      run: () => {},
    },
    {
      id: "theme.toggle",
      title: "Toggle light / dark",
      group: "Theme",
      parent: "themes",
      emphasis: true,
      icon: () => (theme.resolvedVariant === "dark" ? "☾" : "☀"),
      keepOpenAfterRun: true,
      run: () => theme.toggleLightDark(),
    },
    ...buildThemeCommands(),
    {
      id: "theme.auto",
      title: "Appearance: match system",
      group: "Theme",
      run: () => theme.setMode("auto"),
    },
  );
  if (!isWeb) {
    commands.push(
      { id: "theme.import", title: "Import theme…", group: "Theme", run: () => void importTheme() },
      { id: "theme.export", title: "Export current theme…", group: "Theme", run: () => void exportTheme() },
    );
  }

  commands.push(
    {
      id: "app.openRepo",
      title: "Repository on GitHub",
      group: "Help",
      run: () => openUrl(REPO_URL),
    },
    {
      id: "app.openChangelog",
      title: "Full changelog",
      group: "Help",
      run: () => openUrl(`${REPO_URL}/blob/main/CHANGELOG.md`),
    },
    {
      id: "app.sendDiagnostics",
      title: "Send diagnostics…",
      group: "Help",
      run: () => shell.openSettings("diagnostics"),
    },
    {
      id: "data.backups",
      title: isWeb ? "Export" : "Backups",
      group: "Data",
      run: () => shell.openSettings("backups"),
    },
    {
      id: "data.export",
      title: isWeb ? "Download everything as Markdown" : "Export everything as Markdown…",
      group: "Data",
      run: () => runExport(),
    },
  );
  if (!isWeb) {
    commands.push({
      id: "data.backupNow",
      title: "Back up now",
      group: "Data",
      run: () =>
        backupNow().then(
          () => {
            toasts.show("Backed up. The copy is in the backups folder.");
          },
          (e: unknown) => {
            toasts.show(`Couldn't back up. ${e instanceof Error ? e.message : e}`);
          },
        ),
    });
    commands.push(
      {
        id: "app.checkUpdates",
        title: "Check for updates…",
        group: "Help",
        run: async () => {
          shell.openSettings("about");
          await updater.checkNow({ manual: true });
          if (updater.pendingUpdate) updater.show();
        },
      },
      {
        id: "app.sendFeedback",
        title: "Send feedback…",
        group: "Help",
        run: () => shell.openSettings("feedback"),
      },
      {
        id: "app.openDataFolder",
        title: "Open data folder",
        group: "Help",
        run: () => openDataFolder(),
      },
      {
        id: "app.quit",
        title: "Quit InstantNotes",
        group: "Help",
        shortcut: `${modKey}Q`,
        run: () => requestQuit(),
      },
    );
    if (updater.pendingUpdate) {
      commands.push({
        id: "app.showUpdate",
        title: `Show update v${updater.version}`,
        group: "Help",
        emphasis: true,
        run: () => updater.show(),
      });
    }
  }

  return commands;
}

export async function runCommand(id: string): Promise<void> {
  if (licenseSpace.locked) return;
  const cmd = findCommand(buildCommands(), id);
  if (!cmd) return;
  await cmd.run();
}
