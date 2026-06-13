// Terminal — phosphor green on near-black, monospace throughout, tight radius
// and dense spacing. The flourish block in app.css adds the blinking caret,
// uppercase section labels, and the row prefix. Light variant keeps the green
// signal on a high-contrast light ground.

import type { Theme } from "../types";
import { SANS_STACK, MONO_STACK } from "../fonts";

export const terminal: Theme = {
  id: "terminal",
  name: "Terminal",
  author: "InstantNotes",
  version: 1,
  appearance: "dual",
  fonts: { ui: SANS_STACK, mono: MONO_STACK, body: "mono", meta: "mono" },
  metrics: { radius: "4px", density: 0.82 },
  dark: {
    bg: "#0c0c0e",
    bgSidebar: "#111113",
    bgHover: "#18181b",
    bgActive: "#1f1f23",
    bgInput: "#111113",
    text: "#c6d8cc",
    textSecondary: "#6f8a7a",
    textTertiary: "#45564c",
    border: "#1d1d20",
    accent: "#5fe3a1",
    accentText: "#5fe3a1",
    accentSoft: "rgba(95, 227, 161, 0.10)",
    danger: "#ff5f56",
    tag: "#5fe3a1",
  },
  light: {
    bg: "#f4f6f4",
    bgSidebar: "#e9ece9",
    bgHover: "#dfe3df",
    bgActive: "#d3d8d3",
    bgInput: "#ffffff",
    text: "#102016",
    textSecondary: "#486052",
    textTertiary: "#84998d",
    border: "#d4dad5",
    accent: "#0f9d58",
    accentText: "#0b7a44",
    accentSoft: "rgba(15, 157, 88, 0.12)",
    danger: "#c5372c",
    tag: "#0b7a44",
  },
};
