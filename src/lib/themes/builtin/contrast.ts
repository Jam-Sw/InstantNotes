// Contrast - a high-contrast theme for low vision, bright rooms, and anyone
// who wants text to be unmistakable: true black and white grounds, every
// text tone at or above WCAG AA against them, firm borders, a larger base
// size, and a single saturated accent. No translucency anywhere.

import type { Theme } from "../types";
import { MONO_STACK, SANS_STACK } from "../fonts";

export const contrast: Theme = {
  id: "contrast",
  name: "Contrast",
  author: "InstantNotes",
  description: "High contrast, larger text, firm borders. Unmistakable.",
  version: 1,
  appearance: "dual",
  fonts: { ui: SANS_STACK, mono: MONO_STACK, body: "ui", meta: "ui" },
  metrics: {
    radius: "6px",
    radiusLg: "8px",
    density: 1.2,
    leading: "1.65",
    shadow: "0 0 0 1px rgba(0, 0, 0, 0.8)",
    shadowLg: "0 0 0 2px rgba(0, 0, 0, 0.9)",
  },
  dark: {
    bg: "#000000",
    bgSidebar: "#0d0d0d",
    bgHover: "#1f1f1f",
    bgActive: "#2e2e2e",
    bgInput: "#0d0d0d",
    text: "#ffffff",
    textSecondary: "#d6d6d6",
    textTertiary: "#a3a3a3",
    border: "#5c5c5c",
    accent: "#ffd60a",
    accentText: "#ffe15a",
    accentSoft: "rgba(255, 214, 10, 0.22)",
    danger: "#ff6b6b",
    tag: "#6fd3ff",
    success: "#7ee787",
    warning: "#ffb347",
    selection: "rgba(255, 214, 10, 0.4)",
    codeBg: "#141414",
    focus: "#ffffff",
  },
  light: {
    bg: "#ffffff",
    bgSidebar: "#f2f2f2",
    bgHover: "#e3e3e3",
    bgActive: "#d2d2d2",
    bgInput: "#ffffff",
    text: "#000000",
    textSecondary: "#2b2b2b",
    textTertiary: "#5a5a5a",
    border: "#8a8a8a",
    accent: "#0033cc",
    accentText: "#002699",
    accentSoft: "rgba(0, 51, 204, 0.14)",
    danger: "#b80000",
    tag: "#005f99",
    success: "#1a6b1a",
    warning: "#8a5a00",
    selection: "rgba(0, 51, 204, 0.25)",
    codeBg: "#f2f2f2",
    focus: "#000000",
  },
};
