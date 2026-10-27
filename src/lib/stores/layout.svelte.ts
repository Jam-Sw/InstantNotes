export type WidthClass = "large" | "expanded" | "medium" | "compact";
export type PaneState = "all" | "double" | "detail";
type LayoutMode = "phone" | "tablet" | "desktop";
type Pane = "list" | "note";

export type PaneSpec = { min: number; def: number; max: number };

export const NAV_PANE: PaneSpec = { min: 180, def: 220, max: 300 };
export const LIST_PANE: PaneSpec = { min: 240, def: 300, max: 420 };
export const EDITOR_MIN = 420;
const KEY_STEP = 16;

const COMPACT = "(max-width: 599px)";
const MEDIUM = "(max-width: 839px)";
const EXPANDED = "(max-width: 1199px)";
const COARSE = "(pointer: coarse)";
const HISTORY_KEY = "instantnotesPane";

function modeOf(cls: WidthClass): LayoutMode {
  return cls === "compact" ? "phone" : cls === "large" ? "desktop" : "tablet";
}

export function clampPane(spec: PaneSpec, width: number): number {
  return Math.min(spec.max, Math.max(spec.min, Math.round(width)));
}

// A drag that ends below half the pane's minimum collapses the pane instead of
// resizing it. `room` is what the window leaves the pane while the editor keeps
// its own minimum.
export function dragWidth(
  spec: PaneSpec,
  raw: number,
  room = Number.POSITIVE_INFINITY,
): { width: number; collapsed: boolean } {
  if (raw < spec.min / 2) return { width: spec.min, collapsed: true };
  const ceiling = Math.max(spec.min, Math.min(spec.max, room));
  return { width: Math.round(Math.min(ceiling, Math.max(spec.min, raw))), collapsed: false };
}

export function stepWidth(spec: PaneSpec, width: number, direction: -1 | 1, room?: number): number {
  return dragWidth(spec, Math.max(spec.min, width + direction * KEY_STEP), room).width;
}

// Which panes sit beside the editor. Large windows follow the chosen state;
// expanded windows keep the nav in its drawer; medium ones keep both drawers.
// When the window is too narrow for the editor to keep its minimum the nav
// yields first, then the list.
export function resolveLayout(
  cls: WidthClass,
  state: PaneState,
  width: number,
  navWidth: number,
  listWidth: number,
): { nav: boolean; list: boolean } {
  const wide = cls === "large" || cls === "expanded";
  let nav = cls === "large" && state === "all";
  let list = wide && state !== "detail";
  if (nav && navWidth + (list ? listWidth : 0) + EDITOR_MIN > width) nav = false;
  if (list && listWidth + EDITOR_MIN > width) list = false;
  return { nav, list };
}

type ShortcutKey = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

// Cmd or Ctrl+\ and Ctrl+Cmd+S (macOS only) toggle the nav, Cmd or Ctrl+Shift+L
// the note list.
export function layoutShortcut(e: ShortcutKey, mac: boolean): "nav" | "list" | null {
  const key = e.key.toLowerCase();
  if (mac && e.metaKey && e.ctrlKey && !e.altKey && !e.shiftKey && key === "s") return "nav";
  if (!(e.metaKey || e.ctrlKey)) return null;
  if (e.key === "\\" && !e.shiftKey && !e.altKey) return "nav";
  if (key === "l" && e.shiftKey && !e.altKey) return "list";
  return null;
}

class LayoutState {
  widthClass = $state<WidthClass>("large");
  width = $state(1440);
  // Kept for the code that still asks for phone, tablet or desktop.
  mode = $state<LayoutMode>("desktop");
  touch = $state(false);
  pane = $state<Pane>("list");
  onLeave: () => void = () => {};

  #pushed = false;

  get phone(): boolean {
    return this.mode === "phone";
  }

  init(win: Window = window): () => void {
    const compact = win.matchMedia(COMPACT);
    const medium = win.matchMedia(MEDIUM);
    const expanded = win.matchMedia(EXPANDED);
    const coarse = win.matchMedia(COARSE);
    const read = () => {
      this.widthClass = compact.matches
        ? "compact"
        : medium.matches
          ? "medium"
          : expanded.matches
            ? "expanded"
            : "large";
      this.width = win.innerWidth;
      this.mode = modeOf(this.widthClass);
      this.touch = coarse.matches;
      if (!this.phone) this.#settle();
      const root = win.document.documentElement;
      root.dataset.layout = this.mode;
      if (this.touch) root.dataset.touch = "";
      else delete root.dataset.touch;
    };
    const onPop = () => {
      if (!this.#pushed) return;
      this.#pushed = false;
      this.#leave();
    };
    const view = win.visualViewport;
    const root = win.document.documentElement;
    const onResize = () => {
      if (view && this.touch) root.style.setProperty("--app-height", `${Math.round(view.height)}px`);
      else root.style.removeProperty("--app-height");
    };
    read();
    onResize();
    for (const q of [compact, medium, expanded, coarse]) q.addEventListener("change", read);
    win.addEventListener("resize", read);
    coarse.addEventListener("change", onResize);
    view?.addEventListener("resize", onResize);
    win.addEventListener("popstate", onPop);
    return () => {
      for (const q of [compact, medium, expanded, coarse]) q.removeEventListener("change", read);
      win.removeEventListener("resize", read);
      coarse.removeEventListener("change", onResize);
      view?.removeEventListener("resize", onResize);
      win.removeEventListener("popstate", onPop);
    };
  }

  showNote(): void {
    if (!this.phone || this.pane === "note") return;
    this.pane = "note";
    history.pushState({ [HISTORY_KEY]: "note" }, "");
    this.#pushed = true;
  }

  back(): void {
    if (this.pane !== "note") return;
    if (this.#pushed) {
      history.back();
      return;
    }
    this.#leave();
  }

  showList(): void {
    if (this.pane === "list") return;
    this.#settle();
  }

  #settle(): void {
    if (this.#pushed) {
      this.#pushed = false;
      history.back();
    }
    this.pane = "list";
  }

  #leave(): void {
    this.pane = "list";
    this.onLeave();
  }
}

export const layout = new LayoutState();
