import type { Theme } from "../types";
import { manuscript } from "./manuscript";
import { paperDark } from "./paper-dark";
import { ember } from "./ember";
import { graphite } from "./graphite";
import { fjord } from "./fjord";
import { twilight } from "./twilight";
import { terminal } from "./terminal";
import { contrast } from "./contrast";

export const BUILTIN_THEMES: Theme[] = [
  manuscript,
  paperDark,
  ember,
  graphite,
  fjord,
  twilight,
  terminal,
  contrast,
];

export const DEFAULT_THEME_ID = manuscript.id;
