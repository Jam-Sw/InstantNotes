// Pure section-merging and keyboard-navigation math for the command palette.
// The palette groups its rows into labelled sections (Commands, Notes, Recent…)
// but keyboard/mouse selection moves through one flat, gap-free list. No store
// or Tauri imports here, so the index math is unit-testable without a DOM.

/** Minimal shape a palette row must have: a stable, unique id for DOM/aria
 *  wiring. The palette itself decides what a row actually renders. */
export interface PaletteRow {
  id: string;
}

export interface PaletteSection<Row extends PaletteRow> {
  // Empty string renders no header (e.g. the top-level command list keeps its
  // current headerless look). Presentational only, never part of navigation.
  label: string;
  rows: Row[];
}

/** Sections with at least one row, original order preserved. An empty section
 *  contributes neither a header nor any navigable rows. */
export function visibleSections<Row extends PaletteRow>(
  sections: PaletteSection<Row>[],
): PaletteSection<Row>[] {
  return sections.filter((s) => s.rows.length > 0);
}

/** All rows across sections, in section order. Call after visibleSections so
 *  flat indices line up with what is actually rendered. */
export function flattenRows<Row extends PaletteRow>(
  sections: PaletteSection<Row>[],
): Row[] {
  return sections.flatMap((s) => s.rows);
}

/** Move the active flat index by `delta`, wrapping at both ends. 0 for an
 *  empty list (there is nothing to select, but the index must stay valid). */
export function moveActive(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return ((current + delta) % length + length) % length;
}

/** Keep the active index in range as the row count shrinks, e.g. while a
 *  query narrows the results. Never adjusts a still-valid index. */
export function clampActive(current: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(current, 0), length - 1);
}

/** DOM id for a row, shared by the row element (id) and the input's
 *  aria-activedescendant so assistive tech can track the active option. */
export function rowDomId(rowId: string): string {
  return `palette-row-${rowId}`;
}
