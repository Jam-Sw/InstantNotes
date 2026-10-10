import RBush from "rbush";

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Spot extends Box {
  x: number;
  y: number;
}

export interface LabelCandidate {
  id: string;
  priority: number;
  spots: Spot[];
  pinned?: boolean;
}

export interface Disc {
  x: number;
  y: number;
  r: number;
}

const CHAR_WIDTH = 6.2;
const LINE_HEIGHT = 13;
const LABEL_CHARS = 28;

export function clampLabel(text: string): string {
  return text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS - 1)}…` : text;
}

function spot(text: string, x: number, y: number): Spot {
  const half = (text.length * CHAR_WIDTH) / 2 + 2;
  return { x, y, minX: x - half, minY: y - LINE_HEIGHT + 3, maxX: x + half, maxY: y + 3 };
}

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
