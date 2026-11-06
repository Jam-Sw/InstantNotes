import type { MergeReview, Note } from "$lib/api/types";

export const MERGE_SPACE_ID = "merge-space";
export const MERGE_SPACE_NAME = "Review merge";
export const COPIES_NOTE_ID = "merge-copies";
const PAIR_PREFIX = "merge-pair:";

const EPOCH = "1970-01-01T00:00:00.000Z";

export type MergePair = MergeReview["pairs"][number];

export function isMergeSpaceId(id: string | null | undefined): boolean {
  return id === MERGE_SPACE_ID;
}

export function isMergeNoteId(id: string | null | undefined): boolean {
  return !!id && (id === COPIES_NOTE_ID || id.startsWith(PAIR_PREFIX));
}

export function pairNoteId(pair: MergePair): string {
  return `${PAIR_PREFIX}${pair.a}:${pair.b}`;
}

function reasonLine(reason: string): string {
  return reason ? reason[0].toUpperCase() + reason.slice(1) : "";
}

const COPY_REASON = "changed in two places";
const CONFLICT_SUFFIX = / \(conflict ([^)]*)\)$/;
const CONFLICT_TAG = "conflict";

export interface Labels {
  tags: string[];
  spaces: string[];
}

export function baseTitle(title: string): string {
  return title.replace(CONFLICT_SUFFIX, "");
}

export function copiedAt(title: string): string | null {
  return title.match(CONFLICT_SUFFIX)?.[1] ?? null;
}

export function sideNames(reason: string): [string, string] {
  return reason === COPY_REASON ? ["Original", "Copy"] : ["Server", "This device"];
}

export function ownTags(labels: Labels): string[] {
  return labels.tags.filter((t) => t !== CONFLICT_TAG);
}

const sameSet = (x: string[], y: string[]) =>
  x.length === y.length && x.every((v) => y.includes(v));

export function differences(a: Note, b: Note, la: Labels, lb: Labels, reason = ""): string[] {
  const out: string[] = [];
  if (a.body !== b.body) out.push("text");
  if (baseTitle(a.title) !== baseTitle(b.title)) out.push("title");
  if (!sameSet(ownTags(la), ownTags(lb))) out.push("tags");
  if (!sameSet(la.spaces, lb.spaces)) out.push("Spaces");
  if (reason !== COPY_REASON && a.isPinned !== b.isPinned) out.push("pin");
  if (a.isArchived !== b.isArchived) out.push("archive");
  return out;
}

export function differenceLabel(parts: string[]): string {
  if (parts.length === 0) return "No difference";
  const list =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const plural = parts.length > 1 || parts[0] === "tags" || parts[0] === "Spaces";
  return `${list[0].toUpperCase()}${list.slice(1)} ${plural ? "differ" : "differs"}`;
}

function latest(dates: (string | undefined)[]): string {
  return dates.reduce<string>((max, d) => (d && d > max ? d : max), EPOCH);
}

export function buildMergeNotes(
  review: MergeReview,
  known: Record<string, Note>,
  labels: Record<string, Labels> = {},
): Note[] {
  const base = {
    isPinned: false,
    isArchived: false,
    isDeleted: false,
    contentKind: "document" as const,
  };
  const notes: Note[] = [];
  const copies = review.combined.length;
  if (copies > 0) {
    const at = latest(review.combined.map((c) => known[c.kept]?.updatedAt));
    notes.push({
      ...base,
      id: COPIES_NOTE_ID,
      title: "Exact copies combined",
      body: copies === 1 ? "1 identical note merged" : `${copies} identical notes merged`,
      createdAt: at,
      updatedAt: at,
    });
  }
  for (const pair of review.pairs) {
    const a = known[pair.a];
    const b = known[pair.b];
    const la = labels[pair.a];
    const lb = labels[pair.b];
    const at = latest([a?.updatedAt, b?.updatedAt]);
    notes.push({
      ...base,
      id: pairNoteId(pair),
      title: baseTitle(a?.title || b?.title || "") || "Untitled",
      body: a && b && la && lb ? differenceLabel(differences(a, b, la, lb, pair.reason)) : reasonLine(pair.reason),
      createdAt: at,
      updatedAt: at,
    });
  }
  return notes;
}
