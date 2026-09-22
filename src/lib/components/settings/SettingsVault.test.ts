// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import SettingsVault from "./SettingsVault.svelte";
import { exportVaultToFolder } from "$lib/vault-export";
import { toasts } from "$lib/stores/toasts.svelte";

vi.mock("$lib/vault-export", () => ({
  exportVaultToFolder: vi.fn(),
}));

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(exportVaultToFolder).mockReset();
  toasts.items = [];
});

describe("SettingsVault", () => {
  it("shows a success toast after a completed export", async () => {
    vi.mocked(exportVaultToFolder).mockResolvedValue({ ok: true });
    const { getByRole } = render(SettingsVault);

    await fireEvent.click(getByRole("button", { name: /Export a copy/ }));

    await waitFor(() =>
      expect(toasts.items.map((t) => t.message)).toEqual([
        expect.stringContaining("Exported."),
      ]),
    );
  });

  it("shows no toast when the user cancels the folder picker", async () => {
    vi.mocked(exportVaultToFolder).mockResolvedValue({ cancelled: true });
    const { getByRole } = render(SettingsVault);

    await fireEvent.click(getByRole("button", { name: /Export a copy/ }));
    await waitFor(() => expect(vi.mocked(exportVaultToFolder)).toHaveBeenCalled());

    expect(toasts.items).toEqual([]);
  });

  it("shows the error on failure", async () => {
    vi.mocked(exportVaultToFolder).mockResolvedValue({ ok: false, error: "disk full" });
    const { getByRole } = render(SettingsVault);

    await fireEvent.click(getByRole("button", { name: /Export a copy/ }));

    await waitFor(() =>
      expect(toasts.items.map((t) => t.message)).toEqual([
        expect.stringContaining("disk full"),
      ]),
    );
  });

  it("disables the button while exporting", async () => {
    let resolve!: (v: { ok: true }) => void;
    vi.mocked(exportVaultToFolder).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { getByRole } = render(SettingsVault);
    const button = getByRole("button", { name: /Export a copy/ }) as HTMLButtonElement;

    await fireEvent.click(button);
    expect(button.disabled).toBe(true);

    resolve({ ok: true });
    await waitFor(() => expect(button.disabled).toBe(false));
  });
});
