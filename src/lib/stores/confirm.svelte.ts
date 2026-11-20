import { getSetting, setSetting } from "$lib/api/client";

const KEY_LEVEL = "confirm.level";

export type ConfirmLevel = "always" | "permanent";

export const CONFIRM_DEFAULTS: { level: ConfirmLevel } = { level: "always" };

interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "neutral";
  recoverable?: boolean;
}

interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: "danger" | "neutral";
}

class ConfirmDialogStore {
  request = $state<ConfirmRequest | null>(null);
  level = $state<ConfirmLevel>(CONFIRM_DEFAULTS.level);

  #resolve: ((ok: boolean) => void) | null = null;
  #invoker: HTMLElement | null = null;
  #loaded: Promise<void> | null = null;
  #touched = false;

  init(): Promise<void> {
    this.#loaded ??= getSetting<string>(KEY_LEVEL)
      .then((saved) => {
        if (!this.#touched && (saved === "always" || saved === "permanent")) this.level = saved;
      })
      .catch(() => {});
    return this.#loaded;
  }

  setLevel(v: ConfirmLevel): void {
    this.#touched = true;
    this.level = v;
    void setSetting(KEY_LEVEL, v);
  }

  async ask(options: ConfirmOptions): Promise<boolean> {
    if (options.recoverable) {
      await this.init();
      if (this.level === "permanent") return true;
    }
    return this.#prompt(options);
  }

  #prompt(options: ConfirmOptions): Promise<boolean> {
    this.#settle(false);
    this.#invoker =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return new Promise<boolean>((resolve) => {
      this.#resolve = resolve;
      this.request = {
        title: options.title,
        body: options.body ?? "",
        confirmLabel: options.confirmLabel ?? "Confirm",
        cancelLabel: options.cancelLabel ?? "Cancel",
        tone: options.tone ?? "neutral",
      };
    });
  }

  confirm(): void {
    this.#settle(true);
  }

  cancel(): void {
    this.#settle(false);
  }

  #settle(result: boolean): void {
    if (!this.#resolve) return;
    this.request = null;
    const resolve = this.#resolve;
    const invoker = this.#invoker;
    this.#resolve = null;
    this.#invoker = null;
    resolve(result);
    queueMicrotask(() => invoker?.focus());
  }
}

export const confirmDialog = new ConfirmDialogStore();
