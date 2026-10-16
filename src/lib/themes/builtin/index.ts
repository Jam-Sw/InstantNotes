import type { Theme } from "../types";
import { manuscript } from "./manuscript";
import { folio } from "./folio";
import { graphite } from "./graphite";
import { fjord } from "./fjord";
import { twilight } from "./twilight";
import { peony } from "./peony";
import { terminal } from "./terminal";
import { contrast } from "./contrast";
import { nightConsole } from "./night-console";

export const BUILTIN_THEMES: Theme[] = [
  manuscript,
  folio,
  graphite,
  fjord,
  twilight,
  peony,
  terminal,
  contrast,
  nightConsole,
];

export const DEFAULT_THEME_ID = manuscript.id;
