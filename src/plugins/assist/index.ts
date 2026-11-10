import {
  OPENING,
  type CompleteRequest,
  type Context,
  type Mark,
  type Plugin,
  type PrefSpec,
  type Prefs,
  type Region,
  type Result,
} from "$lib/plugin/types";

interface Rule {
  readonly pref: string;
  readonly find: RegExp;
  readonly message: string;
  fixes(match: RegExpExecArray): readonly string[] | null;
}

const WORDY: Readonly<Record<string, string>> = {
  "in order to": "to",
  "due to the fact that": "because",
  "in spite of the fact that": "although",
  "at this point in time": "now",
  "at the present time": "now",
  "in the event that": "if",
  "for the purpose of": "to",
  "with regard to": "about",
  "with reference to": "about",
  "a large number of": "many",
  "a majority of": "most",
  "has the ability to": "can",
  "is able to": "can",
  "in close proximity to": "near",
  "prior to": "before",
  "subsequent to": "after",
  "in the near future": "soon",
  "on a daily basis": "daily",
  "make a decision": "decide",
  "take into consideration": "consider",
};

const FILLER = ["very", "really", "quite", "basically", "actually", "literally", "simply", "obviously", "clearly"];

const KEPT_REPEATS = new Set(["had", "that"]);

const likeCase = (source: string, text: string): string =>
  source.charCodeAt(0) >= 65 && source.charCodeAt(0) <= 90 ? text.charAt(0).toUpperCase() + text.slice(1) : text;

const RULES: readonly Rule[] = [
  {
    pref: "repeats",
    find: /(?<![\p{L}'])([\p{L}']+)[ \t]+\1(?![\p{L}'])/giu,
    message: "Repeated word",
    fixes: (m) => (KEPT_REPEATS.has(m[1].toLowerCase()) ? null : [m[1]]),
  },
  {
    pref: "wordy",
    find: new RegExp(`(?<!\\p{L})(?:${Object.keys(WORDY).join("|")})(?!\\p{L})`, "giu"),
    message: "Wordy",
    fixes: (m) => [likeCase(m[0], WORDY[m[0].toLowerCase()])],
  },
  {
    pref: "filler",
    find: new RegExp(`(?<!\\p{L})(?:${FILLER.join("|")})(?!\\p{L})[ \\t]?`, "giu"),
    message: "Filler word",
    fixes: (m) => (/^\p{Ll}.*[ \t]$/u.test(m[0]) ? [""] : []),
  },
];

interface Speller {
  correct(word: string): boolean;
  suggest(word: string): readonly string[];
  readonly words: readonly string[];
}

const SUGGESTIONS = 4;
const WORD = /\p{L}+(?:['’]\p{L}+)*/gu;
const RETRY = 5000;
const spellers = new Map<string, Speller | null>();
const unread = new Set<string>();

async function loadSpeller(path: string, context: Context): Promise<Speller> {
  const base = path.replace(/\.(?:dic|aff)$/i, "");
  const upper = /\.(?:DIC|AFF)$/.test(path);
  const [aff, dic, { default: nspell }] = await Promise.all([
    context.host.readText(`${base}.${upper ? "AFF" : "aff"}`),
    context.host.readText(`${base}.${upper ? "DIC" : "dic"}`),
    import("nspell"),
  ]);
  const engine = nspell(aff, dic);
  const words = new Set<string>();
  for (const line of dic.split("\n").slice(1)) {
    const word = line.split("/")[0].trim();
    if (/^\p{Ll}{4,}$/u.test(word)) words.add(word);
  }
  return {
    correct: (word) => engine.correct(word),
    suggest: (word) => engine.suggest(word).slice(0, SUGGESTIONS),
    words: [...words].sort(),
  };
}

function speller(path: string | undefined, context: Context): Speller | null {
  if (!path) return null;
  const known = spellers.get(path);
  if (known !== undefined) return known;
  spellers.set(path, null);
  loadSpeller(path, context).then(
    (loaded) => {
      spellers.set(path, loaded);
      unread.delete(path);
      context.host.refresh();
    },
    (e: unknown) => {
      setTimeout(() => spellers.delete(path), RETRY);
      if (unread.has(path)) return;
      unread.add(path);
      console.error("assist dictionary", e);
      context.host.notify("Assist: dictionary not read");
    },
  );
  return null;
}

function ignored(prefs: Prefs): ReadonlySet<string> {
  return new Set(
    (prefs.ignore ?? "")
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean),
  );
}

function spelling(text: string, check: Speller, skip: ReadonlySet<string>, marks: Mark[]): void {
  WORD.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD.exec(text))) {
    const raw = m[0];
    const lead = m.index > 0 ? text[m.index - 1] : "";
    const trail = text[m.index + raw.length] ?? "";
    if (raw.length < 2 || lead === "#" || lead === "@" || lead === "\\") continue;
    if (/\p{N}/u.test(lead) || /\p{N}/u.test(trail)) continue;
    if (raw === raw.toUpperCase()) continue;
    const word = raw.replace(/’/g, "'");
    if (skip.has(word.toLowerCase()) || check.correct(word)) continue;
    marks.push({
      from: m.index,
      to: m.index + raw.length,
      kind: "spelling",
      message: "Spelling",
      fixes: () => check.suggest(word),
    });
  }
}

function prose(text: string, prefs: Prefs, context: Context): Result {
  const marks: Mark[] = [];
  for (const rule of RULES) {
    if (prefs[rule.pref] !== "on") continue;
    rule.find.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.find.exec(text))) {
      const fixes = rule.fixes(m);
      if (!fixes) continue;
      marks.push({
        from: m.index,
        to: m.index + m[0].length,
        kind: "style",
        message: rule.message,
        fixes,
      });
    }
  }
  const check = speller(prefs.dictionary, context);
  if (check) spelling(text, check, ignored(prefs), marks);
  return { out: [], marks };
}

