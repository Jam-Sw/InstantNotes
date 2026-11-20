import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { pluginConfig, pluginField, scanPlugins, typingField } from "$lib/editor/plugins";
import { NO_CONTEXT, type Context, type Host, type Plugin, type PluginConfig } from "$lib/plugin/types";
import assist, { endpoint } from "./index";
import calc from "../calc/index";

const NO_HOST = NO_CONTEXT.host;

const SETTINGS = "Settings > Editor > More";
const ON = { hints: "on", repeats: "on", wordy: "on", filler: "on" };
const calcOff: Context = {
  off: [{ label: "Calc", fences: ["calc", "m"] }],
  settings: SETTINGS,
  host: NO_HOST,
};

function stateOf(doc: string, config: PluginConfig): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage }), pluginField, pluginConfig.of(config)],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  return state;
}

const scan = (doc: string, config: PluginConfig) => scanPlugins(stateOf(doc, config)).items;

describe("assist hints", () => {
  it("labels a fence whose plugin is off, on the opening line", () => {
    const doc = "```calc\n1 + 1\n```\n\n```js\nlet x\n```";
    const items = scan(doc, {
      plugins: [assist],
      prefs: { assist: ON },
      context: calcOff,
    });
    expect(items.map((i) => [i.kind, i.views[0]?.text, i.views[0]?.hint])).toEqual([
      ["line", `Calc is off · ${SETTINGS}`, true],
    ]);
    expect(doc.slice(items[0].from, items[0].to)).toBe("```calc");
  });

  it("stays out of the way when the plugin is on or hints are off", () => {
    const doc = "```calc\n1 + 1\n```";
    const both = scan(doc, {
      plugins: [assist, calc],
      prefs: { assist: ON },
      context: { off: [], settings: SETTINGS, host: NO_HOST },
    });
    expect(both.map((i) => [i.plugin.id, i.views[0].text])).toEqual([["calc", "2"]]);
    expect(
      scan(doc, {
        plugins: [assist],
        prefs: { assist: { ...ON, hints: "off" } },
        context: calcOff,
      }),
    ).toEqual([]);
  });
});

describe("assist style marks", () => {
  it("marks repeated, wordy and filler words with a fix and the exact range", () => {
    const doc = "We went to the the shop in order to buy a really good pen.";
    const items = scan(doc, { plugins: [assist], prefs: { assist: ON } });
    expect(items.map((i) => [doc.slice(i.from, i.to), i.mark?.message, i.mark?.fixes])).toEqual([
      ["the the", "Repeated word", ["the"]],
      ["in order to", "Wordy", ["to"]],
      ["really ", "Filler word", [""]],
    ]);
    expect(items.every((i) => i.kind === "mark")).toBe(true);
  });

  it("keeps the capital, skips allowed repeats and honours each switch", () => {
    const doc = "Prior to that that day he had had none.";
    const items = scan(doc, { plugins: [assist], prefs: { assist: ON } });
    expect(items.map((i) => i.mark?.fixes)).toEqual([["Before"]]);
    expect(
      scan("the the", {
        plugins: [assist],
        prefs: { assist: { ...ON, repeats: "off" } },
      }),
    ).toEqual([]);
  });

  it("ignores inline code, link targets and fenced code", () => {
    const doc = "Run `very very` or see [docs](http://x.io/in order to).\n\n```js\nvery very\n```";
    expect(scan(doc, { plugins: [assist], prefs: { assist: ON } })).toEqual([]);
  });

  it("never joins words across inline code, and reads accented words whole", () => {
    const marked = (doc: string) =>
      scan(doc, { plugins: [assist], prefs: { assist: ON } }).map((i) => doc.slice(i.from, i.to));
    expect(marked("use `npm install` use it")).toEqual([]);
    expect(marked("see ![a](b.png) see it")).toEqual([]);
    expect(marked("un café café noir")).toEqual(["café café"]);
    expect(marked("ban bané")).toEqual([]);
    expect(marked("it's it's")).toEqual(["it's it's"]);
  });

  it("offers to remove a filler word only where the sentence survives it", () => {
    const doc = "Clearly it is really, quite good.";
    const items = scan(doc, { plugins: [assist], prefs: { assist: ON } });
    expect(items.map((i) => [doc.slice(i.from, i.to), i.mark?.fixes])).toEqual([
      ["Clearly ", []],
      ["really", []],
      ["quite ", [""]],
    ]);
  });

  it("sits alongside calc results in one sorted table", () => {
    const doc = "It is `=1+1` and and so on.\n\n```calc\n2 + 2\n```";
    const items = scan(doc, { plugins: [assist, calc], prefs: { assist: ON } });
    expect(items.map((i) => [i.plugin.id, i.kind])).toEqual([
      ["calc", "inline"],
      ["assist", "mark"],
      ["calc", "line"],
    ]);
    expect(items.map((i) => i.from)).toEqual([...items.map((i) => i.from)].sort((a, b) => a - b));
  });
});

