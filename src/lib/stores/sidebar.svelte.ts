import { getSetting, setSetting } from "$lib/api/client";
import {
  EDITOR_MIN,
  LIST_PANE,
  NAV_PANE,
  clampPane,
  dragWidth,
  resolveLayout,
  stepWidth,
  type PaneState,
  type WidthClass,
} from "./layout.svelte";

type InlineClass = "large" | "expanded";
type Pane = "nav" | "list";

const KEYS: Record<InlineClass, string> = {
  large: "layout.large",
  expanded: "layout.expanded",
};
const KEY_NAV_WIDTH = "layout.navWidth";
const KEY_LIST_WIDTH = "layout.listWidth";

const LEGACY_WIDTH = "sidebar.width";
const LEGACY_NAV_COLLAPSED = "sidebar.collapsed";
const LEGACY_LIST_COLLAPSED = "notes.collapsed";

const DEFAULTS: Record<InlineClass, PaneState> = { large: "all", expanded: "double" };
const STATES: readonly PaneState[] = ["all", "double", "detail"];

function isState(value: unknown): value is PaneState {
  return typeof value === "string" && (STATES as readonly string[]).includes(value);
}

function isInline(cls: WidthClass): cls is InlineClass {
  return cls === "large" || cls === "expanded";
}

class SidebarState {
  navWidth = $state(NAV_PANE.def);
  listWidth = $state(LIST_PANE.def);
  states = $state<Record<InlineClass, PaneState>>({ ...DEFAULTS });
  widthClass = $state<WidthClass>("large");
  viewport = $state(1440);
  // Overlay state is never saved: both drawers start closed once a note is open.
  narrowOpen = $state(false);
  listOpen = $state(false);
  // The pane a drag is about to collapse, so the page can preview it.
  snapping = $state<Pane | null>(null);

  #before: Record<InlineClass, "all" | "double"> = { large: "all", expanded: "double" };
  #loaded = false;

  // The chosen state of the current width class. Medium and compact windows
  // show the editor alone; their panes are drawers or a stack.
  get state(): PaneState {
    return isInline(this.widthClass) ? this.states[this.widthClass] : "detail";
  }

  resolved(state: PaneState = this.state): { nav: boolean; list: boolean } {
    return resolveLayout(this.widthClass, state, this.viewport, this.navWidth, this.listWidth);
  }

  get navInline(): boolean {
    return this.resolved().nav;
  }

  get listInline(): boolean {
    return this.resolved().list;
  }

  // The nav lives in its drawer whenever it is not beside the editor.
  get narrow(): boolean {
    return !this.navInline;
  }

  get hidden(): boolean {
    return this.narrow ? !this.narrowOpen : false;
  }

  // The list is an overlay on medium windows, and on larger ones that have no
  // room for it beside the editor.
  get listOverlay(): boolean {
    if (this.widthClass === "compact") return false;
    if (this.widthClass === "medium") return true;
    return this.state !== "detail" && !this.listInline;
  }

  get listHidden(): boolean {
    if (this.widthClass === "compact") return false;
    return this.listOverlay ? !this.listOpen : !this.listInline;
  }

  get navTrack(): number {
    return this.navInline && this.snapping !== "nav" ? this.navWidth : 0;
  }

  get listTrack(): number {
    return this.listInline && this.snapping !== "list" ? this.listWidth : 0;
  }

