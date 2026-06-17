// Twilight - deep cosmic indigo and electric violet. A luxurious, modern theme
// that provides an elegant alternative to flat neutrals, with rich contrast.
import type { Theme } from "../types";
import { SANS_STACK, MONO_STACK } from "../fonts";

export const twilight: Theme = {
  id: "twilight",
  name: "Twilight",
  author: "InstantNotes",
  version: 1,
  appearance: "dual",
  fonts: { ui: SANS_STACK, mono: MONO_STACK, body: "ui", meta: "ui" },
  metrics: { radius: "6px", density: 1.0 },
  // Tahoe glass: native macOS sidebar vibrancy, tinted by the indigo bgSidebar
  // alpha. Falls back to a near-solid panel off macOS.
  material: "sidebar",
  dark: {
    bg: "#12111a",
    bgSidebar: "rgba(23, 22, 34, 0.55)",
    bgHover: "#222030",
    bgActive: "#2d2b40",
    bgInput: "#171622",
    text: "#e3e1ec",
    textSecondary: "#9c99aa",
    textTertiary: "#625f73",
    border: "#262436",
    accent: "#9d7cff",
    accentText: "#bca6ff",
    accentSoft: "rgba(157, 124, 255, 0.16)",
    danger: "#ff6584",
    tag: "#bca6ff",
  },
  light: {
    bg: "#f9f8fc",
    bgSidebar: "rgba(240, 238, 245, 0.6)",
    bgHover: "#e5e2ed",
    bgActive: "#dad5e3",
    bgInput: "#ffffff",
    text: "#1b1924",
    textSecondary: "#646073",
    textTertiary: "#aba7ba",
    border: "#e4e1eb",
    accent: "#633ee6",
    accentText: "#4f2ec2",
    accentSoft: "rgba(99, 62, 230, 0.12)",
    danger: "#d92b4b",
    tag: "#4f2ec2",
  },
};