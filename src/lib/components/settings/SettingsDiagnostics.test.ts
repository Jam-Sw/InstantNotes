import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import SettingsDiagnostics from "./SettingsDiagnostics.svelte";
import {
  deleteCrashReport,
  diagnosticsReport,
  getSetting,
  listCrashReports,
  openUrl,
  readCrashReport,
  setSetting,
} from "$lib/api/client";

vi.mock("$lib/api/runtime", () => ({ clientId: "tab-1", isWeb: false }));
vi.mock("$lib/api/client", () => ({
  appVersion: vi.fn(),
  deleteCrashReport: vi.fn(),
  diagnosticsReport: vi.fn(),
  getSetting: vi.fn(),
  getSyncServerStatus: vi.fn(),
  listCrashReports: vi.fn(),
  openUrl: vi.fn(),
  readCrashReport: vi.fn(),
  reportFrontendError: vi.fn(),
  setSetting: vi.fn(),
}));

const REPORT = "InstantNotes 0.10.1 (desktop, macos aarch64)\nCrash reports: 1\n";

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(getSetting).mockReset().mockResolvedValue(null);
  vi.mocked(setSetting).mockReset().mockResolvedValue(undefined);
  vi.mocked(diagnosticsReport).mockReset().mockResolvedValue(REPORT);
  vi.mocked(openUrl).mockReset().mockResolvedValue(undefined);
  vi.mocked(deleteCrashReport).mockReset().mockResolvedValue(undefined);
  vi.mocked(readCrashReport).mockReset().mockResolvedValue("Kind: panic\nMessage: boom\n");
  vi.mocked(listCrashReports)
    .mockReset()
    .mockResolvedValue([{ name: "crash-20261013-080000.txt", madeAt: "2026-10-13T08:00:00Z", bytes: 9 }]);
});

describe("SettingsDiagnostics", () => {
  it("shows the whole report before Send, and Send opens the issue with it", async () => {
    const { getByRole, getByLabelText } = render(SettingsDiagnostics);
    await waitFor(() => expect(getByLabelText("Diagnostics report").textContent).toBe(REPORT));
    expect(openUrl).not.toHaveBeenCalled();
    await fireEvent.click(getByRole("button", { name: "Send" }));
    const url = new URL(vi.mocked(openUrl).mock.calls[0][0]);
    expect(url.searchParams.get("body")).toContain(REPORT.trimEnd());
  });

  it("lists reports, views one into the report and deletes it", async () => {
    const { getByRole, getByLabelText, findByText } = render(SettingsDiagnostics);
    await findByText("crash-20261013-080000.txt");
    await fireEvent.click(getByRole("button", { name: "View" }));
    await waitFor(() => expect(getByLabelText("Diagnostics report").textContent).toContain("Message: boom"));
    vi.mocked(listCrashReports).mockResolvedValue([]);
    await fireEvent.click(getByRole("button", { name: "Delete" }));
    expect(deleteCrashReport).toHaveBeenCalledWith("crash-20261013-080000.txt");
    await findByText("No crash reports.");
  });

  it("the switch saves the prompt setting", async () => {
    const { getByRole } = render(SettingsDiagnostics);
    await fireEvent.click(getByRole("switch", { name: "Ask to review a crash report at the next launch" }));
    expect(setSetting).toHaveBeenCalledWith("diagnostics.crashReports", true);
  });
});
