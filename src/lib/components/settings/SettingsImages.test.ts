// @vitest-environment jsdom
// `imagePrefs.init()`'s read-from-settings path is covered directly in
// stores/images.svelte.test.ts; this file only covers what the page renders
// and persists, following SettingsView.test.ts's convention of stubbing
// getSetting to resolve undefined (defaults) throughout.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import SettingsImages from "./SettingsImages.svelte";
import { imagePrefs, DEFAULT_MAX_HEIGHT } from "$lib/stores/images.svelte";
import { setSetting, openAttachmentsFolder } from "$lib/api/client";

vi.mock("$lib/api/client", () => ({
  getSetting: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getLibraryStats: vi.fn().mockResolvedValue({
    notesTotal: 0,
    notesActive: 0,
    notesPinned: 0,
    notesArchived: 0,
    notesTrashed: 0,
    tags: 0,
    spaces: 0,
    attachmentsCount: 3,
    attachmentsBytes: 4096,
  }),
  getAttachmentsDir: vi.fn().mockResolvedValue("/data/attachments"),
  openAttachmentsFolder: vi.fn().mockResolvedValue(undefined),
}));

afterEach(cleanup);

// `imagePrefs` is a module-level singleton shared across every test in this
// file (it also outlives `init()`'s one-shot fetch guard), so reset its state
// directly rather than depending on a fresh settings read per test.
beforeEach(() => {
  imagePrefs.storage = "copy";
  imagePrefs.maxPreviewHeight = DEFAULT_MAX_HEIGHT;
  vi.mocked(setSetting).mockClear();
  vi.mocked(openAttachmentsFolder).mockClear();
});

describe("SettingsImages", () => {
  it("shows the storage mode row with copy selected by default", async () => {
    const { findByRole, getByRole } = render(SettingsImages);
    await findByRole("radiogroup", { name: "When adding an image" });
    const radios = getByRole("radiogroup").querySelectorAll('[role="radio"]');
    expect([...radios].map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false"]);
  });

  it("switching to Link original persists the setting", async () => {
    const { findByRole } = render(SettingsImages);
    const link = await findByRole("radio", { name: "Link original" });
    await fireEvent.click(link);
    expect(vi.mocked(setSetting)).toHaveBeenCalledWith("images.storage", "link");
  });

  it("reflects an already-link storage mode", async () => {
    imagePrefs.storage = "link";
    const { findByRole } = render(SettingsImages);
    const radio = await findByRole("radio", { name: "Link original" });
    expect(radio.getAttribute("aria-checked")).toBe("true");
  });

  it("starts the preview-height slider at the default and within its bounds", async () => {
    const { findByLabelText } = render(SettingsImages);
    const slider = (await findByLabelText("Maximum image preview height")) as HTMLInputElement;
    expect(slider.value).toBe(String(DEFAULT_MAX_HEIGHT));
    expect(slider.min).toBe("120");
    expect(slider.max).toBe("900");
  });

  it("persists a moved slider value", async () => {
    const { findByLabelText } = render(SettingsImages);
    const slider = (await findByLabelText("Maximum image preview height")) as HTMLInputElement;
    await fireEvent.input(slider, { target: { value: "600" } });
    expect(vi.mocked(setSetting)).toHaveBeenCalledWith("images.maxPreviewHeight", 600);
  });

  it("shows the attachments count, size, and location once loaded", async () => {
    const { findByText } = render(SettingsImages);
    expect(await findByText("3")).toBeTruthy();
    expect(await findByText("4 KB")).toBeTruthy();
    expect(await findByText("/data/attachments")).toBeTruthy();
  });

  it("opens the attachments folder from its button", async () => {
    const { findByRole } = render(SettingsImages);
    await fireEvent.click(await findByRole("button", { name: "Open attachments folder" }));
    expect(vi.mocked(openAttachmentsFolder)).toHaveBeenCalled();
  });
});
