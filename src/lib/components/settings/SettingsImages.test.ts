// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import SettingsImages from "./SettingsImages.svelte";
import { imagePrefs, DEFAULT_MAX_HEIGHT } from "$lib/stores/images.svelte";
import {
  setSetting,
  openAttachmentsFolder,
  unusedAttachments,
  removeUnusedAttachments,
} from "$lib/api/client";
import { confirmDialog } from "$lib/stores/confirm.svelte";
import { toasts } from "$lib/stores/toasts.svelte";

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
  unusedAttachments: vi.fn(),
  removeUnusedAttachments: vi.fn(),
}));
vi.mock("$lib/stores/confirm.svelte", () => ({
  confirmDialog: { ask: vi.fn() },
}));

afterEach(cleanup);

beforeEach(() => {
  imagePrefs.storage = "copy";
  imagePrefs.maxPreviewHeight = DEFAULT_MAX_HEIGHT;
  vi.mocked(setSetting).mockClear();
  vi.mocked(openAttachmentsFolder).mockClear();
  vi.mocked(unusedAttachments).mockReset().mockResolvedValue({ count: 0, bytes: 0 });
  vi.mocked(removeUnusedAttachments).mockReset();
  vi.mocked(confirmDialog.ask).mockReset();
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

  it("reports images no note uses any more, with their size", async () => {
    vi.mocked(unusedAttachments).mockResolvedValue({ count: 2, bytes: 3 * 1024 * 1024 });
    const { findByText, findByRole } = render(SettingsImages);
    expect(await findByText("2 images, 3 MB")).toBeTruthy();
    expect((await findByRole("button", { name: "Remove unused…" })).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("says so, with nothing to press, when every image is in use", async () => {
    const { findByText, findByRole } = render(SettingsImages);
    expect(await findByText("None")).toBeTruthy();
    expect((await findByRole("button", { name: "Remove unused…" })).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("removes them only after confirming, then reports what it freed", async () => {
    vi.mocked(unusedAttachments)
      .mockResolvedValueOnce({ count: 2, bytes: 2048 })
      .mockResolvedValue({ count: 0, bytes: 0 });
    vi.mocked(removeUnusedAttachments).mockResolvedValue({ count: 2, bytes: 2048 });
    vi.mocked(confirmDialog.ask).mockResolvedValue(true);
    const show = vi.spyOn(toasts, "show");
    const { findByRole, findByText } = render(SettingsImages);
    await findByText("2 images, 2 KB");

    await fireEvent.click(await findByRole("button", { name: "Remove unused…" }));

    const ask = vi.mocked(confirmDialog.ask).mock.calls[0][0];
    expect(ask.body).toMatch(/Trash/);
    expect(vi.mocked(removeUnusedAttachments)).toHaveBeenCalledTimes(1);
    expect(await findByText("None")).toBeTruthy();
    expect(show).toHaveBeenCalledWith("Removed 2 unused images (2 KB).");
  });

  it("does nothing when the confirm is declined", async () => {
    vi.mocked(unusedAttachments).mockResolvedValue({ count: 1, bytes: 10 });
    vi.mocked(confirmDialog.ask).mockResolvedValue(false);
    const { findByRole } = render(SettingsImages);
    const button = await findByRole("button", { name: "Remove unused…" });
    await vi.waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    await fireEvent.click(button);
    expect(vi.mocked(removeUnusedAttachments)).not.toHaveBeenCalled();
  });
});
