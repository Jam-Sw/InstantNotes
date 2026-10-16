import { githubIssueUrl } from "$lib/feedback";

export const CRASH_PROMPT_SETTING = "diagnostics.crashReports";
export const LAST_PROMPT_SETTING = "diagnostics.lastPromptAt";
const WEB_ERRORS_KEY = "instantnotes.errors";
const WEB_ERRORS_KEPT = 20;
const MAX_URL_REPORT_CHARS = 6000;

export interface StoredError {
  at: string;
  where: string;
  message: string;
  stack: string | null;
}

export interface WebReportInput {
  version: string;
  userAgent: string;
  storage: { usage: number; quota: number } | null;
  syncStage: string | null;
  errors: StoredError[];
}

export function webReport(r: WebReportInput): string {
  const lines = [`InstantNotes ${r.version || "unknown"} (web, ${r.userAgent})`];
  if (r.storage) {
    const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
    lines.push(`Storage: ${mb(r.storage.usage)} of ${mb(r.storage.quota)}`);
  }
  lines.push(`Sync: ${r.syncStage ?? "unknown"}`);
  lines.push(`Errors this session: ${r.errors.length}`);
  for (const e of r.errors) {
    lines.push(`${e.at} ${e.where}: ${e.message}`);
    if (e.stack) lines.push(...e.stack.trim().split("\n").map((l) => `  ${l.trim()}`));
  }
  return lines.join("\n") + "\n";
}

export function diagnosticsIssueUrl(report: string, repo?: string): string {
  const cut = report.length > MAX_URL_REPORT_CHARS;
  const shown = cut ? report.slice(0, MAX_URL_REPORT_CHARS) : report;
  const note = cut ? "\n\n[report shortened; paste the copied report for the rest]" : "";
  return githubIssueUrl({
    category: "bug",
    message: "Diagnostics report\n\nWhat were you doing when it went wrong?",
    diagnostics: "```\n" + shown.trimEnd() + "\n```" + note,
    repo,
  });
}

export function newReportsSince<T extends { madeAt: string }>(
  reports: T[],
  lastPromptAt: string | null,
): T[] {
  if (!lastPromptAt) return reports;
  return reports.filter((r) => r.madeAt > lastPromptAt);
}

export function readWebErrors(storage: Storage | undefined = globalThis.sessionStorage): StoredError[] {
  try {
    const raw = storage?.getItem(WEB_ERRORS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as StoredError[]) : [];
  } catch {
    return [];
  }
}

export function storeWebError(
  error: StoredError,
  storage: Storage | undefined = globalThis.sessionStorage,
): void {
  try {
    const kept = [...readWebErrors(storage), error].slice(-WEB_ERRORS_KEPT);
    storage?.setItem(WEB_ERRORS_KEY, JSON.stringify(kept));
  } catch {
    return;
  }
}

function describe(reason: unknown): { message: string; stack: string | null } {
  if (reason instanceof Error) return { message: reason.message, stack: reason.stack ?? null };
  return { message: String(reason), stack: null };
}

export function installErrorHandlers(
  report: (message: string, stack: string | null, where: string) => void,
  target: Window = window,
): () => void {
  const onError = (e: ErrorEvent) => {
    const { message, stack } = e.error ? describe(e.error) : { message: e.message, stack: null };
    report(message || "unknown error", stack, "error");
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    const { message, stack } = describe(e.reason);
    report(message, stack, "unhandledrejection");
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
