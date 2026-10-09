import { check, type Update } from "@tauri-apps/plugin-updater";
import { installUpdate, restartApp } from "$lib/api/client";
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

type DeltaState = "idle" | "loading" | "ready" | "unavailable";

const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

class UpdaterStore {
  status = $state<UpdateStatus>("idle");
  version = $state<string | null>(null);
  currentVersion = $state<string | null>(null);
  notes = $state<string | null>(null);
  date = $state<string | null>(null);
  progress = $state<number | null>(null);
  error = $state<string | null>(null);
  sizeDelta = $state<number | null>(null);
  deltaState = $state<DeltaState>("idle");

  #update: Update | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #acknowledgedVersion: string | null = null;

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

  async checkNow(opts: { manual?: boolean } = {}) {
    const manual = opts.manual ?? false;
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

  async restart() {
    await restartApp();
  }

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
    if (this.version !== version) return;
    this.sizeDelta = delta;
    this.deltaState = delta == null ? "unavailable" : "ready";
  }
}

export const updater = new UpdaterStore();
