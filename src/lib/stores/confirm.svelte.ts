// Promise-based confirm dialog for irreversible actions, replacing every
// window.confirm in the app. One host (ConfirmDialog.svelte) is mounted once
// in +page.svelte; call sites just `await confirmDialog.ask(...)`.

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "neutral";
}

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: "danger" | "neutral";
}

class ConfirmDialogStore {
  request = $state<ConfirmRequest | null>(null);

  #resolve: ((ok: boolean) => void) | null = null;
  // Focus returns here once the dialog closes, so a keyboard user lands back
  // where they were rather than at the top of the document.
  #invoker: HTMLElement | null = null;

  ask(options: ConfirmOptions): Promise<boolean> {
    // Only one confirm can be open at a time; a second call while one is
    // pending settles the first as cancelled rather than stacking dialogs.
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