  async init(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const [large, expanded, nav, list, legacyWidth, legacyNav, legacyList] = await Promise.all([
        getSetting<string>(KEYS.large),
        getSetting<string>(KEYS.expanded),
        getSetting<number>(KEY_NAV_WIDTH),
        getSetting<number>(KEY_LIST_WIDTH),
        getSetting<number>(LEGACY_WIDTH),
        getSetting<boolean>(LEGACY_NAV_COLLAPSED),
        getSetting<boolean>(LEGACY_LIST_COLLAPSED),
      ]);
      const migrated: PaneState | null =
        legacyList === true ? "detail" : legacyNav === true ? "double" : null;
      if (isState(large)) this.states.large = large;
      else if (migrated) this.states.large = migrated;
      if (isState(expanded)) this.states.expanded = expanded === "all" ? "double" : expanded;
      else if (migrated) this.states.expanded = migrated === "detail" ? "detail" : "double";
      this.#before.large = this.states.large === "double" ? "double" : "all";
      if (typeof nav === "number" && nav >= NAV_PANE.min && nav <= NAV_PANE.max) this.navWidth = nav;
      else if (typeof legacyWidth === "number" && legacyWidth >= 150 && legacyWidth <= 420) {
        this.navWidth = clampPane(NAV_PANE, legacyWidth);
      }
      if (typeof list === "number" && list >= LIST_PANE.min && list <= LIST_PANE.max) {
        this.listWidth = list;
      }
    } catch {
    }
  }

  setViewport(cls: WidthClass, width: number, noteOpen: boolean): void {
    const wasNarrow = this.narrow;
    const wasOverlay = this.listOverlay;
    this.widthClass = cls;
    this.viewport = width;
    if (this.narrow !== wasNarrow) this.narrowOpen = false;
    if (!this.listOverlay) this.listOpen = false;
    else if (!wasOverlay) this.listOpen = !noteOpen;
  }

  noteOpened(): void {
    if (this.listOverlay) this.listOpen = false;
  }

  #setState(cls: InlineClass, state: PaneState): void {
    const next = cls === "expanded" && state === "all" ? "double" : state;
    if (this.states[cls] === next) return;
    if (next !== "detail") this.#before[cls] = next;
    this.states[cls] = next;
    this.narrowOpen = false;
    void setSetting(KEYS[cls], next);
  }

  toggle(): void {
    const cls = this.widthClass;
    if (cls === "large") {
      if (!this.narrow && this.state === "all") {
        this.#setState(cls, "double");
        return;
      }
      if (this.state === "double" && this.resolved("all").nav) {
        this.#setState(cls, "all");
        return;
      }
    }
    this.narrowOpen = !this.narrowOpen;
  }

  toggleList(): void {
    const cls = this.widthClass;
    if (cls === "compact") return;
    if (this.listOverlay) {
      this.listOpen = !this.listOpen;
      return;
    }
    if (!isInline(cls)) return;
    if (this.state === "detail") this.#setState(cls, this.#before[cls]);
    else this.#setState(cls, "detail");
  }

  revealList(): void {
    const cls = this.widthClass;
    if (cls === "compact") return;
    if (this.listOverlay) this.listOpen = true;
    else if (isInline(cls) && this.state === "detail") this.#setState(cls, this.#before[cls]);
  }

  closeList(): boolean {
    if (!this.listOverlay || !this.listOpen) return false;
    this.listOpen = false;
    return true;
  }

  // Escape: the nav drawer sits above the list overlay, so it closes first.
  closeOverlay(): boolean {
    if (this.narrow && this.narrowOpen) {
      this.narrowOpen = false;
      return true;
    }
    return this.closeList();
  }

  #room(pane: Pane): number {
    const { nav, list } = this.resolved();
    const other = pane === "nav" ? (list ? this.listWidth : 0) : nav ? this.navWidth : 0;
    return this.viewport - EDITOR_MIN - other;
  }

  #saveWidth(pane: Pane): void {
    if (pane === "nav") void setSetting(KEY_NAV_WIDTH, this.navWidth);
    else void setSetting(KEY_LIST_WIDTH, this.listWidth);
  }

  resizeNav(raw: number): void {
    const result = dragWidth(NAV_PANE, raw, this.#room("nav"));
    this.snapping = result.collapsed ? "nav" : null;
    if (!result.collapsed) this.navWidth = result.width;
  }

  resizeList(raw: number): void {
    const result = dragWidth(LIST_PANE, raw, this.#room("list"));
    this.snapping = result.collapsed ? "list" : null;
    if (!result.collapsed) this.listWidth = result.width;
  }

  // The drag ended: a pane dragged to nothing collapses, anything else keeps its width.
  commitDrag(pane: Pane): void {
    const collapse = this.snapping === pane;
    this.snapping = null;
    const cls = this.widthClass;
    if (collapse && isInline(cls)) this.#setState(cls, pane === "nav" ? "double" : "detail");
    this.#saveWidth(pane);
  }

  resetWidth(pane: Pane): void {
    this.snapping = null;
    if (pane === "nav") this.navWidth = NAV_PANE.def;
    else this.listWidth = LIST_PANE.def;
    this.#saveWidth(pane);
  }

  stepPane(pane: Pane, direction: -1 | 1): void {
    if (pane === "nav") this.navWidth = stepWidth(NAV_PANE, this.navWidth, direction, this.#room("nav"));
    else this.listWidth = stepWidth(LIST_PANE, this.listWidth, direction, this.#room("list"));
    this.#saveWidth(pane);
  }
}

export const sidebar = new SidebarState();
