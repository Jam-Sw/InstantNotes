import type { SwatchSet } from "../types";

// Swatch palettes for the built-in themes, tuned by hand for each theme's
// character and for its light and dark grounds. Order: red orange yellow green
// teal blue purple pink grey.
function set(c: [string, string, string, string, string, string, string, string, string]): SwatchSet {
  const [red, orange, yellow, green, teal, blue, purple, pink, grey] = c;
  return { red, orange, yellow, green, teal, blue, purple, pink, grey };
}

export const MANUSCRIPT_SWATCHES = {
  dark: set(["#d98a7a", "#d9a066", "#d4b27c", "#86b8a3", "#7fb8b0", "#7fa6c9", "#a994c9", "#cf93a8", "#9a978f"]),
  light: set(["#c2553f", "#c47a35", "#a8782a", "#4f8268", "#3f8a86", "#4a7aa8", "#7d63a8", "#b45f7e", "#6b6960"]),
};

export const PAPER_DARK_SWATCHES = {
  dark: set(["#e07a5f", "#e0955a", "#e0b85f", "#a3b86c", "#7fb09a", "#7f9fbf", "#a58fb5", "#d4879b", "#9d9384"]),
  light: set(["#c2553f", "#b5703f", "#a87a1e", "#6b8a3a", "#3f8a78", "#4a73a0", "#7a5f98", "#b45f78", "#766c5e"]),
};

export const EMBER_SWATCHES = {
  dark: set(["#ec6f5e", "#f0a35a", "#f0cf6a", "#9cc77a", "#6fc2a8", "#78a9d9", "#b295d9", "#ee8aa5", "#a39a90"]),
  light: set(["#c7472f", "#c86f1f", "#b8891a", "#5d8b3a", "#2f8a74", "#3f76b0", "#7a58b0", "#c24f78", "#7a7066"]),
};

export const GRAPHITE_SWATCHES = {
  dark: set(["#ff453a", "#ff9f0a", "#ffd60a", "#32d74b", "#40c8e0", "#0a84ff", "#bf5af2", "#ff375f", "#98989d"]),
  light: set(["#ff3b30", "#ff9500", "#e6b800", "#28b446", "#00b3ab", "#007aff", "#af52de", "#ff2d55", "#8e8e93"]),
};

export const FJORD_SWATCHES = {
  dark: set(["#d9868d", "#dca06f", "#e6c27a", "#9ccf96", "#7fcbc4", "#7fb3d5", "#b09ad6", "#d890b4", "#9aa5b3"]),
  light: set(["#bf4a55", "#c0702f", "#b58a2d", "#4d8d4a", "#2f8a8a", "#3e7fa8", "#7660b0", "#b8587f", "#6c7785"]),
};

export const TWILIGHT_SWATCHES = {
  dark: set(["#ff6584", "#ffa268", "#f2c46d", "#7fd6a6", "#5fd3d0", "#6ea8ff", "#9d7cff", "#ff7ac0", "#9895ab"]),
  light: set(["#d92b4b", "#d4631a", "#a9781a", "#2f8f5b", "#1f8f94", "#2f6fe0", "#633ee6", "#d1389a", "#77738a"]),
};

export const TERMINAL_SWATCHES = {
  dark: set(["#ff5f56", "#ffa23e", "#ffbd2e", "#5fe3a1", "#3fe0d0", "#55b4ff", "#c08bff", "#ff7ac6", "#8a9a90"]),
  light: set(["#c5372c", "#c06a00", "#b07a00", "#0f9d58", "#0b9a8f", "#1a73c8", "#7b3fc4", "#c0338a", "#66756b"]),
};

export const CONTRAST_SWATCHES = {
  dark: set(["#ff6b6b", "#ffa040", "#ffe14d", "#66f07a", "#4de8e0", "#5aa9ff", "#c490ff", "#ff80c0", "#bdbdbd"]),
  light: set(["#b80000", "#a84800", "#7a5a00", "#1a6b1a", "#006868", "#0033cc", "#5a1ab8", "#a8005a", "#4a4a4a"]),
};

export const NIGHT_CONSOLE_SWATCHES = {
  dark: set(["#f08a80", "#f2b35c", "#e6d070", "#7fcf9a", "#6fc8c0", "#7fa8d8", "#b09ad8", "#e89ab8", "#8f969e"]),
  light: set(["#b3261e", "#b5541b", "#8f7000", "#2e6b4a", "#1f7570", "#2f64a0", "#6a4aa0", "#a8456f", "#5f666e"]),
};
