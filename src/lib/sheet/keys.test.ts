import { beforeEach, describe, expect, it, vi } from "vitest";
import { claimsKey, editIntent, selectIntent, type KeyLike } from "./keys";

const stores = vi.hoisted(() => ({
  library: {
    selected: null as unknown,
    selectedTags: [],
    isSticky: vi.fn(() => false),
    newNote: vi.fn(),
    newWhiteboard: vi.fn(),
    newSheet: vi.fn(),
    selectGraph: vi.fn(),
    togglePinned: vi.fn(),
    toggleArchived: vi.fn(),
    restoreSelected: vi.fn(),
    deleteSelected: vi.fn(),
    flushPendingEdits: vi.fn(),
    toggleSticky: vi.fn(),
  },
  sidebar: { collapsed: false, toggle: vi.fn() },
  theme: {
    allThemes: [],
    activeId: "manuscript",
    bodyFontId: null,
    resolvedVariant: "dark",
    setBodyFont: vi.fn(),
    setTheme: vi.fn(),
    setMode: vi.fn(),
    toggleLightDark: vi.fn(),
  },
  agents: { show: vi.fn() },
  contexting: { render: vi.fn() },
}));
vi.mock("$lib/stores/library.svelte", () => ({ library: stores.library }));
vi.mock("$lib/stores/sidebar.svelte", () => ({ sidebar: stores.sidebar }));
vi.mock("$lib/stores/theme.svelte", () => ({ theme: stores.theme }));
vi.mock("$lib/stores/agents.svelte", () => ({ agents: stores.agents }));
vi.mock("$lib/stores/contexting.svelte", () => ({ contexting: stores.contexting }));
vi.mock("$lib/whiteboard/convert", () => ({ confirmConvertToWhiteboard: vi.fn() }));
vi.mock("$lib/themes/share", () => ({ exportTheme: vi.fn(), importTheme: vi.fn() }));

import { buildCommands } from "$lib/commands";

function key(k: string, mods: Partial<KeyLike> = {}): KeyLike {
  return { key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods };
}
const cmd = (k: string, mods: Partial<KeyLike> = {}) => key(k, { metaKey: true, ...mods });

function eventsFor(label: string): KeyLike[] {
  let rest = label;
  const strip = (prefixes: string[]) => {
    for (const p of prefixes) {
      if (rest.startsWith(p)) {
        rest = rest.slice(p.length);
        return true;
      }
    }
    return false;
  };
  const mod = strip(["⌘", "Ctrl+"]);
  const shift = strip(["⇧", "Shift+"]);
  expect(mod, `${label} is a modifier chord`).toBe(true);
  const letters = rest.length === 1 ? [rest.toLowerCase(), rest.toUpperCase()] : [rest];
  return letters.flatMap((k) => [
    key(k, { metaKey: true, shiftKey: shift }),
    key(k, { ctrlKey: true, shiftKey: shift }),
  ]);
}

beforeEach(() => {
  stores.library.selected = {
    id: "n1",
    title: "T",
    body: "",
    createdAt: "",
    updatedAt: "",
    isPinned: false,
    isArchived: false,
    isDeleted: false,
    contentKind: "sheet",
  };
});