describe("isolated plugins", () => {
  it("re-run only the regions whose text changed, and leave other plugins untouched", () => {
    const seen: string[][] = [];
    const spy: Plugin = {
      ...assist,
      run: (regions, prefs, context) => {
        seen.push(regions.map((r) => (r.kind === "prose" ? r.text : r.kind)));
        return assist.run(regions, prefs, context);
      },
    };
    const calcRun = vi.fn(calc.run);
    const counted: Plugin = { ...calc, run: calcRun };
    const doc = "one one\n\ntwo\n\n```calc\n1 + 1\n```";
    let state = stateOf(doc, {
      plugins: [spy, counted],
      prefs: { assist: ON },
    });
    expect(seen).toEqual([["one one", "two"]]);
    expect(calcRun).toHaveBeenCalledTimes(1);
    const at = doc.indexOf("two") + 3;
    state = state.update({ changes: { from: at, insert: " two" } }).state;
    ensureSyntaxTree(state, state.doc.length, 5000);
    expect(seen[1]).toEqual(["two two"]);
    expect(calcRun).toHaveBeenCalledTimes(1);
    expect(state.field(pluginField).items.map((i) => [i.plugin.id, state.doc.sliceString(i.from, i.to)])).toEqual([
      ["assist", "one one"],
      ["assist", "two two"],
      ["calc", "1 + 1"],
    ]);
  });
});

describe("assist in a live editor", () => {
  it("underlines a mark and draws the hint pill without touching the text", async () => {
    const { EditorView } = await import("@codemirror/view");
    const { previewKernel } = await import("$lib/editor/kernel");
    const { PluginSpec } = await import("$lib/editor/constructs/plugin");
    const { extension } = previewKernel({
      specs: [],
      textSpecs: [new PluginSpec()],
      rescanOn: [pluginField],
    });
    const doc = "It was the the end.\n\n```calc\n1 + 1\n```";
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          pluginField,
          pluginConfig.of({
            plugins: [assist],
            prefs: { assist: ON },
            context: calcOff,
          }),
          extension,
          markdown({ base: markdownLanguage }),
        ],
      }),
      parent: document.body,
    });
    try {
      const marks = Array.from(view.contentDOM.querySelectorAll(".cm-plugin-mark-style")).map((e) => e.textContent);
      expect(marks).toEqual(["the the"]);
      expect(view.contentDOM.querySelector(".cm-plugin-hint")?.textContent).toBe(`Calc is off · ${SETTINGS}`);
      expect(view.state.doc.toString()).toBe(doc);
    } finally {
      view.destroy();
    }
  });
});

const AFF = "SET UTF-8\nTRY esianrtolcdugmphbyfvkwz\n";
const DIC = "6\nhello\nworld\nnotebook\nnotes\nwrite\nplanning\n";

function fakeHost(over: Partial<Host> = {}): Host & { refreshed: number; said: string[] } {
  const host = {
    refreshed: 0,
    said: [] as string[],
    readText: async (path: string) => (path.endsWith(".aff") ? AFF : DIC),
    post: async () => "{}",
    notify(message: string) {
      host.said.push(message);
    },
    refresh() {
      host.refreshed++;
    },
    ...over,
  };
  return host;
}

const settle = async (host: { refreshed: number }) => {
  for (let i = 0; i < 200 && host.refreshed === 0; i++) await new Promise((r) => setTimeout(r, 5));
};

