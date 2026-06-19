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
 * Fill {title}, {tags}, {date}, {content} from a note and its tags. Tags render
 * as space-separated #hashtags to match how they are written in the editor;
 * {date} uses the note's last-updated date in the local format. Unknown
 * placeholders are left untouched.
 */
export function renderTemplate(
  template: string,
  note: Pick<Note, "title" | "body" | "updatedAt">,
  tags: Pick<Tag, "name">[],
): string {
  const values: Record<string, string> = {
    title: note.title || "Untitled",
    tags: tags.map((t) => `#${t.name}`).join(" "),
    date: new Date(note.updatedAt).toLocaleDateString(),
    content: note.body,
  };
  return template.replace(/\{(title|tags|date|content)\}/g, (_, key: string) => values[key] ?? "");
}
