// Graphite - neutral, macOS-native feel: Apple's system gray scale, the system
// blue accent, and SF via the -apple-system stack. The closest InstantNotes
// theme to a conventional macOS app; the base layer the Tahoe glass builds on.
import type { Theme } from "../types";
import { SANS_STACK, MONO_STACK } from "../fonts";

export const graphite: Theme = {
  id: "graphite",
  name: "Graphite",
  author: "InstantNotes",
  version: 1,
  appearance: "dual",
  fonts: { ui: SANS_STACK, mono: MONO_STACK, body: "ui", meta: "ui" },
  metrics: { radius: "8px", density: 1.0 },
  dark: {
    bg: "#1d1d1f",
    bgSidebar: "#252527",
    bgHover: "#2d2d30",
    bgActive: "#38383b",
    bgInput: "#252527",
    text: "#ececef",
    textSecondary: "#98989d",
    textTertiary: "#636366",
    border: "#323234",
    accent: "#0a84ff",
    accentText: "#4d9fff",
    accentSoft: "rgba(10, 132, 255, 0.16)",
    danger: "#ff6b5e",
    tag: "#4d9fff",
  },
  light: {
    bg: "#ffffff",
    bgSidebar: "#f5f5f7",
    bgHover: "#ececee",
    bgActive: "#e3e3e6",
    bgInput: "#ffffff",
    text: "#1d1d1f",
    textSecondary: "#6e6e73",
    textTertiary: "#aeaeb2",
    border: "#d2d2d7",
    accent: "#007aff",
    accentText: "#0062cc",
    accentSoft: "rgba(0, 122, 255, 0.12)",
    danger: "#e0352b",
    tag: "#0062cc",
  },
};
