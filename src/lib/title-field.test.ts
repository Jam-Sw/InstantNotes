import { describe, expect, it } from "vitest";
import { autosize, singleLine } from "./title-field";

describe("singleLine", () => {
  it("joins pasted lines with one space", () => {
    expect(singleLine("Quarterly planning\nnotes")).toBe("Quarterly planning notes");
    expect(singleLine("a  \r\n\r\n  b")).toBe("a b");
  });

  it("leaves a title without breaks as it is", () => {
    expect(singleLine("  spaced   title ")).toBe("  spaced   title ");
  });
});

describe("autosize", () => {
  function textarea(scrollHeight: number): HTMLTextAreaElement {
    const el = document.createElement("textarea");
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => scrollHeight });
    return el;
  }

  it("sets the height to the wrapped text's height", () => {
    const el = textarea(84);
    const action = autosize(el, "a long title");
    expect(el.style.height).toBe("84px");
    action.destroy();
  });

  it("re-measures when its parameter changes and on input", () => {
    let height = 42;
    const el = document.createElement("textarea");
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => height });
    const action = autosize(el, "short");
    expect(el.style.height).toBe("42px");

    height = 84;
    action.update();
    expect(el.style.height).toBe("84px");

    height = 126;
    el.dispatchEvent(new Event("input"));
    expect(el.style.height).toBe("126px");
    action.destroy();
  });
});
