// Command registry for the ⌘K palette. Commands are built fresh each time the
// palette opens so the theme list and selection-dependent labels are current.
// The run() callbacks delegate to existing stores so the palette holds no logic
// of its own. Pure filtering/ranking lives in command-filter.ts.

import { library } from "$lib/stores/library.svelte";
import { theme } from "$lib/stores/theme.svelte";
import { exportTheme, importTheme } from "$lib/themes/share";
import { BODY_FONTS } from "$lib/themes/fonts";
import type { Command } from "$lib/command-filter";

export type { Command } from "$lib/command-filter";
export {
  fuzzyScore,
  filterCommands,
  recentCommands,
  recordRecent,
  childrenOf,
  hasChildren,
  findCommand,
  resolveActivation,
} from "$lib/command-filter";

/** One leaf per curated body font, parented to the "font.body" folder command. */
export function buildBodyFontCommands(): Command[] {
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

/** One leaf per installed theme, parented to the "themes" folder command. */
export function buildThemeCommands(): Command[] {
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

/** Build the current command set. Reads store state, so call on palette open. */
export function buildCommands(): Command[] {
  const commands: Command[] = [
    { id: "note.new", title: "New note", group: "Notes", shortcut: "⌘N", run: () => library.newNote() },
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
    );
  }

  commands.push(
    {
      id: "font.body",
      title: "Body Font",
      group: "Font",
      run: () => {},
    },
    ...buildBodyFontCommands(),
    // Folder: has children (the theme leaves below), so the palette descends
    // into it on run rather than calling this no-op.
    {
      id: "themes",
      title: "Themes",
      group: "Theme",
      run: () => {},
    },
    // Listed before the theme leaves so it sits at the top of the sub-view, and
    // flagged emphasis + an icon so it reads as a mode switch, not a theme.
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
    { id: "theme.import", title: "Import theme…", group: "Theme", run: () => void importTheme() },
    { id: "theme.export", title: "Export current theme…", group: "Theme", run: () => void exportTheme() },
  );

  return commands;
}
