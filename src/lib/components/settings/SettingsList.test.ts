import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import SettingsList from "./SettingsList.svelte";
import { listPrefs } from "$lib/stores/list.svelte";
import { library } from "$lib/stores/library.svelte";
import { setSetting } from "$lib/api/client";

vi.mock("$lib/api/client", () => ({
  getSetting: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("$lib/stores/library.svelte", () => ({ library: { refresh: vi.fn() } }));

afterEach(cleanup);

beforeEach(() => {
  listPrefs.sortBy = "updatedAt";
  listPrefs.sortOrder = "desc";
  listPrefs.previewChars = 90;
  listPrefs.recentCount = 5;
  listPrefs.reopenLast = false;
  vi.mocked(setSetting).mockClear();
  vi.mocked(library.refresh).mockClear();
});

describe("SettingsList", () => {
  it("shows sort and order, with preview and recent under More", () => {
    const { getByRole, getByText } = render(SettingsList);
    getByRole("radiogroup", { name: "Sort by" });
    getByRole("radiogroup", { name: "Order" });
    const more = getByText("More").closest("details");
    expect(more?.open).toBe(false);
    expect(more?.querySelector('[aria-label="Preview length"]')).not.toBeNull();
    expect(more?.querySelector('[aria-label="Recent notes"]')).not.toBeNull();
  });

  it("saves the sort and refreshes the list", async () => {
    const { getByRole } = render(SettingsList);
    await fireEvent.click(getByRole("radio", { name: "Title" }));
    expect(setSetting).toHaveBeenLastCalledWith("list.sortBy", "title");
    expect(library.refresh).toHaveBeenCalledTimes(1);
    await fireEvent.click(getByRole("radio", { name: "Oldest" }));
    expect(setSetting).toHaveBeenLastCalledWith("list.sortOrder", "asc");
    expect(library.refresh).toHaveBeenCalledTimes(2);
  });

  it("saves Reopen last note, off by default", async () => {
    const { getByRole } = render(SettingsList);
    const toggle = getByRole("switch", { name: "Reopen last note" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await fireEvent.click(toggle);
    expect(setSetting).toHaveBeenLastCalledWith("list.reopenLast", true);
    expect(listPrefs.reopenLast).toBe(true);
  });

  it("starts the sliders at the defaults within their bounds and saves moves", async () => {
    const { getByLabelText } = render(SettingsList);
    const preview = getByLabelText("Preview length") as HTMLInputElement;
    expect([preview.value, preview.min, preview.max, preview.step]).toEqual(["90", "40", "300", "10"]);
    await fireEvent.input(preview, { target: { value: "150" } });
    expect(setSetting).toHaveBeenLastCalledWith("list.previewChars", 150);
    const recent = getByLabelText("Recent notes") as HTMLInputElement;
    expect([recent.value, recent.min, recent.max]).toEqual(["5", "3", "20"]);
    await fireEvent.input(recent, { target: { value: "8" } });
    expect(setSetting).toHaveBeenLastCalledWith("list.recentCount", 8);
  });
});

describe("SettingsList reset", () => {
  it("resets the sort and refreshes the list", async () => {
    const { getByRole, queryAllByRole } = render(SettingsList);
    expect(queryAllByRole("button", { name: "Reset" })).toHaveLength(0);
    await fireEvent.click(getByRole("radio", { name: "Title" }));
    vi.mocked(library.refresh).mockClear();
    await fireEvent.click(getByRole("radiogroup", { name: "Sort by" }).closest(".pref-row")!.querySelector(".pref-reset") as HTMLElement);
    expect(listPrefs.sortBy).toBe("updatedAt");
    expect(library.refresh).toHaveBeenCalledTimes(1);
  });

  it("resets a slider to its default", async () => {
    const { getByLabelText, queryAllByRole } = render(SettingsList);
    await fireEvent.input(getByLabelText("Preview length"), { target: { value: "150" } });
    const buttons = queryAllByRole("button", { name: "Reset" });
    expect(buttons).toHaveLength(1);
    await fireEvent.click(buttons[0]);
    expect(listPrefs.previewChars).toBe(90);
    expect(setSetting).toHaveBeenLastCalledWith("list.previewChars", 90);
  });
});
