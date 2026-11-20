import { describe, expect, it } from "vitest";
import { singleLine } from "./title-field";

describe("singleLine", () => {
  it("joins pasted lines with one space", () => {
    expect(singleLine("Quarterly planning\nnotes")).toBe("Quarterly planning notes");
    expect(singleLine("a  \r\n\r\n  b")).toBe("a b");
  });

  it("leaves a title without breaks as it is", () => {
    expect(singleLine("  spaced   title ")).toBe("  spaced   title ");
  });
});
