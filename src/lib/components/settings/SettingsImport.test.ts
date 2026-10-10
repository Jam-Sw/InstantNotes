import { describe, it, expect, vi, afterEach, beforeEach, type Mock } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import SettingsImport from "./SettingsImport.svelte";
import { importStickies, openUrl, scanStickies } from "$lib/api/client";
import { chooseStickiesFolder, PRIVACY_SETTINGS_URL } from "$lib/stickies-import";
import type { StickiesScan, StickyPreview } from "$lib/api/types";

vi.mock("$lib/api/client", () => ({
  scanStickies: vi.fn(),
  importStickies: vi.fn(),
  openUrl: vi.fn(),
  stickiesLocation: vi.fn(),
}));
vi.mock("$lib/stickies-import", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/stickies-import")>()),
  chooseStickiesFolder: vi.fn(),
}));

const FOLDER = "/Users/me/Library/Containers/com.apple.Stickies/Data/Library/Stickies";

function sticky(id: string, title: string, over: Partial<StickyPreview> = {}): StickyPreview {
  return {
    id,
    title,
    text: `${title}\nsome words`,
    color: "#fef49c",
    createdAt: "2024-01-01T00:00:00.000000Z",
    updatedAt: "2024-02-01T00:00:00.000000Z",
    images: 0,
    imported: false,
    ...over,
  };
}

const BOARD: StickiesScan = {
  folder: FOLDER,
  readable: true,
  stickies: [
    sticky("A", "Groceries", { images: 2 }),
    sticky("B", "Call the bank", { color: null }),
    sticky("C", "Old list", { imported: true }),
  ],
};

let onShowSpace: Mock<(workspaceId: string) => void>;

function page() {
  onShowSpace = vi.fn<(workspaceId: string) => void>();
  return render(SettingsImport, { onShowSpace });
}

async function choose(view: ReturnType<typeof page>, scan: StickiesScan = BOARD) {
  vi.mocked(scanStickies).mockResolvedValue(scan);
  await fireEvent.click(view.getByRole("button", { name: /Choose Stickies Folder/ }));
}

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(chooseStickiesFolder).mockReset().mockResolvedValue({ path: FOLDER });
  vi.mocked(scanStickies).mockReset();
  vi.mocked(importStickies).mockReset();
  vi.mocked(openUrl).mockReset();
});

describe("Settings > Import", () => {
  it("reads the folder the user picks and shows every sticky, all new ones chosen", async () => {
    const view = page();
    await choose(view);

    expect(scanStickies).toHaveBeenCalledWith(FOLDER);
    const groceries = await view.findByRole("button", { name: /^Groceries/ });
    expect(groceries.getAttribute("aria-pressed")).toBe("true");
    expect(groceries.textContent).toContain("2 images");
    const old = view.getByRole("button", { name: /^Old list.*already imported/ });
    expect((old as HTMLButtonElement).disabled).toBe(true);
    expect(old.textContent).toContain("Imported");
    expect(view.getByText("3 stickies · 2 selected · 1 already imported")).toBeTruthy();
    expect(view.getByRole("button", { name: "Import 2 Stickies" })).toBeTruthy();
  });

  it("imports the chosen ones into the named Space, then shows it", async () => {
    vi.mocked(importStickies).mockResolvedValue({ imported: 1, skipped: 0, workspaceId: "ws-1" });
    const view = page();
    await choose(view);

    await fireEvent.click(await view.findByRole("button", { name: /^Call the bank/ }));
    const input = view.getByRole("textbox", { name: /Space/ }) as HTMLInputElement;
    expect(input.value).toBe("Apple Stickies");
    await fireEvent.input(input, { target: { value: "Desk" } });
    await fireEvent.click(view.getByRole("button", { name: "Import 1 Sticky" }));

    expect(importStickies).toHaveBeenCalledWith(FOLDER, ["A"], "Desk");
    expect(await view.findByText("Imported 1 sticky into Desk.")).toBeTruthy();
    await fireEvent.click(view.getByRole("button", { name: "Show Them" }));
    expect(onShowSpace).toHaveBeenCalledWith("ws-1");
  });

  it("files them in no Space when the field is empty", async () => {
    vi.mocked(importStickies).mockResolvedValue({ imported: 2, skipped: 0, workspaceId: null });
    const view = page();
    await choose(view);
    const input = (await view.findByRole("textbox", { name: /Space/ })) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "   " } });
    await fireEvent.click(view.getByRole("button", { name: "Import 2 Stickies" }));

    expect(importStickies).toHaveBeenCalledWith(FOLDER, ["A", "B"], null);
    expect(await view.findByText("Imported 2 stickies.")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Show Them" })).toBeNull();
  });

  it("with nothing chosen there is nothing to import", async () => {
    const view = page();
    await choose(view);
    await fireEvent.click(await view.findByRole("button", { name: "Select None" }));
    const button = view.getByRole("button", { name: "Import 0 Stickies" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("explains a refusal from macOS and opens Privacy & Security", async () => {
    const view = page();
    await choose(view, { folder: FOLDER, readable: false, stickies: [] });

    expect(await view.findByText(/didn't let InstantNotes read that folder/)).toBeTruthy();
    await fireEvent.click(view.getByRole("button", { name: /Open Privacy/ }));
    expect(openUrl).toHaveBeenCalledWith(PRIVACY_SETTINGS_URL);
  });

  it("says where Stickies keeps its notes when a folder has none", async () => {
    const view = page();
    await choose(view, { folder: "/Users/me/Desktop", readable: true, stickies: [] });
    expect(await view.findByText("There are no stickies in that folder.")).toBeTruthy();
    expect(view.getByText(/com\.apple\.Stickies/)).toBeTruthy();
  });

  it("does nothing when the picker is cancelled", async () => {
    vi.mocked(chooseStickiesFolder).mockResolvedValue({ cancelled: true });
    const view = page();
    await fireEvent.click(view.getByRole("button", { name: /Choose Stickies Folder/ }));
    await waitFor(() => expect(chooseStickiesFolder).toHaveBeenCalled());
    expect(scanStickies).not.toHaveBeenCalled();
    expect(view.getByRole("button", { name: /Choose Stickies Folder/ })).toBeTruthy();
  });
});
