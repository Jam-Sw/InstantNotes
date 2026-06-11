import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { debounce } from "./debounce";

describe("debounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("fires once with the last arguments after the delay", () => {
    const calls: string[] = [];
    const d = debounce((v: string) => calls.push(v), 100);
    d("a");
    d("b");
    d("c");
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(calls).toEqual(["c"]);
  });

  test("flush runs the pending call immediately", () => {
    const calls: string[] = [];
    const d = debounce((v: string) => calls.push(v), 100);
    d("draft");
    d.flush();
    expect(calls).toEqual(["draft"]);
    vi.advanceTimersByTime(200);
    expect(calls).toEqual(["draft"]); // no double-fire
  });

  test("flush with nothing pending does nothing", () => {
    const calls: string[] = [];
    const d = debounce((v: string) => calls.push(v), 100);
    d.flush();
    expect(calls).toEqual([]);
  });

  test("cancel drops the pending call", () => {
    const calls: string[] = [];
    const d = debounce((v: string) => calls.push(v), 100);
    d("doomed");
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(calls).toEqual([]);
  });
});
