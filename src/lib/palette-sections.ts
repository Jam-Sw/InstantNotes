export interface PaletteRow {
  id: string;
}

export interface PaletteSection<Row extends PaletteRow> {
  label: string;
  rows: Row[];
}

export function visibleSections<Row extends PaletteRow>(
  sections: PaletteSection<Row>[],
): PaletteSection<Row>[] {
  return sections.filter((s) => s.rows.length > 0);
}

export function flattenRows<Row extends PaletteRow>(
  sections: PaletteSection<Row>[],
): Row[] {
  return sections.flatMap((s) => s.rows);
}

export function moveActive(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return ((current + delta) % length + length) % length;
}

export function clampActive(current: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(current, 0), length - 1);
}

export function rowDomId(rowId: string): string {
  return `palette-row-${rowId}`;
}
