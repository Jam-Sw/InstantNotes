// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, within } from "@testing-library/svelte";
import SettingsView from "./SettingsView.svelte";

// The sub-pages init preference stores and fetch capture latency on mount;
// stub the IPC client so they render without a Tauri backend.
vi.mock("$lib/api/client", () => ({
  getSetting: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getCaptureLatency: vi.fn().mockResolvedValue({
    lastMs: null,
    medianMs: null,
    samples: 0,
  }),
  getLibraryStats: vi.fn().mockResolvedValue({
    notesTotal: 12,
    notesActive: 10,
    notesPinned: 2,
    notesArchived: 2,
    notesTrashed: 1,
    tags: 5,
    spaces: 3,
    attachmentsCount: 4,
    attachmentsBytes: 2048,
  }),
  getAttachmentsDir: vi.fn().mockResolvedValue("/data/attachments"),
  openAttachmentsFolder: vi.fn().mockResolvedValue(undefined),
  submitFeedback: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

afterEach(cleanup);

function open() {
  const onBack = vi.fn();
  const view = render(SettingsView, { appVersion: "0.8.0", onBack });
  return { onBack, ...view };
}

describe("SettingsView", () => {
  it("lands on the dashboard with a card per page", () => {
    const { getByRole } = open();
    expect(getByRole("button", { name: /About/ })).toBeTruthy();
    expect(getByRole("button", { name: /Editor/ })).toBeTruthy();
    expect(getByRole("button", { name: /Images/ })).toBeTruthy();
    expect(getByRole("button", { name: /Links/ })).toBeTruthy();
    expect(getByRole("button", { name: /Contexting/ })).toBeTruthy();
    expect(getByRole("button", { name: /Feedback/ })).toBeTruthy();
  });

  it("shows the installed version's release notes on the dashboard", async () => {
    const { findByText } = open();
    expect(await findByText(/What's new in v0\.8\.0/)).toBeTruthy();
  });

  it("opens a page from its card and shows a breadcrumb back to Settings", async () => {
    const { getByRole, findByText } = open();
    await fireEvent.click(getByRole("button", { name: /About/ }));
    // The About page rendered (its heading), under a breadcrumb.
    expect(await findByText("InstantNotes")).toBeTruthy();
    const crumb = getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumb).getByText("About")).toBeTruthy();
    // Breadcrumb "Settings" returns to the grid.
    await fireEvent.click(within(crumb).getByRole("button", { name: "Settings" }));
    expect(getByRole("button", { name: /Contexting/ })).toBeTruthy();
  });

  it("Escape steps back to the grid before closing the view", async () => {
    const { getByRole, onBack } = open();
    await fireEvent.click(getByRole("button", { name: /Links/ }));
    // First Escape: back to the grid, view stays open.
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(onBack).not.toHaveBeenCalled();
    expect(getByRole("button", { name: /About/ })).toBeTruthy();
    // Second Escape from the grid: closes the whole view.
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
