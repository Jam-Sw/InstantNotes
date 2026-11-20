import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSetting, setSetting } from "$lib/api/client";

vi.mock("$lib/api/client", () => ({
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => {}),
}));

const mockGetSetting = vi.mocked(getSetting);
const mockSetSetting = vi.mocked(setSetting);

async function load() {
  const mod = await import("./confirm.svelte");
  return mod.confirmDialog;
}

beforeEach(() => {
  vi.resetModules();
  mockSetSetting.mockClear();
  mockGetSetting.mockReset().mockResolvedValue(null);
});

describe("confirm level", () => {
  it("asks about everything by default", async () => {
    const confirmDialog = await load();
    const answer = confirmDialog.ask({ title: "End?", recoverable: true });
    await vi.waitFor(() => expect(confirmDialog.request?.title).toBe("End?"));
    confirmDialog.confirm();
    expect(await answer).toBe(true);
  });

  it("shows a prompt for a permanent action at once", async () => {
    const confirmDialog = await load();
    const answer = confirmDialog.ask({ title: "Delete?", tone: "danger" });
    expect(confirmDialog.request?.title).toBe("Delete?");
    confirmDialog.cancel();
    expect(await answer).toBe(false);
  });

  it("skips only recoverable prompts when set to permanent only", async () => {
    mockGetSetting.mockResolvedValue("permanent");
    const confirmDialog = await load();
    expect(await confirmDialog.ask({ title: "End?", recoverable: true })).toBe(true);
    expect(confirmDialog.request).toBeNull();
    const answer = confirmDialog.ask({ title: "Delete?", tone: "danger" });
    expect(confirmDialog.request?.title).toBe("Delete?");
    confirmDialog.cancel();
    expect(await answer).toBe(false);
  });

  it("ignores an unknown saved level", async () => {
    mockGetSetting.mockResolvedValue("never");
    const confirmDialog = await load();
    await confirmDialog.init();
    expect(confirmDialog.level).toBe("always");
  });

  it("saves a change", async () => {
    const confirmDialog = await load();
    confirmDialog.setLevel("permanent");
    expect(confirmDialog.level).toBe("permanent");
    expect(mockSetSetting).toHaveBeenCalledWith("confirm.level", "permanent");
    expect(await confirmDialog.ask({ title: "End?", recoverable: true })).toBe(true);
  });
});

describe("CONFIRM_DEFAULTS defaults", () => {
  it("starts every field at its default", async () => {
    const mod = await import("./confirm.svelte");
    const { CONFIRM_DEFAULTS, confirmDialog } = mod;
    expect(CONFIRM_DEFAULTS.level).toBe("always");
    expect(confirmDialog.level).toBe("always");
  });
});
