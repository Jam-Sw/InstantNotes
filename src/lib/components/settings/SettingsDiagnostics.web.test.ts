import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/svelte";
import SettingsDiagnostics from "./SettingsDiagnostics.svelte";
import { listCrashReports } from "$lib/api/client";
import { storeWebError } from "$lib/diagnostics";

vi.mock("$lib/api/runtime", () => ({ clientId: "tab-1", isWeb: true }));
vi.mock("$lib/api/client", () => ({
  appVersion: vi.fn().mockResolvedValue("0.10.1"),
  deleteCrashReport: vi.fn(),
  diagnosticsReport: vi.fn(),
  getSetting: vi.fn(),
  getSyncServerStatus: vi.fn().mockResolvedValue({ stage: "upToDate", message: null }),
  listCrashReports: vi.fn(),
  openUrl: vi.fn(),
  readCrashReport: vi.fn(),
  reportFrontendError: vi.fn(),
  setSetting: vi.fn(),
}));

afterEach(cleanup);

describe("SettingsDiagnostics on the web", () => {
  it("builds the browser's own report with the stored errors and no crash list", async () => {
    storeWebError({ at: "2026-10-13T07:00:00Z", where: "error", message: "boom", stack: null });
    const { getByLabelText, queryByRole } = render(SettingsDiagnostics);
    await waitFor(() => {
      const text = getByLabelText("Diagnostics report").textContent ?? "";
      expect(text).toContain("InstantNotes 0.10.1 (web,");
      expect(text).toContain("Sync: upToDate");
      expect(text).toContain("2026-10-13T07:00:00Z error: boom");
    });
    expect(queryByRole("switch")).toBeNull();
    expect(listCrashReports).not.toHaveBeenCalled();
  });
});
