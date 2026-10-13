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

export function reasonLine(reason: string): string {
  return reason ? reason[0].toUpperCase() + reason.slice(1) : "";
}

function latest(dates: (string | undefined)[]): string {
  return dates.reduce<string>((max, d) => (d && d > max ? d : max), EPOCH);
}

export function buildMergeNotes(review: MergeReview, known: Record<string, Note>): Note[] {
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
      body:
        copies === 1
          ? "1 note was on both devices, word for word. It is one note now."
          : `${copies} notes were on both devices, word for word. Each is one note now.`,
      createdAt: at,
      updatedAt: at,
    });
  }
  for (const pair of review.pairs) {
    const a = known[pair.a];
    const b = known[pair.b];
    const at = latest([a?.updatedAt, b?.updatedAt]);
    notes.push({
      ...base,
      id: pairNoteId(pair),
      title: a?.title || b?.title || "Untitled",
      body: reasonLine(pair.reason),
      createdAt: at,
      updatedAt: at,
    });
  }
  return notes;
}
