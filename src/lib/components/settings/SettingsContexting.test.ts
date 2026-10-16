import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";

vi.mock("$lib/api/client", () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getAttachmentsDir: vi.fn().mockResolvedValue(null),
  getNote: vi.fn(),
  tagsForNote: vi.fn(),
}));

vi.mock("$lib/stores/library.svelte", () => ({
  library: {
    selected: {
      id: "note-abc-123",
      title: "Meeting notes",
      body: "Hello world",
      updatedAt: "2026-10-01T12:00:00.000Z",
    },
    selectedTags: [{ name: "work" }],
  },
}));

import { contexting } from "$lib/stores/contexting.svelte";
import { library } from "$lib/stores/library.svelte";
import { shell } from "$lib/stores/shell.svelte";
import SettingsContexting from "./SettingsContexting.svelte";

afterEach(() => {
  cleanup();
  contexting.addSourceLine = true;
  shell.settingsOpen = false;
  vi.clearAllMocks();
});

describe("SettingsContexting", () => {
  it("shows the source line and the selected note's id in the preview when it is on", () => {
    const { container, getByText } = render(SettingsContexting);
    const pre = container.querySelector("pre.ctx-preview")!;
    expect(pre.textContent).toContain("From InstantNotes");
    expect(pre.textContent).toContain("id note-abc-123");
    expect(getByText("Preview: Meeting notes")).toBeTruthy();
  });

  it("drops the source line from the preview when the toggle is flipped off", async () => {
    const { container, getByRole } = render(SettingsContexting);
    await fireEvent.click(getByRole("switch", { name: "Add source line" }));
    expect(contexting.addSourceLine).toBe(false);
    const pre = container.querySelector("pre.ctx-preview")!;
    expect(pre.textContent).not.toContain("From InstantNotes");
    expect(pre.textContent).not.toContain("note-abc-123");
  });

  it("falls back to a labelled sample note when nothing is selected", () => {
    const lib = library as unknown as { selected: unknown };
    const saved = lib.selected;
    lib.selected = null;
    try {
      const { container, getByText } = render(SettingsContexting);
      expect(getByText("Preview: sample note")).toBeTruthy();
      expect(container.querySelector("pre.ctx-preview")!.textContent).toContain(
        "id sample-note-id",
      );
    } finally {
      lib.selected = saved;
    }
  });

  it("opens the Agents settings page from the link", async () => {
    const { getByText } = render(SettingsContexting);
    await fireEvent.click(getByText("Agents settings"));
    expect(shell.settingsOpen).toBe(true);
    expect(shell.settingsPage).toBe("agents");
  });
});
