// Command registry for the ⌘K palette. Commands are built fresh each time the
// palette opens so the theme list and selection-dependent labels are current.
// The run() callbacks delegate to existing stores so the palette holds no logic
// of its own. Pure filtering/ranking lives in command-filter.ts.

import { library } from "$lib/stores/library.svelte";
import { theme } from "$lib/stores/theme.svelte";
import { exportTheme, importTheme } from "$lib/themes/share";
import type { Command } from "$lib/command-filter";

export type { Command } from "$lib/command-filter";
export {
  fuzzyScore,
  filterCommands,
  recentCommands,
  recordRecent,
} from "$lib/command-filter";

/** Theme-specific commands for the palette sub-view. */
export function buildThemeCommands(): Command[] {
  return theme.allThemes.map((t) => ({
    id: `theme.set.${t.id}`,
    title: t.name,
    group: "Theme",
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
    commands.push(
      {
        id: "note.pin",
        title: n.isPinned ? "Unpin note" : "Pin note",
        group: "Notes",
        run: () => library.togglePinned(),
      },
      {
        id: "note.archive",
        title: n.isArchived ? "Unarchive note" : "Archive note",
        group: "Notes",
        run: () => library.toggleArchived(),
      },
      {
        id: "note.delete",
        title: n.isDeleted ? "Restore note" : "Delete note",
        group: "Notes",
        run: () => (n.isDeleted ? library.restoreSelected() : library.deleteSelected()),
      },
    );
  }

  commands.push(
    {
      id: "theme.switch",
      title: "Switch theme",
      group: "Theme",
      run: () => {},
    },
    {
      id: "theme.toggle",
      title: "Toggle light / dark",
      group: "Theme",
      run: () => theme.toggleLightDark(),
    },
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
