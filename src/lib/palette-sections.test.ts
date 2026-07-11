import { describe, expect, it } from "vitest";
import {
  clampActive,
  flattenRows,
  moveActive,
  rowDomId,
  visibleSections,
  type PaletteSection,
} from "./palette-sections";

interface Row {
  id: string;
}

const row = (id: string): Row => ({ id });

describe("visibleSections", () => {
  it("drops sections with no rows", () => {
    const sections: PaletteSection<Row>[] = [
      { label: "Commands", rows: [row("a")] },
      { label: "Notes", rows: [] },
    ];
    expect(visibleSections(sections).map((s) => s.label)).toEqual(["Commands"]);
  });

  it("keeps original order among the sections that remain", () => {
    const sections: PaletteSection<Row>[] = [
      { label: "First", rows: [] },
      { label: "Second", rows: [row("a")] },
      { label: "Third", rows: [row("b")] },
    ];
    expect(visibleSections(sections).map((s) => s.label)).toEqual(["Second", "Third"]);
  });

  it("returns an empty array when every section is empty", () => {
    const sections: PaletteSection<Row>[] = [
      { label: "Commands", rows: [] },
      { label: "Notes", rows: [] },
    ];
    expect(visibleSections(sections)).toEqual([]);
  });
});

describe("flattenRows", () => {
  it("concatenates rows in section order", () => {
    const sections: PaletteSection<Row>[] = [
      { label: "Commands", rows: [row("a"), row("b")] },
      { label: "Notes", rows: [row("c")] },
    ];
    expect(flattenRows(sections).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("skips headers entirely: no placeholder rows for empty sections", () => {
    const sections: PaletteSection<Row>[] = [
      { label: "Commands", rows: [row("a")] },
      { label: "Notes", rows: [] },
      { label: "Recent", rows: [row("b")] },
    ];
    expect(flattenRows(sections).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("is stable: flattening twice yields the same order", () => {
    const sections: PaletteSection<Row>[] = [
      { label: "Commands", rows: [row("a"), row("b")] },
      { label: "Notes", rows: [row("c"), row("d")] },
    ];
    expect(flattenRows(sections)).toEqual(flattenRows(sections));
  });
});

describe("moveActive", () => {
  it("moves forward and backward within range", () => {
    expect(moveActive(0, 1, 5)).toBe(1);
    expect(moveActive(2, -1, 5)).toBe(1);
  });

  it("wraps from the last row to the first on ArrowDown", () => {
    expect(moveActive(4, 1, 5)).toBe(0);
  });

  it("wraps from the first row to the last on ArrowUp", () => {
    expect(moveActive(0, -1, 5)).toBe(4);
  });

  it("returns 0 for an empty list", () => {
    expect(moveActive(0, 1, 0)).toBe(0);
    expect(moveActive(0, -1, 0)).toBe(0);
  });
});

describe("clampActive", () => {
  it("leaves an in-range index untouched", () => {
    expect(clampActive(2, 5)).toBe(2);
  });

  it("pulls the index back to the new last row when the list shrinks", () => {
    expect(clampActive(4, 2)).toBe(1);
  });

  it("never goes negative", () => {
    expect(clampActive(-3, 5)).toBe(0);
  });

  it("returns 0 for an empty list", () => {
    expect(clampActive(3, 0)).toBe(0);
  });
});

describe("rowDomId", () => {
  it("prefixes the row id so it cannot collide with unrelated DOM ids", () => {
    expect(rowDomId("note.new")).toBe("palette-row-note.new");
    expect(rowDomId("note:abc-123")).toBe("palette-row-note:abc-123");
  });
});
