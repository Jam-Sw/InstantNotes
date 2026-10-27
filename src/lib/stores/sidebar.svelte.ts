import { getSetting, setSetting } from "$lib/api/client";

const KEY_WIDTH = "sidebar.width";
const KEY_COLLAPSED = "sidebar.collapsed";
const KEY_LIST_COLLAPSED = "notes.collapsed";

const SIDEBAR_MIN = 150;
const SIDEBAR_MAX = 420;
const SIDEBAR_DEFAULT = 190;

class SidebarState {
  width = $state(SIDEBAR_DEFAULT);
  collapsed = $state(false);
  narrow = $state(false);
  narrowOpen = $state(false);
  listCollapsed = $state(false);
  listDrawer = $state(false);
  listOpen = $state(true);

  #loaded = false;

  get hidden(): boolean {
    return this.narrow ? !this.narrowOpen : this.collapsed;
  }

  get listHidden(): boolean {
    return this.listDrawer ? !this.listOpen : this.listCollapsed;
  }

  async init(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const [w, c, l] = await Promise.all([
        getSetting<number>(KEY_WIDTH),
        getSetting<boolean>(KEY_COLLAPSED),
        getSetting<boolean>(KEY_LIST_COLLAPSED),
      ]);
      if (typeof w === "number" && w >= SIDEBAR_MIN && w <= SIDEBAR_MAX) this.width = w;
      if (typeof c === "boolean") this.collapsed = c;
      if (typeof l === "boolean") this.listCollapsed = l;
    } catch {
    }
  }

  #clamp(w: number): number {
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)));
  }

  setWidth(w: number): void {
    this.width = this.#clamp(w);
  }

  commitWidth(): void {
    void setSetting(KEY_WIDTH, this.width);
  }

  resetWidth(): void {
    this.width = SIDEBAR_DEFAULT;
    this.commitWidth();
  }

  setNarrow(narrow: boolean): void {
    this.narrow = narrow;
    this.narrowOpen = false;
  }

  toggle(): void {
    if (this.narrow) {
      this.narrowOpen = !this.narrowOpen;
      return;
    }
    this.collapsed = !this.collapsed;
    void setSetting(KEY_COLLAPSED, this.collapsed);
  }

  setListDrawer(drawer: boolean, noteOpen: boolean): void {
    this.listDrawer = drawer;
    this.listOpen = !noteOpen;
  }

  noteOpened(): void {
    if (this.listDrawer) this.listOpen = false;
  }

  toggleList(): void {
    if (this.listDrawer) {
      this.listOpen = !this.listOpen;
      return;
    }
    this.#setListCollapsed(!this.listCollapsed);
  }

  revealList(): void {
    if (this.listDrawer) this.listOpen = true;
    else if (this.listCollapsed) this.#setListCollapsed(false);
  }

  closeList(): boolean {
    if (!this.listDrawer || !this.listOpen) return false;
    this.listOpen = false;
    return true;
  }

  #setListCollapsed(collapsed: boolean): void {
    this.listCollapsed = collapsed;
    void setSetting(KEY_LIST_COLLAPSED, collapsed);
  }
}

export const sidebar = new SidebarState();
