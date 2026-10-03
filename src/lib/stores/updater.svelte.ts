// Self-update state (Svelte 5 runes). Checks GitHub Releases via the Tauri
// updater plugin. Automatic checks stay silent unless an update exists (the
// happy path is invisible); a manual check - from the tray "Check for
// Updates…" - answers with a toast either way, so the user is never left
// guessing.
//
// An available update is surfaced as a synthetic Space (see
// `$lib/update/space.ts`), so this store is the single source for the versions,
// the release notes, the install progress, and the best-effort download-size
// delta. Nothing here writes to SQLite or the vault.

import { check, type Update } from "@tauri-apps/plugin-updater";
import { installUpdate } from "$lib/api/client";
import { toasts } from "$lib/stores/toasts.svelte";
import { fetchUpdateSizeDelta } from "$lib/update/release-size";

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "uptodate"
  | "downloading"
  | "ready"
  | "error";

/** Whether the offered build's size against the running one is known yet. */
type DeltaState = "idle" | "loading" | "ready" | "unavailable";

const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

class UpdaterStore {
  status = $state<UpdateStatus>("idle");
  /** Version offered by the latest release (the target of the update). */
  version = $state<string | null>(null);
  /** Version currently installed, per the updater manifest comparison. */
  currentVersion = $state<string | null>(null);
  /** Release notes for the available update, verbatim from the manifest. */
  notes = $state<string | null>(null);
  /** The release's own date, used to date the synthetic notes. */
  date = $state<string | null>(null);
  // 0..1 while downloading, null when total size is unknown.
  progress = $state<number | null>(null);
  error = $state<string | null>(null);
  /** Offered size minus running size, in bytes; null when unknown. */
  sizeDelta = $state<number | null>(null);
  deltaState = $state<DeltaState>("idle");

  #update: Update | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  // A version the user answered with "Ok": kept off the sidebar for the rest
  // of this run. The update is installable until the app relaunches, so without
  // this the next check would surface the same notification again.
  #acknowledgedVersion: string | null = null;

  /**
   * Whether the update Space should be showing: an update was found and the
   * user has not answered it. Covers every state of the install once found, so
   * the Space never blinks out mid-download or on a failed install.
   */
  get pendingUpdate(): boolean {
    if (this.version == null || this.version === this.#acknowledgedVersion) {
      return false;
    }
    return (
      this.status === "available" ||
      this.status === "checking" ||
      this.status === "downloading" ||
      this.status === "ready" ||
      this.status === "error"
    );
  }

  /** Check once now, then every RECHECK_INTERVAL_MS while running. */
  start() {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.checkNow(), RECHECK_INTERVAL_MS);
    void this.checkNow();
  }

  stop() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /**
   * Look for a newer release. Automatic checks (`manual` false) stay silent on
   * "no update" and on failure - updates are a suggestion, never an
   * obstruction. A manual check reports both outcomes with a toast, since there
   * is no dialog to answer into.
   */
  async checkNow(opts: { manual?: boolean } = {}) {
    const manual = opts.manual ?? false;
    // Never interrupt a download or a pending acknowledgment.
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
        this.date = update.date ?? null;
        this.status = "available";
        void this.#loadSizeDelta();
      } else {
        this.status = manual ? "uptodate" : "idle";
        if (manual) toasts.show("InstantNotes is up to date");
      }
    } catch (e) {
      if (manual) {
        this.error = e instanceof Error ? e.message : String(e);
        this.status = "error";
        toasts.show(
          "Couldn't check for updates. Check your connection and try again.",
        );
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
      await installUpdate(update.rid, (event) => {
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

  /**
   * The user answered the notification's "Ok". The update is installed and
   * applies on the next launch; take the Space down now rather than leaving it
   * up as a done screen.
   */
  acknowledge() {
    this.#acknowledgedVersion = this.version;
    this.status = "idle";
    this.error = null;
  }

  async #loadSizeDelta(): Promise<void> {
    const version = this.version;
    const currentVersion = this.currentVersion;
    if (!version || !currentVersion) {
      this.deltaState = "unavailable";
      return;
    }
    this.deltaState = "loading";
    this.sizeDelta = null;
    const delta = await fetchUpdateSizeDelta({
      currentVersion,
      version,
      userAgent: navigator.userAgent,
    });
    // A newer check superseded this one; its own load owns the field now.
    if (this.version !== version) return;
    this.sizeDelta = delta;
    this.deltaState = delta == null ? "unavailable" : "ready";
  }
}

export const updater = new UpdaterStore();
