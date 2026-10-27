import { browser } from "$app/environment";

export const isMac = browser ? navigator.userAgent.includes("Mac") : true;

export const modKey = isMac ? "⌘" : "Ctrl+";

export const shiftKey = isMac ? "⇧" : "Shift+";

export const captureShortcut = isMac
  ? import.meta.env.DEV
    ? "⌥⇧Space"
    : "⌥Space"
  : import.meta.env.DEV
    ? "Ctrl+Shift+Alt+Space"
    : "Ctrl+Shift+Space";

export function platformName(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints): string {
  if (/iPhone|iPod/.test(ua)) return "iOS";
  if (/iPad/.test(ua) || (ua.includes("Mac") && touchPoints > 1)) return "iPadOS";
  if (ua.includes("Mac")) return "macOS";
  if (ua.includes("Windows")) return "Windows";
  if (/Linux|X11/.test(ua)) return "Linux";
  return "Unknown";
}
