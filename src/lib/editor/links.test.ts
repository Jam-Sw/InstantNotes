import { describe, it, expect, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import {
  droppedLink,
  linkAt,
  normalizeHref,
  linkMarkClass,
  modKeyCursor,
  DEFAULT_LINK_PREFS,
} from "./links";

function stateOf(doc: string): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage })],
  });
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

describe("modKeyCursor", () => {
  function mountView(): EditorView {
    return new EditorView({
      state: EditorState.create({ extensions: [modKeyCursor()] }),
      parent: document.body,
    });
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("adds cm-mod-held while Cmd or Ctrl is held, and removes it on release", () => {
    const view = mountView();
    expect(view.dom.classList.contains("cm-mod-held")).toBe(false);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta", metaKey: true }));
    expect(view.dom.classList.contains("cm-mod-held")).toBe(true);

    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta", metaKey: false }));
    expect(view.dom.classList.contains("cm-mod-held")).toBe(false);
    view.destroy();
  });

  it("also responds to Ctrl, so the feedback is correct on every platform", () => {
    const view = mountView();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }));
    expect(view.dom.classList.contains("cm-mod-held")).toBe(true);
    view.destroy();
  });

  it("clears the held state on window blur, so it can't get stuck on", () => {
    const view = mountView();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta", metaKey: true }));
    expect(view.dom.classList.contains("cm-mod-held")).toBe(true);

    window.dispatchEvent(new FocusEvent("blur"));
    expect(view.dom.classList.contains("cm-mod-held")).toBe(false);
    view.destroy();
  });

  it("removes the class on destroy, so a stale modifier state can't leak into the next note", () => {
    const view = mountView();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta", metaKey: true }));
    view.destroy();
    expect(view.dom.classList.contains("cm-mod-held")).toBe(false);
  });
});

describe("droppedLink", () => {
  const drag = (types: Record<string, string>) => ({ getData: (t: string) => types[t] ?? "" });
  const video = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

  it("keeps the title a browser drags along with a link", () => {
    expect(droppedLink(drag({ "text/x-moz-url": `${video}\nNever Gonna Give You Up - YouTube` }))).toBe(
      `[Never Gonna Give You Up - YouTube](${video})`,
    );
    expect(droppedLink(drag({ "text/html": `<a href="${video}"> Rick [Official]\n Video </a>`, "text/uri-list": video }))).toBe(
      `[Rick \\[Official\\] Video](${video})`,
    );
  });

  it("leaves a drop with no title, or no web link, to the editor", () => {
    expect(droppedLink(drag({ "text/uri-list": video, "text/plain": video }))).toBeNull();
    expect(droppedLink(drag({ "text/x-moz-url": `${video}\n${video}` }))).toBeNull();
    expect(droppedLink(drag({ "text/html": '<a href="javascript:alert(1)">Click</a>', "text/uri-list": "javascript:alert(1)" }))).toBeNull();
  });

  it("leaves a dropped paragraph that holds a link to the editor", () => {
    const html = `<p>Watch <a href="${video}">this</a> later</p>`;
    expect(droppedLink(drag({ "text/html": html, "text/plain": "Watch this later" }))).toBeNull();
  });
});
