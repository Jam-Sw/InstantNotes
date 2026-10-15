import {
  appVersion,
  diagnosticsReport,
  getSetting,
  getSyncServerStatus,
  listCrashReports,
  reportFrontendError,
  setSetting,
} from "$lib/api/client";
import { isWeb } from "$lib/api/runtime";
import {
  CRASH_PROMPT_SETTING,
  LAST_PROMPT_SETTING,
  installErrorHandlers,
  newReportsSince,
  readWebErrors,
  storeWebError,
  webReport,
} from "$lib/diagnostics";
import { shell } from "$lib/stores/shell.svelte";
import { toasts } from "$lib/stores/toasts.svelte";

export async function buildReport(): Promise<string> {
  if (!isWeb) return diagnosticsReport();
  const [version, estimate, sync] = await Promise.all([
    appVersion().catch(() => ""),
    navigator.storage?.estimate?.().catch(() => null) ?? Promise.resolve(null),
    getSyncServerStatus().catch(() => null),
  ]);
  return webReport({
    version,
    userAgent: navigator.userAgent,
    storage: estimate ? { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 } : null,
    syncStage: sync?.stage ?? null,
    errors: readWebErrors(),
  });
}

async function promptForCrashReports(): Promise<void> {
  if (isWeb) return;
  try {
    if ((await getSetting<boolean>(CRASH_PROMPT_SETTING)) !== true) return;
    const last = await getSetting<string>(LAST_PROMPT_SETTING);
    const fresh = newReportsSince(await listCrashReports(), last);
    if (fresh.length === 0) return;
    await setSetting(LAST_PROMPT_SETTING, fresh[0].madeAt);
    toasts.show(
      "InstantNotes had a problem last time. Review the report?",
      { label: "Review", run: () => shell.openSettings("diagnostics") },
      Infinity,
    );
  } catch {
    return;
  }
}

export function startDiagnostics(): () => void {
  void promptForCrashReports();
  return installErrorHandlers((message, stack, where) => {
    if (isWeb) storeWebError({ at: new Date().toISOString(), where, message, stack });
    else void reportFrontendError(message, stack, where).catch(() => {});
  });
}
