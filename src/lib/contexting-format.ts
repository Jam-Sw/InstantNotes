import type { Note, Tag } from "$lib/api/types";

export const DEFAULT_TEMPLATE = `<note title="{title}">\ntags: {tags}\n{content}\n</note>`;

export const TEMPLATE_VARS = [
  "{title}",
  "{tags}",
  "{date}",
  "{content}",
  "{id}",
  "{copied}",
] as const;

export const DEFAULT_SOURCE_LINE = true;

export type ContextImageMode = "keep" | "absolute" | "strip";

export const DEFAULT_IMAGE_MODE: ContextImageMode = "absolute";

const ATTACHMENT_PREFIX = "attachments/";
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

export function applyImageMode(
  body: string,
  mode: ContextImageMode,
  attachmentsDir: string | null,
): string {
  if (mode === "keep") return body;
  if (mode === "strip") {
    return body.replace(IMAGE_RE, "").replace(/[^\S\n]+\n/g, "\n");
  }
  return body.replace(IMAGE_RE, (whole, alt: string, url: string) => {
    if (!url.startsWith(ATTACHMENT_PREFIX)) return whole;
    if (!attachmentsDir) return whole;
    const name = url.slice(ATTACHMENT_PREFIX.length);
    return `![${alt}](${attachmentsDir}/${name})`;
  });
}

interface RenderOptions {
  imageMode?: ContextImageMode;
  attachmentsDir?: string | null;
  /** When the copy happens; fills {copied}. Defaults to now. */
  copiedAt?: Date;
}

/** The note id an agent passes to get_note over MCP: the same notes.id the app holds. */
export function sourceLine(note: Pick<Note, "id">, copiedAt: Date): string {
  return `From InstantNotes ${copiedAt.toLocaleString()} · id ${note.id}`;
}

export function renderTemplate(
  template: string,
  note: Pick<Note, "id" | "title" | "body" | "updatedAt">,
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
    id: note.id,
    copied: (opts.copiedAt ?? new Date()).toLocaleString(),
  };
  return template.replace(/\{(title|tags|date|content|id|copied)\}/g, (_, key: string) => values[key] ?? "");
}

interface ContextOptions extends RenderOptions {
  addSourceLine?: boolean;
}

/** The rendered template, then the provenance footer when it is on. */
export function renderContext(
  template: string,
  note: Pick<Note, "id" | "title" | "body" | "updatedAt">,
  tags: Pick<Tag, "name">[],
  opts: ContextOptions = {},
): string {
  const copiedAt = opts.copiedAt ?? new Date();
  const out = renderTemplate(template, note, tags, { ...opts, copiedAt });
  return opts.addSourceLine ?? DEFAULT_SOURCE_LINE
    ? `${out}\n\n${sourceLine(note, copiedAt)}`
    : out;
}

/** Several notes copied at once, each its own block, in the order given. */
export function joinContexts(blocks: string[]): string {
  return blocks.join("\n\n");
}
