// Registry of built-in themes. Manuscript is first so it is the default.

import type { Theme } from "../types";
import { manuscript } from "./manuscript";
import { graphite } from "./graphite";
import { terminal } from "./terminal";
import { paperDark } from "./paper-dark";

export const BUILTIN_THEMES: Theme[] = [manuscript, graphite, terminal, paperDark];

/** The theme applied on first run and when a persisted id is missing. */
export const DEFAULT_THEME_ID = manuscript.id;

export { manuscript, graphite, terminal, paperDark };