describe("assist spelling", () => {
  it("loads the picked dictionary once, then marks unknown words and suggests on demand", async () => {
    const host = fakeHost();
    const prefs = { assist: { ...ON, dictionary: "/dict/a.dic", ignore: "" } };
    const context: Context = { off: [], settings: SETTINGS, host };
    const doc = "hello wrold from my Notebook, see #wrold and NASA";
    expect(scan(doc, { plugins: [assist], prefs, context })).toEqual([]);
    await settle(host);
    expect(host.refreshed).toBe(1);
    const items = scan(doc, { plugins: [assist], prefs, context });
    expect(items.map((i) => [doc.slice(i.from, i.to), i.mark?.kind])).toEqual([
      ["wrold", "spelling"],
      ["from", "spelling"],
      ["my", "spelling"],
      ["see", "spelling"],
      ["and", "spelling"],
    ]);
    const fixes = items[0].mark?.fixes;
    expect(typeof fixes).toBe("function");
    expect((fixes as () => readonly string[])()).toContain("world");
    const skipping = {
      assist: { ...prefs.assist, ignore: "from, my see and" },
    };
    expect(scan(doc, { plugins: [assist], prefs: skipping, context }).map((i) => doc.slice(i.from, i.to))).toEqual([
      "wrold",
    ]);
  });

  it("leaves words that touch a digit alone", async () => {
    const host = fakeHost();
    const prefs = { assist: { ...ON, dictionary: "/dict/c.dic", ignore: "" } };
    const context: Context = { off: [], settings: SETTINGS, host };
    const doc = "hello 4th 10px 0xFF mp3 wrold";
    scan(doc, { plugins: [assist], prefs, context });
    await settle(host);
    expect(scan(doc, { plugins: [assist], prefs, context }).map((i) => doc.slice(i.from, i.to))).toEqual(["wrold"]);
  });

  it("reads the sibling file in the case the picked one uses", async () => {
    const read: string[] = [];
    const host = fakeHost({
      readText: async (path: string) => {
        read.push(path);
        return path.endsWith(".AFF") ? AFF : DIC;
      },
    });
    const prefs = { assist: { ...ON, dictionary: "/dict/EN.DIC" } };
    scan("wrold", { plugins: [assist], prefs, context: { off: [], settings: SETTINGS, host } });
    await settle(host);
    expect(read.sort()).toEqual(["/dict/EN.AFF", "/dict/EN.DIC"]);
  });

  it("holds the underline back while the word is being typed, then shows it", async () => {
    const { EditorView } = await import("@codemirror/view");
    const { previewKernel } = await import("$lib/editor/kernel");
    const { PluginSpec } = await import("$lib/editor/constructs/plugin");
    const { extension } = previewKernel({
      specs: [],
      textSpecs: [new PluginSpec()],
      rescanOn: [pluginField, typingField],
    });
    const host = fakeHost();
    const view = new EditorView({
      state: EditorState.create({
        doc: "wrol hello",
        selection: { anchor: 4 },
        extensions: [
          pluginField,
          typingField,
          pluginConfig.of({
            plugins: [assist],
            prefs: { assist: { ...ON, dictionary: "/dict/a.dic", ignore: "" } },
            context: { off: [], settings: SETTINGS, host },
          }),
          extension,
          markdown({ base: markdownLanguage }),
        ],
      }),
      parent: document.body,
    });
    const marks = () =>
      Array.from(view.contentDOM.querySelectorAll(".cm-plugin-mark-spelling")).map((e) => e.textContent);
    try {
      view.dispatch({ changes: { from: 4, insert: "d" }, selection: { anchor: 5 }, userEvent: "input.type" });
      expect(marks()).toEqual([]);
      view.dispatch({ selection: { anchor: 8 } });
      expect(marks()).toEqual(["wrold"]);
    } finally {
      view.destroy();
    }
  });

  it("tries a dictionary that could not be read again later, without a second notice", async () => {
    vi.useFakeTimers();
    let there = false;
    const host = fakeHost({
      readText: async (path: string) => {
        if (!there) throw new Error("gone");
        return path.endsWith(".aff") ? AFF : DIC;
      },
    });
    const prefs = { assist: { ...ON, dictionary: "/dict/late.dic", ignore: "" } };
    const context: Context = { off: [], settings: SETTINGS, host };
    try {
      scan("wrold", { plugins: [assist], prefs, context });
      await vi.advanceTimersByTimeAsync(6000);
      scan("wrold", { plugins: [assist], prefs, context });
      await vi.advanceTimersByTimeAsync(6000);
    } finally {
      vi.useRealTimers();
    }
    expect(host.said).toEqual(["Assist: dictionary not read"]);
    there = true;
    scan("wrold", { plugins: [assist], prefs, context });
    await settle(host);
    expect(scan("wrold", { plugins: [assist], prefs, context })).toHaveLength(1);
  });

  it("says so once when the dictionary cannot be read and marks nothing", async () => {
    const host = fakeHost({
      readText: async () => Promise.reject(new Error("gone")),
    });
    const prefs = { assist: { ...ON, dictionary: "/dict/missing.dic" } };
    const context: Context = { off: [], settings: SETTINGS, host };
    scan("wrold", { plugins: [assist], prefs, context });
    for (let i = 0; i < 200 && host.said.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    scan("wrold", { plugins: [assist], prefs, context });
    expect(host.said).toEqual(["Assist: dictionary not read"]);
    expect(scan("wrold", { plugins: [assist], prefs, context })).toEqual([]);
  });
});

describe("assist autocomplete", () => {
  const signal = new AbortController().signal;
  const ask = (before: string, after: string, prefs: Record<string, string>, host: Host = NO_HOST) =>
    assist.complete?.({ before, after }, prefs, { off: [], settings: SETTINGS, host }, signal);

  it("completes a word from the note, most used first, and needs three letters", () => {
    const prefs = { complete: "words" };
    expect(ask("planning the plantation. A pla", " and planning again", prefs)).toBe("nning");
    expect(ask("planning pl", "", prefs)).toBeNull();
    expect(ask("planning 'pla", "", prefs)).toBe("nning");
    expect(ask("nothing here matches xyz", "", prefs)).toBeNull();
    expect(ask("planning pla", "", { complete: "off" })).toBeNull();
  });

  it("falls back to the dictionary, shortest match first", async () => {
    const host = fakeHost();
    const prefs = { complete: "words", dictionary: "/dict/b.dic" };
    expect(ask("I will not", "", prefs, host)).toBeNull();
    await settle(host);
    expect(ask("I will not", "", prefs, host)).toBe("es");
  });

  it("builds the completions address from what the user typed", () => {
    expect(endpoint("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080/v1/completions");
    expect(endpoint("http://127.0.0.1:11434/v1/")).toBe("http://127.0.0.1:11434/v1/completions");
    expect(endpoint("https://box.lan/v1/completions")).toBe("https://box.lan/v1/completions");
    expect(endpoint("127.0.0.1:8080")).toBeNull();
    expect(endpoint("")).toBeNull();
  });

  it("asks the model with the text before the cursor and returns its first choice", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const host = fakeHost({
      post: async (url, body) => {
        calls.push({ url, body: JSON.parse(body) });
        return JSON.stringify({ choices: [{ text: " the garden.  " }] });
      },
    });
    const prefs = {
      complete: "model",
      address: "http://127.0.0.1:8080",
      model: "local",
    };
    expect(await ask("We walked into", "", prefs, host)).toBe(" the garden.");
    expect(calls).toEqual([
      {
        url: "http://127.0.0.1:8080/v1/completions",
        body: {
          model: "local",
          prompt: "We walked into",
          max_tokens: 48,
          temperature: 0.2,
          stop: ["\n"],
          stream: false,
        },
      },
    ]);
    expect(await ask("We walked into", "", { complete: "model", address: "" }, host)).toBeNull();
  });

  it("reports a model that does not answer once, not on every keystroke", async () => {
    const host = fakeHost({
      post: async () => Promise.reject(new Error("refused")),
    });
    const prefs = { complete: "model", address: "http://127.0.0.1:9" };
    expect(await ask("one", "", prefs, host)).toBeNull();
    expect(await ask("one two", "", prefs, host)).toBeNull();
    expect(host.said).toEqual(["Assist: no answer from the model"]);
  });
});
