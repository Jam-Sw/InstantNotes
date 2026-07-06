// Platform-specific keyboard labels. Detection feeds LABELS only; key handling
// always accepts both Cmd and Ctrl (see +page.svelte), so a wrong guess can
// never break a shortcut, just mislabel it.
import { browser } from "$app/environment";

/** True on macOS. Defaults to true when there is no navigator (prerender);
 *  the value is re-evaluated in the real webview at hydration. */
export const isMac = browser ? navigator.userAgent.includes("Mac") : true;

/** Modifier prefix for shortcut labels: "⌘K" on macOS, "Ctrl+K" elsewhere. */
export const modKey = isMac ? "⌘" : "Ctrl+";

/** Shift segment for chorded labels: "⌘⇧K" on macOS, "Ctrl+Shift+K" elsewhere. */
export const shiftKey = isMac ? "⇧" : "Shift+";

/** The global capture hotkey as registered in src-tauri/src/lib.rs. */
export const captureShortcut = isMac ? "⌥Space" : "Ctrl+Shift+Space";
