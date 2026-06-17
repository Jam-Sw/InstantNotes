import { describe, it, expect } from "vitest";
import { snoozeDeadline, DAY_MS } from "./updater-snooze";

describe("snoozeDeadline", () => {
  const now = 1_000_000;

  it("pushes 'tomorrow' out one day", () => {
    expect(snoozeDeadline("tomorrow", now)).toBe(now + DAY_MS);
  });

  it("pushes 'week' out seven days", () => {
    expect(snoozeDeadline("week", now)).toBe(now + 7 * DAY_MS);
  });

  it("returns null for 'launch' - session-only, no persisted deadline", () => {
    expect(snoozeDeadline("launch", now)).toBeNull();
  });
});
