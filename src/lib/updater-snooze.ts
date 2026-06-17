// Pure "remind me later" cadence math for the update dialog, kept out of the
// rune store so it stays unit-testable in the plain-node vitest environment.

/** The cadences offered by the update dialog's "Later ▾" menu. */
export type SnoozeKind = "tomorrow" | "week" | "launch";

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a reminder snoozed at `now` should next surface. `"launch"` has no fixed
 * deadline - it suppresses for the session only - so it returns null.
 */
export function snoozeDeadline(kind: SnoozeKind, now: number): number | null {
  switch (kind) {
    case "tomorrow":
      return now + DAY_MS;
    case "week":
      return now + 7 * DAY_MS;
    case "launch":
      return null;
  }
}
