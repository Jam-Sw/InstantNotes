import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/svelte";
import SettingsAbout from "./SettingsAbout.svelte";

vi.mock("$lib/api/runtime", () => ({ clientId: "tab-1", isWeb: true }));
vi.mock("$lib/api/client", () => ({
  getCaptureLatency: vi.fn(),
  getSetting: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
  installUpdate: vi.fn(),
  restartApp: vi.fn(),
}));
vi.mock("$lib/commands", () => ({ runCommand: vi.fn(async () => {}) }));

afterEach(cleanup);

describe("SettingsAbout in the web app", () => {
  it("shows the server version, the web platform and no desktop-only rows", () => {
    const { getByText, queryByText, queryByRole } = render(SettingsAbout, { appVersion: "0.10.1" });
    expect(getByText("Server version")).toBeTruthy();
    expect(getByText("Web app")).toBeTruthy();
    expect(getByText("The web app updates with your server")).toBeTruthy();
    expect(queryByText("Capture readiness")).toBeNull();
    expect(queryByRole("button", { name: "Check for updates" })).toBeNull();
    expect(queryByRole("button", { name: "Open data folder" })).toBeNull();
    expect(queryByRole("button", { name: "Send feedback" })).toBeNull();
    expect(queryByRole("button", { name: /Repository/ })).toBeTruthy();
  });
});
