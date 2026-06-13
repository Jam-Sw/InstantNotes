// Graphite - neutral, modern, blue accent. The closest to a conventional
// macOS app: clean greys, a familiar system blue. Light variant is the clean
// macOS-adjacent light the app originally shipped, recolored in blue.

import type { Theme } from "../types";
import { SANS_STACK, MONO_STACK } from "../fonts";

export const graphite: Theme = {
  id: "graphite",
  name: "Graphite",
  author: "InstantNotes",
  version: 1,
  appearance: "dual",
  fonts: { ui: SANS_STACK, mono: MONO_STACK, body: "ui", meta: "ui" },
  metrics: { radius: "7px", density: 1.0 },
  dark: {
    bg: "#1d1d21",
    bgSidebar: "#232328",
    bgHover: "#2b2b31",
    bgActive: "#34343b",
    bgInput: "#232328",
    text: "#e6e6ea",
    textSecondary: "#9a9aa2",
    textTertiary: "#65656d",
    border: "#303036",
    accent: "#5e9bff",
    accentText: "#7fb0ff",
    accentSoft: "rgba(94, 155, 255, 0.16)",
    danger: "#ff6b5e",
    tag: "#7fb0ff",
  },
  light: {
    bg: "#ffffff",
    bgSidebar: "#f5f5f7",
    bgHover: "#ececef",
    bgActive: "#e1e1e6",
    bgInput: "#ffffff",
    text: "#1d1d1f",
    textSecondary: "#6e6e73",
    textTertiary: "#aeaeb2",
    border: "#e3e3e6",
    accent: "#2f7bf6",
    accentText: "#1f6fe8",
    accentSoft: "rgba(47, 123, 246, 0.12)",
    danger: "#e0352b",
    tag: "#1f6fe8",
  },
};