describe("select mode", () => {
  it("moves with arrows, extends with shift, jumps with the modifier", () => {
    expect(selectIntent(key("ArrowDown"))).toEqual({ type: "move", dr: 1, dc: 0, extend: false });
    expect(selectIntent(key("ArrowLeft", { shiftKey: true }))).toEqual({ type: "move", dr: 0, dc: -1, extend: true });
    expect(selectIntent(cmd("ArrowRight"))).toEqual({ type: "jump", dr: 0, dc: 1, extend: false });
    expect(selectIntent(key("ArrowUp", { ctrlKey: true, shiftKey: true }))).toEqual({ type: "jump", dr: -1, dc: 0, extend: true });
  });

  it("tabs, edits, clears, leaves", () => {
    expect(selectIntent(key("Tab"))).toEqual({ type: "tab", back: false });
    expect(selectIntent(key("Tab", { shiftKey: true }))).toEqual({ type: "tab", back: true });
    expect(selectIntent(key("Enter"))).toEqual({ type: "edit" });
    expect(selectIntent(key("F2"))).toEqual({ type: "edit" });
    expect(selectIntent(key("Delete"))).toEqual({ type: "clear" });
    expect(selectIntent(key("Backspace"))).toEqual({ type: "clear" });
    expect(selectIntent(key("Escape"))).toEqual({ type: "leave" });
    expect(selectIntent(key("Home"))).toEqual({ type: "edge", where: "rowStart", extend: false });
    expect(selectIntent(cmd("End", { shiftKey: true }))).toEqual({ type: "edge", where: "last", extend: true });
    expect(selectIntent(key("PageDown"))).toEqual({ type: "page", dir: 1, extend: false });
  });

  it("starts editing on a printable key, replacing the cell, Option included", () => {
    expect(selectIntent(key("x"))).toEqual({ type: "edit", replaceWith: "x" });
    expect(selectIntent(key("7", { shiftKey: true }))).toEqual({ type: "edit", replaceWith: "7" });
    expect(selectIntent(key("´", { altKey: true }))).toEqual({ type: "edit", replaceWith: "´" });
    expect(selectIntent(key(" "))).toEqual({ type: "edit", replaceWith: " " });
    expect(selectIntent(key("x", { isComposing: true }))).toBeNull();
    expect(selectIntent(key("Dead"))).toBeNull();
  });

  it("claims only its own chords: select all, undo, redo", () => {
    expect(selectIntent(cmd("a"))).toEqual({ type: "selectAll" });
    expect(selectIntent(cmd("z"))).toEqual({ type: "undo" });
    expect(selectIntent(cmd("z", { shiftKey: true }))).toEqual({ type: "redo" });
    expect(selectIntent(cmd("Z", { shiftKey: true }))).toEqual({ type: "redo" });
    expect(selectIntent(key("y", { ctrlKey: true }))).toEqual({ type: "redo" });
    for (const k of ["k", "n", "\\", "=", "-", "0", "c", "v", "x", "f", "p", "s", "w", "q", ","]) {
      expect(selectIntent(cmd(k)), k).toBeNull();
    }
    expect(selectIntent(cmd("A", { shiftKey: true }))).toBeNull();
    expect(selectIntent(cmd("N", { shiftKey: true }))).toBeNull();
  });
});

describe("edit mode", () => {
  it("commits on Enter and Tab, cancels on Escape, breaks lines on Option+Enter", () => {
    expect(editIntent(key("Enter"))).toEqual({ type: "commit", move: "down" });
    expect(editIntent(key("Enter", { shiftKey: true }))).toEqual({ type: "commit", move: "up" });
    expect(editIntent(key("Enter", { altKey: true }))).toEqual({ type: "newline" });
    expect(editIntent(key("Tab"))).toEqual({ type: "commit", move: "right" });
    expect(editIntent(key("Tab", { shiftKey: true }))).toEqual({ type: "commit", move: "left" });
    expect(editIntent(key("Escape"))).toEqual({ type: "cancel" });
  });

  it("leaves everything else to the text input, arrows and chords included", () => {
    for (const e of [key("ArrowLeft"), key("a"), cmd("a"), cmd("z"), cmd("c"), cmd("v"), key("Backspace"), key("Home")]) {
      expect(editIntent(e), e.key).toBeNull();
    }
  });
});

describe("the grid never swallows an app shortcut", () => {
  const WINDOW_GLOBALS = ["⌘K", "⌘⇧A", "⌘\\", "⌘=", "⌘-", "⌘0"];

  it("against the command registry and the window's own keys", () => {
    const labels = buildCommands()
      .map((c) => c.shortcut)
      .filter((s): s is string => typeof s === "string");
    expect(labels.length).toBeGreaterThan(3);
    for (const label of [...labels, ...WINDOW_GLOBALS]) {
      for (const e of eventsFor(label)) {
        expect(claimsKey(e), `${label} as ${JSON.stringify(e)}`).toBe(false);
      }
    }
  });
});
