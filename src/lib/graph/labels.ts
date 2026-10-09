// Which of the Graph's labels to draw this frame, and where, so no two cover
// each other: the most important go down first, each in the first of its
// spots (under its node, else over it) that is free, and a label with no free
// spot waits until the graph is turned or the pointer lights it.
import RBush from "rbush";

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Where a label's text is anchored (its baseline center) and the box it takes. */
interface Spot extends Box {
  x: number;
  y: number;
}

export interface LabelCandidate {
  id: string;
  /** Higher is placed first. */
  priority: number;
  /** Tried in order; the first free one is used. */
  spots: Spot[];
  pinned?: boolean;
}

export interface Disc {
  x: number;
  y: number;
  r: number;
}

/** Average glyph width and line height of a graph label, in layout units. */
const CHAR_WIDTH = 6.2;
const LINE_HEIGHT = 13;
const LABEL_CHARS = 28;

export function clampLabel(text: string): string {
  return text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS - 1)}…` : text;
}

/** A label of `text` with its baseline centered at (x, y). */
function spot(text: string, x: number, y: number): Spot {
  const half = (text.length * CHAR_WIDTH) / 2 + 2;
  return { x, y, minX: x - half, minY: y - LINE_HEIGHT + 3, maxX: x + half, maxY: y + 3 };
}

/**
 * A node's label: under the node (where it has always been drawn), else over
 * it. `x, y` is the node's center and `r` its drawn radius.
 */
export function nodeLabel(
  id: string,
  text: string,
  x: number,
  y: number,
  r: number,
  priority: number,
): LabelCandidate {
  const shown = clampLabel(text);
  return { id, priority, spots: [spot(shown, x, y + r + 12), spot(shown, x, y - r - 5)] };
}

/** Where each label that fits is drawn, best first; the rest are left out. */
export function placeLabels(
  candidates: LabelCandidate[],
  discs: Disc[] = [],
): Map<string, { x: number; y: number }> {
  const placed = new Map<string, { x: number; y: number }>();
  const tree = new RBush<Box>();
  const discTree = new RBush<Box>();
  discTree.load(
    discs.map((d) => ({ minX: d.x - d.r, minY: d.y - d.r, maxX: d.x + d.r, maxY: d.y + d.r })),
  );
  const order = [...candidates].sort((a, b) => b.priority - a.priority);
  for (const c of order) {
    const free = c.spots.find((s) => !tree.collides(s) && (c.pinned || !discTree.collides(s)));
    if (!free) continue;
    tree.insert(free);
    placed.set(c.id, { x: free.x, y: free.y });
  }
  return placed;
}
