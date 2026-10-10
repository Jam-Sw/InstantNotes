import type { RevealMode } from "./types";

export interface SelRange {
  readonly from: number;
  readonly to: number;
}

function touches(
  from: number,
  to: number,
  selFrom: number,
  selTo: number,
): boolean {
  return selFrom <= to && selTo >= from;
}

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
