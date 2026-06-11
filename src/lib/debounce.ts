/** Debounce with flush (for blur/window-hide saves) and cancel. */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): { (...args: A): void; flush(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: A | undefined;

  const debounced = (...args: A) => {
    pending = args;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const args = pending!;
      pending = undefined;
      fn(...args);
    }, ms);
  };

  debounced.flush = () => {
    if (pending !== undefined) {
      clearTimeout(timer);
      timer = undefined;
      const args = pending;
      pending = undefined;
      fn(...args);
    }
  };

  debounced.cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };

  return debounced;
}
