import { describe, it, expect } from "vitest";
import { parseHighlightSegments, HIGHLIGHT_START, HIGHLIGHT_END } from "./highlight";

function mark(text: string): string {
  return `${HIGHLIGHT_START}${text}${HIGHLIGHT_END}`;
}

describe("parseHighlightSegments", () => {
  it("marks a single hit inside surrounding plain text", () => {
    const segments = parseHighlightSegments(`find your ${mark("passport")} today`);
    expect(segments).toEqual([
      { text: "find your ", hit: false },
      { text: "passport", hit: true },
      { text: " today", hit: false },
    ]);
  });

  it("marks multiple separated hits", () => {
    const segments = parseHighlightSegments(`${mark("passport")} and ${mark("tickets")}`);
    expect(segments).toEqual([
      { text: "passport", hit: true },
      { text: " and ", hit: false },
      { text: "tickets", hit: true },
    ]);
  });

  it("marks adjacent hits with no gap between them", () => {
    const segments = parseHighlightSegments(`${mark("pass")}${mark("port")}`);
    expect(segments).toEqual([
      { text: "pass", hit: true },
      { text: "port", hit: true },
    ]);
  });

  it("degrades to stripped plain text when a start sentinel is never closed", () => {
    const segments = parseHighlightSegments(`before ${HIGHLIGHT_START}unterminated`);
    expect(segments).toEqual([{ text: "before unterminated", hit: false }]);
  });

  it("degrades to stripped plain text on a stray end sentinel with no matching start", () => {
    const segments = parseHighlightSegments(`before ${HIGHLIGHT_END} after`);
    expect(segments).toEqual([{ text: "before  after", hit: false }]);
  });

  it("degrades to stripped plain text on nested sentinels", () => {
    const segments = parseHighlightSegments(
      `${HIGHLIGHT_START}outer ${HIGHLIGHT_START}inner${HIGHLIGHT_END} outer${HIGHLIGHT_END}`,
    );
    expect(segments).toEqual([{ text: "outer inner outer", hit: false }]);
  });

  it("returns no segments for an empty string", () => {
    expect(parseHighlightSegments("")).toEqual([]);
  });

  it("returns a single unhighlighted segment for a string with no markers", () => {
    expect(parseHighlightSegments("plain excerpt, no matches")).toEqual([
      { text: "plain excerpt, no matches", hit: false },
    ]);
  });

  it("returns no segments for a marker-only string with nothing enclosed", () => {
    expect(parseHighlightSegments(mark(""))).toEqual([]);
  });

  it("never crashes regardless of sentinel arrangement", () => {
    const inputs = [
      HIGHLIGHT_START,
      HIGHLIGHT_END,
      HIGHLIGHT_START + HIGHLIGHT_START,
      HIGHLIGHT_END + HIGHLIGHT_END,
      HIGHLIGHT_END + HIGHLIGHT_START,
      HIGHLIGHT_START + "a" + HIGHLIGHT_START + "b" + HIGHLIGHT_END,
    ];
    for (const input of inputs) {
      expect(() => parseHighlightSegments(input)).not.toThrow();
    }
  });
});
