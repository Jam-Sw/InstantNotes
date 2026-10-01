import { describe, it, expect, vi, beforeEach } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { stickiesLocation } from "$lib/api/client";
import {
  chooseStickiesFolder,
  describeImport,
  describeSelection,
  stickyBody,
  stickyDate,
} from "./stickies-import";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("$lib/api/client", () => ({ stickiesLocation: vi.fn() }));

const STICKIES = "/Users/me/Library/Containers/com.apple.Stickies/Data/Library/Stickies";

beforeEach(() => {
  vi.mocked(open).mockReset();
  vi.mocked(stickiesLocation).mockReset();
});

describe("chooseStickiesFolder", () => {
  it("opens the picker already in Stickies' folder", async () => {
    vi.mocked(stickiesLocation).mockResolvedValue(STICKIES);
    vi.mocked(open).mockResolvedValue(STICKIES);
    expect(await chooseStickiesFolder()).toEqual({ path: STICKIES });
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ directory: true, multiple: false, defaultPath: STICKIES }),
    );
  });

  it("still opens, just not there, when the location is unknown", async () => {
    vi.mocked(stickiesLocation).mockRejectedValue(new Error("no home"));
    vi.mocked(open).mockResolvedValue(null);
    expect(await chooseStickiesFolder()).toEqual({ cancelled: true });
    expect(vi.mocked(open).mock.calls[0][0]?.defaultPath).toBeUndefined();
  });
});

describe("the page's words", () => {
  it("shows a sticky's text under its title, not the title again", () => {
    expect(stickyBody("\nGroceries\n- milk\n- eggs")).toBe("- milk\n- eggs");
    expect(stickyBody("Only a title")).toBe("");
    expect(stickyBody("")).toBe("");
  });

  it("dates this year's stickies without a year and older ones with it", () => {
    const now = new Date("2026-09-30T12:00:00Z");
    expect(stickyDate("2026-03-04T12:00:00Z", now)).not.toMatch(/2026/);
    expect(stickyDate("2022-03-04T12:00:00Z", now)).toMatch(/2022/);
  });

  it("counts what is on the board", () => {
    expect(describeSelection(1, 1, 0)).toBe("1 sticky · 1 selected");
    expect(describeSelection(12, 9, 3)).toBe("12 stickies · 9 selected · 3 already imported");
  });

  it("says what an import did, and where", () => {
    expect(describeImport({ imported: 12, skipped: 0, workspaceId: "w" }, "Apple Stickies")).toBe(
      "Imported 12 stickies into Apple Stickies.",
    );
    expect(describeImport({ imported: 1, skipped: 0, workspaceId: null }, null)).toBe(
      "Imported 1 sticky.",
    );
    expect(describeImport({ imported: 2, skipped: 1, workspaceId: "w" }, "Work")).toBe(
      "Imported 2 stickies into Work. 1 was already here.",
    );
    expect(describeImport({ imported: 0, skipped: 3, workspaceId: null }, "Work")).toBe(
      "Nothing new to import. 3 were already here.",
    );
  });
});
