import { getSetting, setSetting } from "$lib/api/client";
import type { Precision } from "$lib/calc/engine";

const KEY_ZOOM = "editor.zoom";
const KEY_TOOLBAR = "editor.toolbarOpen";
const KEY_SOURCE = "editor.sourceMode";
const KEY_EXACT_TIME = "editor.showExactTime";
const KEY_WIDTH = "editor.width";
const KEY_SPELLCHECK = "editor.spellcheck";
const KEY_WRAP = "editor.wrap";
const KEY_CALC_PRECISION = "editor.calcPrecision";
const KEY_AUTOSAVE = "editor.autosaveMs";
const KEY_INDENT = "editor.indentWidth";
const MIN = 0.7;
const MAX = 2.5;
const STEP = 0.1;

export type EditorWidth = "readable" | "wide" | "full";

export type AutosaveMs = 150 | 400 | 1000;
export type IndentWidth = 2 | 4;

const isPrecision = (v: unknown): v is Precision => v === "short" || v === "long";
const isAutosave = (v: unknown): v is AutosaveMs => v === 150 || v === 400 || v === 1000;
const isIndent = (v: unknown): v is IndentWidth => v === 2 || v === 4;

const MEASURES: Record<EditorWidth, string> = {
  readable: "70ch",
  wide: "110ch",
  full: "100vw",
};

const isWidth = (v: unknown): v is EditorWidth =>
  typeof v === "string" && Object.hasOwn(MEASURES, v);

function applyWidth(width: EditorWidth): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--measure", MEASURES[width]);
}

export const EDITOR_DEFAULTS: {
  zoom: number;
  toolbarOpen: boolean;
  sourceMode: boolean;
  showExactTime: boolean;
  width: EditorWidth;
  spellcheck: boolean;
  wrap: boolean;
  calcPrecision: Precision;
  autosaveMs: AutosaveMs;
  indentWidth: IndentWidth;
} = {
  zoom: 1,
  toolbarOpen: true,
  sourceMode: false,
  showExactTime: false,
  width: "readable",
  spellcheck: false,
  wrap: true,
  calcPrecision: "short",
  autosaveMs: 400,
  indentWidth: 2,
};

class EditorPrefs {
  zoom = $state(EDITOR_DEFAULTS.zoom);
  toolbarOpen = $state(EDITOR_DEFAULTS.toolbarOpen);
  sourceMode = $state(EDITOR_DEFAULTS.sourceMode);
  showExactTime = $state(EDITOR_DEFAULTS.showExactTime);
  width = $state<EditorWidth>(EDITOR_DEFAULTS.width);
  spellcheck = $state(EDITOR_DEFAULTS.spellcheck);
  wrap = $state(EDITOR_DEFAULTS.wrap);
  calcPrecision = $state<Precision>(EDITOR_DEFAULTS.calcPrecision);
  autosaveMs = $state<AutosaveMs>(EDITOR_DEFAULTS.autosaveMs);
  indentWidth = $state<IndentWidth>(EDITOR_DEFAULTS.indentWidth);

  #loaded = false;
  #touched = new Set<string>();

  async init(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const [z, open, source, exact, width, spell, wrap, precision, autosave, indent] = await Promise.all([
        getSetting<number>(KEY_ZOOM),
        getSetting<boolean>(KEY_TOOLBAR),
        getSetting<boolean>(KEY_SOURCE),
        getSetting<boolean>(KEY_EXACT_TIME),
        getSetting<string>(KEY_WIDTH),
        getSetting<boolean>(KEY_SPELLCHECK),
        getSetting<boolean>(KEY_WRAP),
        getSetting<string>(KEY_CALC_PRECISION),
        getSetting<number>(KEY_AUTOSAVE),
        getSetting<number>(KEY_INDENT),
      ]);
      if (!this.#touched.has(KEY_ZOOM) && typeof z === "number" && z >= MIN && z <= MAX) {
        this.zoom = z;
      }
      if (!this.#touched.has(KEY_TOOLBAR) && typeof open === "boolean") {
        this.toolbarOpen = open;
      }
      if (!this.#touched.has(KEY_SOURCE) && typeof source === "boolean") {
        this.sourceMode = source;
      }
      if (!this.#touched.has(KEY_EXACT_TIME) && typeof exact === "boolean") {
        this.showExactTime = exact;
      }
      if (!this.#touched.has(KEY_WIDTH) && isWidth(width)) {
        this.width = width;
        applyWidth(width);
      }
      if (!this.#touched.has(KEY_SPELLCHECK) && typeof spell === "boolean") this.spellcheck = spell;
      if (!this.#touched.has(KEY_WRAP) && typeof wrap === "boolean") this.wrap = wrap;
      if (!this.#touched.has(KEY_CALC_PRECISION) && isPrecision(precision)) this.calcPrecision = precision;
      if (!this.#touched.has(KEY_AUTOSAVE) && isAutosave(autosave)) this.autosaveMs = autosave;
      if (!this.#touched.has(KEY_INDENT) && isIndent(indent)) this.indentWidth = indent;
    } catch {
    }
  }

  async reload(): Promise<void> {
    this.#loaded = false;
    this.#touched.clear();
    await this.init();
  }

  setShowExactTime(v: boolean): void {
    this.#touched.add(KEY_EXACT_TIME);
    this.showExactTime = v;
    void setSetting(KEY_EXACT_TIME, v);
  }

  setWidth(v: EditorWidth): void {
    this.#touched.add(KEY_WIDTH);
    this.width = v;
    applyWidth(v);
    void setSetting(KEY_WIDTH, v);
  }

  setSpellcheck(v: boolean): void {
    this.spellcheck = v;
    this.#save(KEY_SPELLCHECK, v);
  }

  setWrap(v: boolean): void {
    this.wrap = v;
    this.#save(KEY_WRAP, v);
  }

  setCalcPrecision(v: Precision): void {
    this.calcPrecision = v;
    this.#save(KEY_CALC_PRECISION, v);
  }

  setAutosaveMs(v: AutosaveMs): void {
    this.autosaveMs = v;
    this.#save(KEY_AUTOSAVE, v);
  }

  setIndentWidth(v: IndentWidth): void {
    this.indentWidth = v;
    this.#save(KEY_INDENT, v);
  }

  #save(key: string, v: unknown): void {
    this.#touched.add(key);
    void setSetting(key, v);
  }

  #clamp(z: number): number {
    return Math.min(MAX, Math.max(MIN, +z.toFixed(1)));
  }

  setZoom(z: number): void {
    this.#touched.add(KEY_ZOOM);
    this.zoom = this.#clamp(z);
    void setSetting(KEY_ZOOM, this.zoom);
  }

  zoomIn(): void {
    this.setZoom(this.zoom + STEP);
  }

  zoomOut(): void {
    this.setZoom(this.zoom - STEP);
  }

  resetZoom(): void {
    this.setZoom(EDITOR_DEFAULTS.zoom);
  }

  toggleToolbar(): void {
    this.#touched.add(KEY_TOOLBAR);
    this.toolbarOpen = !this.toolbarOpen;
    void setSetting(KEY_TOOLBAR, this.toolbarOpen);
  }

  toggleSourceMode(): void {
    this.#touched.add(KEY_SOURCE);
    this.sourceMode = !this.sourceMode;
    void setSetting(KEY_SOURCE, this.sourceMode);
  }
}

export const editorPrefs = new EditorPrefs();
