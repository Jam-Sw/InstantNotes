// Paper Dark - warm sepia dark with a clay accent; the cozy, low-glare reading
// direction. Light variant is warm paper with the same clay, for a notebook
// feel in daylight.

import type { Theme } from "../types";
import { SANS_STACK, MONO_STACK } from "../fonts";

export const paperDark: Theme = {
  id: "paper-dark",
  name: "Paper Dark",
  author: "InstantNotes",
  version: 1,
  appearance: "dual",
  fonts: { ui: SANS_STACK, mono: MONO_STACK, body: "ui", meta: "ui" },
  metrics: { radius: "8px", density: 1.0 },
  dark: {
    bg: "#1c1a17",
    bgSidebar: "#22201c",
    bgHover: "#2a2723",
    bgActive: "#332f29",
    bgInput: "#22201c",
    text: "#ece4d8",
    textSecondary: "#a89a87",
    textTertiary: "#6b5f50",
    border: "#2e2a25",
    accent: "#d2926a",
    accentText: "#e0a878",
    accentSoft: "rgba(210, 146, 106, 0.13)",
    danger: "#e07a5f",
    tag: "#e0a878",
  },
  light: {
    bg: "#f7f2e9",
    bgSidebar: "#efe8da",
    bgHover: "#e7dece",
    bgActive: "#dccfba",
    bgInput: "#fffdf8",
    text: "#2e2820",
    textSecondary: "#6f6452",
    textTertiary: "#a89a82",
    border: "#e2d8c6",
    accent: "#b5703f",
    accentText: "#9c5c2e",
    accentSoft: "rgba(181, 112, 63, 0.14)",
    danger: "#c2553f",
    tag: "#9c5c2e",
  },
};
