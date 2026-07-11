// Link preferences (Svelte 5 runes): how links look and open inside notes.
// Persisted to the settings KV like editorPrefs. The editor consumes these
// through a CodeMirror state field (see src/lib/editor/links.ts), synced by
// Editor.svelte whenever a value changes, so edits apply live.

import { getSetting, setSetting } from "$lib/api/client";
import {
  DEFAULT_LINK_PREFS,
  type LinkOpenWith,
  type LinkUnderline,
  type LinkPrefsSnapshot,
} from "$lib/editor";

const KEY_OPEN = "links.openWith";
const KEY_UNDERLINE = "links.underline";
const KEY_TOOLTIP = "links.tooltip";
const KEY_EXTERNAL = "links.externalIndicator";

class LinkPrefsStore {
  openWith = $state<LinkOpenWith>(DEFAULT_LINK_PREFS.openWith);
  underline = $state<LinkUnderline>(DEFAULT_LINK_PREFS.underline);
  tooltip = $state<boolean>(DEFAULT_LINK_PREFS.tooltip);
  externalIndicator = $state<boolean>(DEFAULT_LINK_PREFS.externalIndicator);

  #loaded = false;

  async init(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const [open, ul, tip, ext] = await Promise.all([
        getSetting<string>(KEY_OPEN),
        getSetting<string>(KEY_UNDERLINE),
        getSetting<boolean>(KEY_TOOLTIP),
        getSetting<boolean>(KEY_EXTERNAL),
      ]);
      if (open === "click" || open === "modclick") this.openWith = open;
      if (ul === "always" || ul === "hover" || ul === "never") this.underline = ul;
      if (typeof tip === "boolean") this.tooltip = tip;
      if (typeof ext === "boolean") this.externalIndicator = ext;
    } catch {
      // Settings are best-effort; fall back to defaults silently.
    }
  }

  /** Plain object for dispatching into CodeMirror (no reactive proxies). */
  snapshot(): LinkPrefsSnapshot {
    return {
      openWith: this.openWith,
      underline: this.underline,
      tooltip: this.tooltip,
      externalIndicator: this.externalIndicator,
    };
  }

  setOpenWith(v: LinkOpenWith): void {
    this.openWith = v;
    void setSetting(KEY_OPEN, v);
  }

  setUnderline(v: LinkUnderline): void {
    this.underline = v;
    void setSetting(KEY_UNDERLINE, v);
  }

  setTooltip(v: boolean): void {
    this.tooltip = v;
    void setSetting(KEY_TOOLTIP, v);
  }

  setExternalIndicator(v: boolean): void {
    this.externalIndicator = v;
    void setSetting(KEY_EXTERNAL, v);
  }
}

export const linkPrefs = new LinkPrefsStore();
