import { browser } from "$app/environment";

export const isMac = browser ? navigator.userAgent.includes("Mac") : true;

export const modKey = isMac ? "⌘" : "Ctrl+";

export const shiftKey = isMac ? "⇧" : "Shift+";

export const captureShortcut = isMac ? "⌥Space" : "Ctrl+Shift+Space";
