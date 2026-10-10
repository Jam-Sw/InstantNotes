const AUTO_DISMISS_MS = 5000;
const MAX_VISIBLE = 3;

interface ToastAction {
  label: string;
  run: () => void;
}

interface ToastItem {
  readonly id: string;
  readonly message: string;
  readonly action?: ToastAction;
}

class ToastStore {
  items = $state<ToastItem[]>([]);

  #nextId = 0;
  #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #remaining = new Map<string, number>();
  #startedAt = new Map<string, number>();

  show(message: string, action?: ToastAction): string {
    const id = `toast-${++this.#nextId}`;
    const next = [...this.items, { id, message, action }];
    if (next.length > MAX_VISIBLE) {
      const evicted = next.shift();
      if (evicted) this.#clearTimer(evicted.id);
    }
    this.items = next;
    this.#schedule(id, AUTO_DISMISS_MS);
    return id;
  }

  activate(id: string): void {
    const toast = this.items.find((t) => t.id === id);
    this.dismiss(id);
    toast?.action?.run();
  }

  dismiss(id: string): void {
    this.#clearTimer(id);
    this.items = this.items.filter((t) => t.id !== id);
  }

  pause(id: string): void {
    const timer = this.#timers.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.#timers.delete(id);
    const started = this.#startedAt.get(id) ?? Date.now();
    const remaining = this.#remaining.get(id) ?? AUTO_DISMISS_MS;
    this.#remaining.set(id, Math.max(0, remaining - (Date.now() - started)));
  }

  resume(id: string): void {
    if (!this.items.some((t) => t.id === id)) return;
    this.#schedule(id, this.#remaining.get(id) ?? AUTO_DISMISS_MS);
  }

  #schedule(id: string, ms: number): void {
    const existing = this.#timers.get(id);
    if (existing !== undefined) clearTimeout(existing);
    this.#startedAt.set(id, Date.now());
    this.#remaining.set(id, ms);
    this.#timers.set(
      id,
      setTimeout(() => this.dismiss(id), ms),
    );
  }

  #clearTimer(id: string): void {
    const timer = this.#timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.#timers.delete(id);
    this.#remaining.delete(id);
    this.#startedAt.delete(id);
  }
}

export const toasts = new ToastStore();
