// Pure rendering for the Contexting copy template: turns a note plus its tags
// into a wrapped string a tool or model can consume. Kept free of runes so it is
// unit-testable and shared by the store, the copy command, and the settings
// preview. This is the first of a planned set of context/AI helpers.

import type { Note, Tag } from "$lib/api/types";

/** Default wrap: an XML-ish envelope carrying the note's metadata and body. */
export const DEFAULT_TEMPLATE = `<note title="{title}">\ntags: {tags}\n{content}\n</note>`;

/** Placeholders the template understands, surfaced in the settings UI. */
export const TEMPLATE_VARS = ["{title}", "{tags}", "{date}", "{content}"] as const;

/**
 * How images in the note body travel when the note is copied as context:
 * - `keep`: leave the markdown reference as written.
 * - `absolute`: rewrite stored-attachment references to their absolute file
 *   path, so a tool/agent that can read files finds the image.
 * - `strip`: remove images entirely for a text-only context.
 */
export type ContextImageMode = "keep" | "absolute" | "strip";

export const DEFAULT_IMAGE_MODE: ContextImageMode = "absolute";

const ATTACHMENT_PREFIX = "attachments/";
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

/**
 * Apply the image mode to a note body. `attachmentsDir` (absolute, no trailing
 * slash) is only needed for `absolute`; when it is missing, attachment
 * references are left as written rather than producing a broken path.
 */
export function applyImageMode(
  body: string,
  mode: ContextImageMode,
  attachmentsDir: string | null,
): string {
  if (mode === "keep") return body;
  if (mode === "strip") {
    // Drop the image and any now-empty line it left behind.
    return body.replace(IMAGE_RE, "").replace(/[^\S\n]+\n/g, "\n");
  }
  // absolute
  return body.replace(IMAGE_RE, (whole, alt: string, url: string) => {
    if (!url.startsWith(ATTACHMENT_PREFIX)) return whole;
    if (!attachmentsDir) return whole;
    const name = url.slice(ATTACHMENT_PREFIX.length);
    return `![${alt}](${attachmentsDir}/${name})`;
  });
}

export interface RenderOptions {
  imageMode?: ContextImageMode;
  /** Absolute attachments directory, required only for `absolute` image mode. */
  attachmentsDir?: string | null;
}

/**
 * Fill {title}, {tags}, {date}, {content} from a note and its tags. Tags render
 * as space-separated #hashtags to match how they are written in the editor;
 * {date} uses the note's last-updated date in the local format. Unknown
 * placeholders are left untouched. Images in the body are transformed per
 * `opts.imageMode` before {content} is substituted.
 */
export function renderTemplate(
  template: string,
  note: Pick<Note, "title" | "body" | "updatedAt">,
  tags: Pick<Tag, "name">[],
  opts: RenderOptions = {},
): string {
  const body = applyImageMode(
    note.body,
    opts.imageMode ?? "keep",
    opts.attachmentsDir ?? null,
  );
  const values: Record<string, string> = {
    title: note.title || "Untitled",
    tags: tags.map((t) => `#${t.name}`).join(" "),
    date: new Date(note.updatedAt).toLocaleDateString(),
    content: body,
  };
  return template.replace(/\{(title|tags|date|content)\}/g, (_, key: string) => values[key] ?? "");
}
