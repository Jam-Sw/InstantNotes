interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "neutral";
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

  #resolve: ((ok: boolean) => void) | null = null;
  #invoker: HTMLElement | null = null;

  ask(options: ConfirmOptions): Promise<boolean> {
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
