import { describe, it, expect, vi } from "vitest";
import {
  diagnosticsIssueUrl,
  installErrorHandlers,
  newReportsSince,
  readWebErrors,
  storeWebError,
  webReport,
} from "./diagnostics";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("webReport", () => {
  it("is the version, browser, storage, sync stage and stored errors", () => {
    const text = webReport({
      version: "0.10.1",
      userAgent: "TestBrowser/1",
      storage: { usage: 2 * 1024 * 1024, quota: 100 * 1024 * 1024 },
      syncStage: "upToDate",
      errors: [{ at: "2026-10-13T07:00:00Z", where: "error", message: "boom", stack: "at a\n at b" }],
    });
    expect(text).toBe(
      "InstantNotes 0.10.1 (web, TestBrowser/1)\n" +
        "Storage: 2.0 MB of 100.0 MB\n" +
        "Sync: upToDate\n" +
        "Errors this session: 1\n" +
        "2026-10-13T07:00:00Z error: boom\n" +
        "  at a\n" +
        "  at b\n",
    );
  });
});

describe("diagnosticsIssueUrl", () => {
  it("opens a bug issue carrying the report", () => {
    const url = new URL(diagnosticsIssueUrl("InstantNotes 0.10.1 (desktop, macos aarch64)\n"));
    expect(url.pathname).toBe("/Jam-Sw/InstantNotes/issues/new");
    expect(url.searchParams.get("labels")).toBe("bug");
    expect(url.searchParams.get("body")).toContain(
      "```\nInstantNotes 0.10.1 (desktop, macos aarch64)\n```",
    );
  });

  it("shortens a very long report and says so", () => {
    const body = new URL(diagnosticsIssueUrl("x".repeat(20000))).searchParams.get("body") ?? "";
    expect(body.length).toBeLessThan(7000);
    expect(body).toContain("report shortened");
  });
});

describe("newReportsSince", () => {
  const reports = [{ madeAt: "2026-10-13T08:00:00Z" }, { madeAt: "2026-10-12T08:00:00Z" }];
  it("is every report before any prompt, then only newer ones", () => {
    expect(newReportsSince(reports, null)).toHaveLength(2);
    expect(newReportsSince(reports, "2026-10-12T08:00:00Z")).toEqual([reports[0]]);
    expect(newReportsSince(reports, "2026-10-13T08:00:00Z")).toEqual([]);
  });
});

describe("web errors", () => {
  it("keeps the last twenty", () => {
    const storage = memoryStorage();
    for (let i = 0; i < 20 + 5; i++) {
      storeWebError({ at: `t${i}`, where: "error", message: `m${i}`, stack: null }, storage);
    }
    const kept = readWebErrors(storage);
    expect(kept).toHaveLength(20);
    expect(kept[0].message).toBe("m5");
    expect(kept.at(-1)?.message).toBe(`m${20 + 4}`);
  });

  it("reads nothing from a broken entry", () => {
    const storage = memoryStorage();
    storage.setItem("instantnotes.errors", "{");
    expect(readWebErrors(storage)).toEqual([]);
  });
});

describe("installErrorHandlers", () => {
  it("reports errors and rejections until removed", () => {
    const report = vi.fn();
    const stop = installErrorHandlers(report);
    const error = new Error("kaput");
    window.dispatchEvent(new ErrorEvent("error", { error, message: "kaput" }));
    const rejection = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(rejection, "reason", { value: "nope" });
    window.dispatchEvent(rejection);
    expect(report).toHaveBeenNthCalledWith(1, "kaput", error.stack, "error");
    expect(report).toHaveBeenNthCalledWith(2, "nope", null, "unhandledrejection");
    stop();
    window.dispatchEvent(new ErrorEvent("error", { message: "later" }));
    expect(report).toHaveBeenCalledTimes(2);
  });
});
