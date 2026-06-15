// Self-update state (Svelte 5 runes). Checks GitHub Releases via the Tauri
// updater plugin. Automatic checks stay silent unless an update exists (the
// happy path is invisible); a manual check — from the tray "Check for
// Updates…" — surfaces the outcome either way, including "up to date" and
// errors, so the user is never left guessing. The UI (UpdatePanel) reads this
// store to show exactly what is being updated and to what version.

import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "uptodate"
  | "downloading"
  | "ready"
  | "error";

const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

class UpdaterStore {
  status = $state<UpdateStatus>("idle");
  /** Version offered by the latest release (the target of the update). */
  version = $state<string | null>(null);
  /** Version currently installed, per the updater manifest comparison. */
  currentVersion = $state<string | null>(null);
  /** Release notes for the available update, verbatim from the manifest. */
  notes = $state<string | null>(null);
  // 0..1 while downloading, null when total size is unknown.
  progress = $state<number | null>(null);
  error = $state<string | null>(null);

  #update: Update | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;

  /** Check once now, then every RECHECK_INTERVAL_MS while running. */
  start() {
    if (this.#timer) return;
    void this.checkNow();
    this.#timer = setInterval(() => void this.checkNow(), RECHECK_INTERVAL_MS);
  }

  stop() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /**
   * Look for a newer release. Automatic checks (`manual` false) stay silent on
   * "no update" and on failure — updates are a suggestion, never an
   * obstruction. A manual check reports both outcomes so the user gets an
   * answer.
   */
  async checkNow(opts: { manual?: boolean } = {}) {
    const manual = opts.manual ?? false;
    // Never interrupt a download or a pending restart.
    if (this.status === "downloading" || this.status === "ready") return;
    this.status = "checking";
    this.error = null;
    try {
      const update = await check();
      if (update) {
        this.#update = update;
        this.version = update.version;
        this.currentVersion = update.currentVersion;
        this.notes = update.body?.trim() || null;
        this.status = "available";
      } else {
        this.status = manual ? "uptodate" : "idle";
      }
    } catch (e) {
      if (manual) {
        this.error = e instanceof Error ? e.message : String(e);
        this.status = "error";
      } else {
        // Offline, private repo, or no manifest yet: stay silent.
        this.status = "idle";
      }
    }
  }

  async downloadAndInstall() {
    const update = this.#update;
    if (!update || this.status === "downloading") return;
    this.status = "downloading";
    this.progress = null;
    this.error = null;
    let total: number | null = null;
    let received = 0;
    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? null;
            break;
          case "Progress":
            received += event.data.chunkLength;
            if (total) this.progress = Math.min(received / total, 1);
            break;
        }
      });
      this.status = "ready";
    } catch (e) {
      this.status = "error";
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async restart() {
    if (this.status !== "ready") return;
    await relaunch();
  }

  /** Clear a transient result (up-to-date / error) so the indicator hides. */
  dismiss() {
    if (this.status === "uptodate" || this.status === "error") {
      this.status = "idle";
      this.error = null;
    }
  }
}

export const updater = new UpdaterStore();
