import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getSetting, listCrashReports, reportFrontendError, setSetting } from "$lib/api/client";
import { startDiagnostics } from "./diagnostics";
import { shell } from "$lib/stores/shell.svelte";
import { toasts } from "$lib/stores/toasts.svelte";

vi.mock("$lib/api/runtime", () => ({ clientId: "tab-1", isWeb: false }));
vi.mock("$lib/api/client", () => ({
  appVersion: vi.fn(),
  diagnosticsReport: vi.fn(),
  getSetting: vi.fn(),
  getSyncServerStatus: vi.fn(),
  listCrashReports: vi.fn(),
  reportFrontendError: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn(),
}));

const REPORTS = [
  { name: "crash-20261013-080000.txt", madeAt: "2026-10-13T08:00:00Z", bytes: 10 },
  { name: "error-20261012-080000.txt", madeAt: "2026-10-12T08:00:00Z", bytes: 10 },
];

function settings(values: Record<string, unknown>) {
  vi.mocked(getSetting).mockImplementation(async (key: string) => (values[key] ?? null) as never);
}

let stop: (() => void) | undefined;

async function launch() {
  stop = startDiagnostics();
  await vi.waitFor(() => expect(getSetting).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 0));
}

afterEach(() => stop?.());

beforeEach(() => {
  vi.mocked(getSetting).mockReset();
  toasts.items = [];
  vi.mocked(setSetting).mockReset().mockResolvedValue(undefined);
  vi.mocked(listCrashReports).mockReset().mockResolvedValue(REPORTS);
});

describe("the launch prompt", () => {
  it("stays quiet with the switch off", async () => {
    settings({});
    await launch();
    expect(toasts.items).toEqual([]);
    expect(listCrashReports).not.toHaveBeenCalled();
  });

  it("asks once for new reports and Review opens the page", async () => {
    settings({ "diagnostics.crashReports": true, "diagnostics.lastPromptAt": "2026-10-12T08:00:00Z" });
    await launch();
    expect(toasts.items.map((t) => t.message)).toEqual([
      "InstantNotes had a problem last time. Review the report?",
    ]);
    expect(setSetting).toHaveBeenCalledWith("diagnostics.lastPromptAt", "2026-10-13T08:00:00Z");
    toasts.activate(toasts.items[0].id);
    expect(shell.settingsOpen).toBe(true);
    expect(shell.settingsPage).toBe("diagnostics");
  });

  it("stays quiet when nothing is newer than the last prompt", async () => {
    settings({ "diagnostics.crashReports": true, "diagnostics.lastPromptAt": "2026-10-13T08:00:00Z" });
    await launch();
    expect(toasts.items).toEqual([]);
  });
});

describe("startDiagnostics", () => {
  it("hands a page error to the desktop report", async () => {
    settings({});
    await launch();
    window.dispatchEvent(new ErrorEvent("error", { message: "kaput" }));
    expect(reportFrontendError).toHaveBeenCalledWith("kaput", null, "error");
  });
});