function fence(lang: string, context: Context): Result {
  const off = context.off.find((p) => p.fences.includes(lang));
  if (!off) return { out: [] };
  return {
    out: [
      {
        at: OPENING,
        views: [{ text: `${off.label} is off · ${context.settings}`, hint: true }],
      },
    ],
  };
}

function run(regions: readonly Region[], prefs: Prefs, context: Context): Result[] {
  return regions.map((region) => {
    switch (region.kind) {
      case "fence":
        return prefs.hints === "on" ? fence(region.lang, context) : { out: [] };
      case "prose":
        return prose(region.text, prefs, context);
      default:
        return { out: [] };
    }
  });
}

const PREFIX = 3;
const SCANNED = 400;

function fromNote(prefix: string, around: string): string | null {
  const lower = prefix.toLowerCase();
  const counts = new Map<string, number>();
  for (const word of around.match(/\p{L}[\p{L}']+/gu) ?? []) {
    if (word.length > prefix.length && word.toLowerCase().startsWith(lower)) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let most = 0;
  for (const [word, count] of counts) {
    if (count > most || (count === most && best !== null && word.length < best.length)) {
      best = word;
      most = count;
    }
  }
  return best;
}

function fromDictionary(prefix: string, words: readonly string[]): string | null {
  const lower = prefix.toLowerCase();
  let lo = 0;
  let hi = words.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid] < lower) lo = mid + 1;
    else hi = mid;
  }
  let best: string | null = null;
  for (let i = lo; i < words.length && i < lo + SCANNED && words[i].startsWith(lower); i++) {
    if (words[i].length > lower.length && (best === null || words[i].length < best.length)) best = words[i];
  }
  return best;
}

function completeWord(request: CompleteRequest, words: readonly string[]): string | null {
  const m = /\p{L}[\p{L}']*$/u.exec(request.before);
  if (!m || m[0].length < PREFIX) return null;
  const prefix = m[0];
  const best =
    fromNote(prefix, `${request.before.slice(0, m.index)} ${request.after}`) ?? fromDictionary(prefix, words);
  return best ? best.slice(prefix.length) : null;
}

export function endpoint(address: string | undefined): string | null {
  const base = (address ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/\S+$/i.test(base)) return null;
  if (base.endsWith("/completions")) return base;
  return base.endsWith("/v1") ? `${base}/completions` : `${base}/v1/completions`;
}

const TOKENS = 48;
const failed = new Set<string>();

async function completeModel(
  request: CompleteRequest,
  prefs: Prefs,
  context: Context,
  signal: AbortSignal,
): Promise<string | null> {
  const url = endpoint(prefs.address);
  if (!url || !request.before.trim()) return null;
  const body = JSON.stringify({
    ...(prefs.model ? { model: prefs.model } : {}),
    prompt: request.before,
    max_tokens: TOKENS,
    temperature: 0.2,
    stop: ["\n"],
    stream: false,
  });
  try {
    const reply = JSON.parse(await context.host.post(url, body, signal)) as {
      choices?: { text?: unknown }[];
    };
    failed.delete(url);
    const text = reply.choices?.[0]?.text;
    return typeof text === "string" && text.trim() ? text.replace(/\s+$/, "") : null;
  } catch (e) {
    if (!signal.aborted && !failed.has(url)) {
      failed.add(url);
      console.error("assist model", e);
      context.host.notify("Assist: no answer from the model");
    }
    return null;
  }
}

function complete(
  request: CompleteRequest,
  prefs: Prefs,
  context: Context,
  signal: AbortSignal,
): Promise<string | null> | string | null {
  if (prefs.complete === "words") return completeWord(request, speller(prefs.dictionary, context)?.words ?? []);
  if (prefs.complete === "model") return completeModel(request, prefs, context, signal);
  return null;
}

const toggle = (key: string, label: string, on: boolean): PrefSpec => ({
  key,
  label,
  options: [
    { value: "on", label: "On" },
    { value: "off", label: "Off" },
  ],
  default: on ? "on" : "off",
});

const plugin: Plugin = {
  id: "assist",
  label: "Assist",
  api: 1,
  fences: "*",
  prose: true,
  isolated: true,
  prefs: [
    toggle("hints", "Plugin off hints", true),
    toggle("repeats", "Repeated words", true),
    toggle("wordy", "Wordy phrases", true),
    toggle("filler", "Filler words", false),
    {
      key: "dictionary",
      label: "Spelling dictionary",
      kind: "file",
      extensions: ["dic", "aff"],
      default: "",
    },
    {
      key: "ignore",
      label: "Ignored words",
      kind: "text",
      default: "",
      when: { key: "dictionary", not: "" },
    },
    {
      key: "complete",
      label: "Autocomplete",
      options: [
        { value: "off", label: "Off" },
        { value: "words", label: "Words" },
        { value: "model", label: "Model" },
      ],
      default: "off",
    },
    {
      key: "address",
      label: "Model address",
      kind: "text",
      placeholder: "http://127.0.0.1:8080",
      default: "",
      when: { key: "complete", is: "model" },
    },
    {
      key: "model",
      label: "Model name",
      kind: "text",
      default: "",
      when: { key: "complete", is: "model" },
    },
  ],
  run,
  complete,
};

export default plugin;
