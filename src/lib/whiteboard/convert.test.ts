import { describe, it, expect, vi, beforeEach } from "vitest";
import { confirmConvertToWhiteboard } from "./convert";
import { library } from "$lib/stores/library.svelte";
import { confirmDialog } from "$lib/stores/confirm.svelte";

vi.mock("$lib/stores/library.svelte", () => ({
  library: { selected: null, convertToWhiteboard: vi.fn() },
}));
vi.mock("$lib/stores/confirm.svelte", () => ({
  confirmDialog: { ask: vi.fn() },
}));

const lib = library as unknown as {
  selected: Record<string, unknown> | null;
  convertToWhiteboard: ReturnType<typeof vi.fn>;
};
const ask = vi.mocked(confirmDialog.ask);

beforeEach(() => {
  lib.convertToWhiteboard.mockReset();
  ask.mockReset();
  lib.selected = { id: "n1", isDeleted: false, contentKind: "document" };
});

describe("confirmConvertToWhiteboard", () => {
  it("says the text moves onto the board and that there is no way back", async () => {
    ask.mockResolvedValue(false);
    await confirmConvertToWhiteboard();
    const { body } = ask.mock.calls[0][0];
    expect(body).toMatch(/text moves onto the board/);
    expect(body).toMatch(/can't be turned back/);
  });

  it("converts only when confirmed", async () => {
    ask.mockResolvedValue(false);
    expect(await confirmConvertToWhiteboard()).toBe(false);
    expect(lib.convertToWhiteboard).not.toHaveBeenCalled();

    ask.mockResolvedValue(true);
    expect(await confirmConvertToWhiteboard()).toBe(true);
    expect(lib.convertToWhiteboard).toHaveBeenCalledTimes(1);
  });

  it("does not ask about a board or a trashed note", async () => {
    lib.selected = { id: "b1", isDeleted: false, contentKind: "whiteboard" };
    expect(await confirmConvertToWhiteboard()).toBe(false);
    lib.selected = { id: "n1", isDeleted: true, contentKind: "document" };
    expect(await confirmConvertToWhiteboard()).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });
});
