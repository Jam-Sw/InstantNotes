// Ember - warm charcoal with an amber accent: a glowing, focused dark theme
// for evening writing, more saturated than Paper Dark and less editorial
// than Manuscript. Light variant is sun-warmed cream with burnt amber.

import type { Theme } from "../types";
import { MONO_STACK, SANS_STACK } from "../fonts";

export const ember: Theme = {
  id: "ember",
  name: "Ember",
  author: "InstantNotes",
  description: "Warm charcoal and glowing amber. Focused, for evenings.",
  version: 1,
  appearance: "dual",
  fonts: { ui: SANS_STACK, mono: MONO_STACK, body: "ui", meta: "ui" },
  metrics: {
    radius: "10px",
    radiusLg: "16px",
    density: 1.05,
    leading: "1.6",
    shadow: "0 2px 8px rgba(20, 10, 4, 0.45)",
    shadowLg: "0 22px 60px rgba(20, 10, 4, 0.6)",
  },
  dark: {
    bg: "#191614",
    bgSidebar: "#1f1b18",
    bgHover: "#28231f",
    bgActive: "#322b26",
    bgInput: "#1f1b18",
    text: "#f0e9e1",
    textSecondary: "#b0a396",
    textTertiary: "#7a6e63",
    border: "#2e2824",
    accent: "#f0a35a",
    accentText: "#f6b878",
    accentSoft: "rgba(240, 163, 90, 0.14)",
    danger: "#ec6f5e",
    tag: "#f6b878",
    success: "#9cc77a",
    warning: "#f0cf6a",
    selection: "rgba(240, 163, 90, 0.24)",
    codeBg: "#221d1a",
  },
  light: {
    bg: "#fbf6ef",
    bgSidebar: "#f3ebe0",
    bgHover: "#ebe0d1",
    bgActive: "#e0d2bf",
    bgInput: "#fffdf9",
    text: "#2c241d",
    textSecondary: "#6d5f52",
    textTertiary: "#978877",
    border: "#e6dbcc",
    accent: "#c86f1f",
    accentText: "#a45a14",
    accentSoft: "rgba(200, 111, 31, 0.14)",
    danger: "#c7472f",
    tag: "#a45a14",
    success: "#5d8b3a",
    warning: "#b8891a",
    selection: "rgba(200, 111, 31, 0.22)",
    codeBg: "#f3ebe0",
  },
};
