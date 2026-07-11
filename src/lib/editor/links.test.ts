import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { linkAt, normalizeHref, linkMarkClass, DEFAULT_LINK_PREFS } from "./links";

// Same language setup as the editor (GFM base) so autolinks and bare URLs
// parse the way they do in the app.
function stateOf(doc: string): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage })],
  });
  // linkAt reads the current tree; force a full parse up front since there
  // is no view driving incremental parsing in tests.
  ensureSyntaxTree(state, doc.length, 5000);
  return state;
}

describe("normalizeHref", () => {
  it("passes http and https through", () => {
    expect(normalizeHref("https://example.com")).toBe("https://example.com");
    expect(normalizeHref("http://example.com")).toBe("http://example.com");
  });

  it("passes mailto through", () => {
    expect(normalizeHref("mailto:a@b.com")).toBe("mailto:a@b.com");
  });

  it("prepends https to bare www URLs", () => {
    expect(normalizeHref("www.example.com")).toBe("https://www.example.com");
  });

  it("rejects unsafe or unknown schemes", () => {
    expect(normalizeHref("file:///etc/passwd")).toBeNull();
    expect(normalizeHref("javascript:alert(1)")).toBeNull();
    expect(normalizeHref("not a url")).toBeNull();
  });
});

describe("linkMarkClass", () => {
  it("defaults: underlined, clickable in preview, no indicator", () => {
    expect(linkMarkClass(DEFAULT_LINK_PREFS, true)).toBe(
      "cm-link-target cm-link-ul-always cm-link-clickable",
    );
  });

  it("is never clickable outside preview mode", () => {
    expect(linkMarkClass(DEFAULT_LINK_PREFS, false)).toBe(
      "cm-link-target cm-link-ul-always",
    );
  });

  it("drops the pointer when opening needs the modifier", () => {
    expect(
      linkMarkClass({ ...DEFAULT_LINK_PREFS, openWith: "modclick" }, true),
    ).not.toContain("cm-link-clickable");
  });

  it("carries underline and indicator choices", () => {
    expect(
      linkMarkClass(
        { ...DEFAULT_LINK_PREFS, underline: "hover", externalIndicator: true },
        false,
      ),
    ).toBe("cm-link-target cm-link-ul-hover cm-link-ext");
  });
});

describe("linkAt", () => {
  it("finds the URL from inside [text](url) link text", () => {
    const doc = "see [docs](https://example.com/docs) here";
    expect(linkAt(stateOf(doc), 6)).toBe("https://example.com/docs");
  });

  it("finds the URL from inside the url part of a link", () => {
    const doc = "see [docs](https://example.com/docs) here";
    expect(linkAt(stateOf(doc), 15)).toBe("https://example.com/docs");
  });

  it("finds an autolink in angle brackets", () => {
    const doc = "go <https://example.com> now";
    expect(linkAt(stateOf(doc), 8)).toBe("https://example.com");
  });

  it("finds a bare GFM autolink URL", () => {
    const doc = "visit https://example.com today";
    expect(linkAt(stateOf(doc), 10)).toBe("https://example.com");
  });

  it("normalizes a bare www autolink", () => {
    const doc = "visit www.example.com today";
    expect(linkAt(stateOf(doc), 10)).toBe("https://www.example.com");
  });

  it("returns null in plain text", () => {
    expect(linkAt(stateOf("plain words only"), 3)).toBeNull();
  });

  it("returns null just past the end of a link (trailing-space click)", () => {
    const doc = "[docs](https://example.com)";
    expect(linkAt(stateOf(doc), doc.length)).toBeNull();
  });

  it("returns null for links with unsafe schemes", () => {
    const doc = "[bad](javascript:alert(1))";
    expect(linkAt(stateOf(doc), 2)).toBeNull();
  });
});
