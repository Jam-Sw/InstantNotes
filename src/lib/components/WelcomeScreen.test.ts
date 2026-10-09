// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/svelte";
import WelcomeScreen from "./WelcomeScreen.svelte";
import { getShortcutFailure } from "$lib/api/client";

vi.mock("$lib/api/client", () => ({ getShortcutFailure: vi.fn() }));
vi.mock("$lib/stores/library.svelte", () => ({ library: { error: null } }));
vi.mock("$lib/stores/updater.svelte", () => ({ updater: { pendingUpdate: null } }));

afterEach(cleanup);

describe("WelcomeScreen", () => {
  it("says another app owns the shortcut when registering it failed", async () => {
    vi.mocked(getShortcutFailure).mockResolvedValue({ label: "Ctrl+Shift+Space", wayland: false });
    const { findByText } = render(WelcomeScreen, { appVersion: "0.9.4", onOpenUpdate: () => {} });
    expect(await findByText(/another app likely owns it/)).toBeTruthy();
  });

  it("points a Wayland desktop at the capture command", async () => {
    vi.mocked(getShortcutFailure).mockResolvedValue({ label: "Ctrl+Shift+Space", wayland: true });
    const { findByText, queryByText } = render(WelcomeScreen, { appVersion: "0.9.4", onOpenUpdate: () => {} });
    expect(await findByText("instantnotes capture")).toBeTruthy();
    expect(queryByText(/another app likely owns it/)).toBeNull();
  });
});
