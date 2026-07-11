// The one reveal predicate. No other module may compare a selection to a
// construct span; if a module needs the comparison, it imports this. The
// previous architecture had three private copies of this logic and every
// "typing lands in invisible markup" bug was two of them disagreeing.

import type { RevealMode } from "./types";

/** A selection range in document offsets, anchor/head order normalized. */
export interface SelRange {
  readonly from: number;
  readonly to: number;
}

/**
 * True when [selFrom, selTo] touches [from, to], boundary inclusive. A caret
 * immediately after **bold** still counts, because typing there is exactly
 * when the eye needs the markup on screen.
 */
export function touches(
  from: number,
  to: number,
  selFrom: number,
  selTo: number,
): boolean {
  return selFrom <= to && selTo >= from;
}

/**
 * Whether a construct is revealed (shows raw syntax) for the given
 * selection ranges. "never" constructs stay folded; "span" constructs open
 * when any selection range touches them, so multi-cursor edits are as
 * truthful as single-caret ones.
 */
export function revealed(
  reveal: RevealMode,
  from: number,
  to: number,
  sel: readonly SelRange[],
): boolean {
  if (reveal !== "span") return false;
  for (const r of sel) {
    if (touches(from, to, r.from, r.to)) return true;
  }
  return false;
}
