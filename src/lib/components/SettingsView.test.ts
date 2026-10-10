import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, within } from "@testing-library/svelte";
import SettingsView from "./SettingsView.svelte";
import { setSetting } from "$lib/api/client";

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
  openFeedbackLog: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
  getAgentConnection: vi.fn().mockResolvedValue(null),
  listAgentActivity: vi.fn().mockResolvedValue([]),
  setWindowVibrancy: vi.fn().mockResolvedValue(undefined),
  setWindowTheme: vi.fn().mockResolvedValue(undefined),
}));

afterEach(cleanup);

function open() {
  const onBack = vi.fn();
  const view = render(SettingsView, { appVersion: "0.8.0", onBack, onShowSpace: vi.fn() });
  return { onBack, ...view };
}

describe("SettingsView", () => {
  it("lands on the overview with a page list down the side", () => {
    const { getByRole } = open();
    expect(getByRole("navigation", { name: "Settings pages" })).toBeTruthy();
    expect(getByRole("button", { name: /Overview/ })).toBeTruthy();
    expect(getByRole("button", { name: /Appearance/ })).toBeTruthy();
    expect(getByRole("button", { name: /About/ })).toBeTruthy();
    expect(getByRole("button", { name: /Editor/ })).toBeTruthy();
    expect(getByRole("button", { name: /Images/ })).toBeTruthy();
    expect(getByRole("button", { name: /Links/ })).toBeTruthy();
    expect(getByRole("button", { name: /Contexting/ })).toBeTruthy();
    expect(getByRole("button", { name: /Vault/ })).toBeTruthy();
    expect(getByRole("button", { name: /Feedback/ })).toBeTruthy();
  });

  it("has no Import page where there is no Apple Stickies", () => {
    const { queryByRole } = open();
    expect(queryByRole("button", { name: /^Import/ })).toBeNull();
  });

  it("shows the capture tile as unmeasured when no latency has been recorded", async () => {
    const { findByText } = open();
    const tile = (await findByText("Capture")).parentElement;
    expect(tile?.textContent).toContain("-ms");
    expect(tile?.textContent).toContain("reveal to ready");
  });

  it("lists every theme on the Appearance page and switches on a click", async () => {
    const { getByRole, findByRole } = open();
    await fireEvent.click(getByRole("button", { name: /Appearance/ }));
    const group = await findByRole("radiogroup", { name: "Theme" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.length).toBeGreaterThanOrEqual(8);
    expect(within(group).getByRole("radio", { name: "Manuscript" }).getAttribute("aria-checked")).toBe("true");
    await fireEvent.click(within(group).getByRole("radio", { name: "Fjord" }));
    expect(vi.mocked(setSetting)).toHaveBeenCalledWith("theme.active", "fjord");
    expect(document.documentElement.dataset.theme).toBe("fjord");
  });

  it("shows the installed version's release notes on the overview", async () => {
    const { findByText } = open();
    expect(await findByText(/What's new in v0\.8\.0/)).toBeTruthy();
  });

  it("omits What's new when the running version has no changelog section", async () => {
    const { queryByText, findByRole } = render(SettingsView, {
      appVersion: "9.9.9",
      onBack: vi.fn(),
      onShowSpace: vi.fn(),
    });
    expect(await findByRole("button", { name: /About/ })).toBeTruthy();
    expect(queryByText(/What's new/)).toBeNull();
  });

  it("filters the page list and opens the first match on Enter", async () => {
    const { getByRole, queryByRole, getByLabelText } = open();
    const filter = getByLabelText("Find a setting");
    await fireEvent.input(filter, { target: { value: "mcp" } });
    const nav = getByRole("navigation", { name: "Settings pages" });
    expect(within(nav).getByRole("button", { name: /Agents/ })).toBeTruthy();
    expect(queryByRole("button", { name: /Editor/ })).toBeNull();
    await fireEvent.keyDown(filter, { key: "Enter" });
    const crumb = getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumb).getByText("Agents")).toBeTruthy();
    await fireEvent.input(filter, { target: { value: "x" } });
    filter.focus();
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(getByRole("button", { name: /Editor/ })).toBeTruthy();
    expect(
      within(getByRole("navigation", { name: "Breadcrumb" })).getByText("Agents"),
    ).toBeTruthy();
  });

  it("lists matches with their description in the main pane and opens one on a click", async () => {
    const { getByRole, getByLabelText } = open();
    const filter = getByLabelText("Find a setting") as HTMLInputElement;
    await fireEvent.input(filter, { target: { value: "dark" } });
    const results = getByRole("region", { name: "Search results" });
    expect(within(results).getByText("Theme, light or dark, and the body font.")).toBeTruthy();
    await fireEvent.click(within(results).getByRole("button", { name: /Appearance/ }));
    const crumb = getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumb).getByText("Appearance")).toBeTruthy();
    expect(filter.value).toBe("");
  });

  it("opens a page from the list and shows a breadcrumb back to Settings", async () => {
    const { getByRole, findByText } = open();
    await fireEvent.click(getByRole("button", { name: /About/ }));
    expect(await findByText("InstantNotes")).toBeTruthy();
    const crumb = getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumb).getByText("About")).toBeTruthy();
    await fireEvent.click(within(crumb).getByRole("button", { name: "Settings" }));
    expect(getByRole("heading", { name: "Overview" })).toBeTruthy();
  });

  it("Escape steps back to the overview before closing the view", async () => {
    const { getByRole, queryByRole, onBack } = open();
    await fireEvent.click(getByRole("button", { name: /Links/ }));
    expect(queryByRole("heading", { name: "Overview" })).toBeNull();
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(onBack).not.toHaveBeenCalled();
    expect(getByRole("heading", { name: "Overview" })).toBeTruthy();
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("builds the Links page from the shared rows and persists a change", async () => {
    const { getByRole, getAllByRole, findAllByRole } = open();
    await fireEvent.click(getByRole("button", { name: /Links/ }));

    const groups = await findAllByRole("radiogroup");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([
      "Open links with",
      "Underline",
    ]);
    expect(getAllByRole("switch").map((s) => s.getAttribute("aria-label"))).toEqual([
      "Show destination on hover",
      expect.stringContaining("Mark external links"),
    ]);

    await fireEvent.click(within(groups[1]).getByRole("radio", { name: "Never" }));
    expect(vi.mocked(setSetting)).toHaveBeenCalledWith("links.underline", "never");
  });
});
