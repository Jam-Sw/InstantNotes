import type { Note, Tag } from "$lib/api/types";

export const DEFAULT_TEMPLATE = `<note title="{title}">\ntags: {tags}\n{content}\n</note>`;

export const TEMPLATE_VARS = ["{title}", "{tags}", "{date}", "{content}"] as const;

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

export interface RenderOptions {
  imageMode?: ContextImageMode;
  attachmentsDir?: string | null;
}

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
