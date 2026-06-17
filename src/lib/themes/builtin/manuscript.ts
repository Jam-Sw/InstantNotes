// Manuscript - the default direction. Editorial, near-monochrome, warm ink on
// near-black; a sage accent and monospace metadata give it a typeset feel.
// Light variant is warm "paper": off-white ground, ink text, deeper sage.

import type { Theme } from "../types";
import { MONO_STACK, SANS_STACK } from "../fonts";

export const manuscript: Theme = {
  id: "manuscript",
  name: "Manuscript",
  author: "InstantNotes",
  version: 1,
  appearance: "dual",
  fonts: { ui: SANS_STACK, mono: MONO_STACK, body: "ui", meta: "mono" },
  metrics: {
    radius: "8px",
    density: 1.15,
    // Editorial: airy line-height and a touch of negative tracking for a
    // typeset feel; warm, soft, deep elevation on overlays.
    leading: "1.6",
    tracking: "-0.01em",
    shadow: "0 1px 4px rgba(34, 26, 16, 0.12)",
    shadowLg: "0 20px 56px rgba(34, 26, 16, 0.34)",
  },
  dark: {
    bg: "#161617",
    bgSidebar: "#1c1c1d",
    bgHover: "#232324",
    bgActive: "#2b2b2c",
    bgInput: "#1c1c1d",
    text: "#e8e6e1",
    textSecondary: "#9a978f",
    textTertiary: "#62605b",
    border: "#2a2a2b",
    accent: "#86b8a3",
    accentText: "#9ccdb8",
    accentSoft: "rgba(134, 184, 163, 0.12)",
    danger: "#d98a7a",
    tag: "#9ccdb8",
  },
  light: {
    bg: "#faf9f6",
    bgSidebar: "#f1efe9",
    bgHover: "#e9e6df",
    bgActive: "#dedbd2",
    bgInput: "#ffffff",
    text: "#2b2a27",
    textSecondary: "#6b6960",
    textTertiary: "#a8a59b",
    border: "#e3e0d8",
    accent: "#5e8a76",
    accentText: "#4a7461",
    accentSoft: "rgba(94, 138, 118, 0.14)",
    danger: "#c2553f",
    tag: "#4a7461",
  },
};
