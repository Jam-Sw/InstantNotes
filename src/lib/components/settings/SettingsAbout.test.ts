import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import SettingsAbout from "./SettingsAbout.svelte";
import { runCommand } from "$lib/commands";
import { updater } from "$lib/stores/updater.svelte";

vi.mock("$lib/api/client", () => ({
  getCaptureLatency: vi.fn().mockResolvedValue({ lastMs: null, medianMs: 42, samples: 3 }),
  getSetting: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
  installUpdate: vi.fn(),
  restartApp: vi.fn(),
}));
vi.mock("$lib/commands", () => ({ runCommand: vi.fn(async () => {}) }));
vi.mock("$lib/platform", () => ({ platformName: () => "Linux", isMac: false }));

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(runCommand).mockClear();
  updater.status = "idle";
  updater.version = null;
  updater.lastCheckedAt = null;
});

describe("SettingsAbout on the desktop", () => {
  it("shows the version, the real platform and capture readiness", async () => {
    const { getByText, findByText } = render(SettingsAbout, { appVersion: "0.10.1" });
    expect(getByText("0.10.1")).toBeTruthy();
    expect(getByText("Linux")).toBeTruthy();
    expect(await findByText("42 ms")).toBeTruthy();
  });

  it("says when updates were last checked", async () => {
    const { getByText, rerender } = render(SettingsAbout, { appVersion: "0.10.1" });
    expect(getByText("Last checked: never")).toBeTruthy();

    updater.lastCheckedAt = "2026-10-13T09:00:00.000Z";
    updater.status = "uptodate";
    await rerender({ appVersion: "0.10.1" });
    expect(getByText(/^Up to date, checked /)).toBeTruthy();

    updater.status = "checking";
    await rerender({ appVersion: "0.10.1" });
    expect(getByText("Checking…")).toBeTruthy();

    updater.status = "error";
    await rerender({ appVersion: "0.10.1" });
    expect(getByText(/^Couldn't check\. Last checked /)).toBeTruthy();
  });

  it("offers Show update while one is pending, and both buttons run commands", async () => {
    const { getByRole, queryByRole, rerender } = render(SettingsAbout, { appVersion: "0.10.1" });
    expect(queryByRole("button", { name: "Show update" })).toBeNull();

    await fireEvent.click(getByRole("button", { name: "Check for updates" }));
    expect(runCommand).toHaveBeenCalledWith("app.checkUpdates");

    updater.status = "available";
    updater.version = "0.10.2";
    await rerender({ appVersion: "0.10.1" });
    expect(getByRole("button", { name: "Show update" })).toBeTruthy();
    await fireEvent.click(getByRole("button", { name: "Show update" }));
    expect(runCommand).toHaveBeenCalledWith("app.showUpdate");
  });

  it("links the repository, the changelog, the data folder and feedback", async () => {
    const { getByRole } = render(SettingsAbout, { appVersion: "0.10.1" });
    await fireEvent.click(getByRole("button", { name: /Repository/ }));
    await fireEvent.click(getByRole("button", { name: /Full changelog/ }));
    await fireEvent.click(getByRole("button", { name: "Open data folder" }));
    await fireEvent.click(getByRole("button", { name: "Send feedback" }));
    expect(vi.mocked(runCommand).mock.calls.map((c) => c[0])).toEqual([
      "app.openRepo",
      "app.openChangelog",
      "app.openDataFolder",
      "app.sendFeedback",
    ]);
  });
});
