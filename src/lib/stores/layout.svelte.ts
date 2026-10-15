type LayoutMode = "phone" | "tablet" | "desktop";
type Pane = "list" | "note";

const PHONE = "(max-width: 599px)";
const NARROW = "(max-width: 960px)";
const COARSE = "(pointer: coarse)";
const HISTORY_KEY = "instantnotesPane";

class LayoutState {
  mode = $state<LayoutMode>("desktop");
  touch = $state(false);
  pane = $state<Pane>("list");
  onLeave: () => void = () => {};

  #pushed = false;

  get phone(): boolean {
    return this.mode === "phone";
  }

  init(win: Window = window): () => void {
    const phone = win.matchMedia(PHONE);
    const narrow = win.matchMedia(NARROW);
    const coarse = win.matchMedia(COARSE);
    const read = () => {
      this.mode = phone.matches ? "phone" : narrow.matches ? "tablet" : "desktop";
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
    for (const q of [phone, narrow, coarse]) q.addEventListener("change", read);
    coarse.addEventListener("change", onResize);
    view?.addEventListener("resize", onResize);
    win.addEventListener("popstate", onPop);
    return () => {
      for (const q of [phone, narrow, coarse]) q.removeEventListener("change", read);
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
