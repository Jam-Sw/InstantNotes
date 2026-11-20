import { getSetting, setSetting } from "$lib/api/client";

const KEY_LABELS = "graph.labels";
const KEY_NODE_SIZE = "graph.nodeSize";
const KEY_SPREAD = "graph.spread";
const KEY_HOPS = "graph.lensHops";

export type GraphLabels = "focus" | "all" | "none";

export const SCALE_RANGE = { min: 0.5, max: 2, step: 0.1 } as const;

const LABELS: readonly GraphLabels[] = ["focus", "all", "none"];

const isLabels = (v: unknown): v is GraphLabels => LABELS.includes(v as GraphLabels);
const isScale = (v: unknown): v is number =>
  typeof v === "number" && v >= SCALE_RANGE.min && v <= SCALE_RANGE.max;
const isHops = (v: unknown): v is number => v === 1 || v === 2 || v === 3;
const clampScale = (v: number) =>
  Math.min(SCALE_RANGE.max, Math.max(SCALE_RANGE.min, +v.toFixed(1)));

export const GRAPH_DEFAULTS: { labels: GraphLabels; nodeSize: number; spread: number; lensHops: number } = {
  labels: "focus",
  nodeSize: 1,
  spread: 1,
  lensHops: 2,
};

class GraphPrefs {
  labels = $state<GraphLabels>(GRAPH_DEFAULTS.labels);
  nodeSize = $state(GRAPH_DEFAULTS.nodeSize);
  spread = $state(GRAPH_DEFAULTS.spread);
  lensHops = $state(GRAPH_DEFAULTS.lensHops);

  #loaded = false;
  #touched = new Set<string>();

  async init(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const [labels, size, spread, hops] = await Promise.all([
        getSetting<string>(KEY_LABELS),
        getSetting<number>(KEY_NODE_SIZE),
        getSetting<number>(KEY_SPREAD),
        getSetting<number>(KEY_HOPS),
      ]);
      if (!this.#touched.has(KEY_LABELS) && isLabels(labels)) this.labels = labels;
      if (!this.#touched.has(KEY_NODE_SIZE) && isScale(size)) this.nodeSize = size;
      if (!this.#touched.has(KEY_SPREAD) && isScale(spread)) this.spread = spread;
      if (!this.#touched.has(KEY_HOPS) && isHops(hops)) this.lensHops = hops;
    } catch {
    }
  }

  async reload(): Promise<void> {
    this.#loaded = false;
    this.#touched.clear();
    await this.init();
  }

  setLabels(v: GraphLabels): void {
    this.#touched.add(KEY_LABELS);
    this.labels = v;
    void setSetting(KEY_LABELS, v);
  }

  setNodeSize(v: number): void {
    this.#touched.add(KEY_NODE_SIZE);
    this.nodeSize = clampScale(v);
    void setSetting(KEY_NODE_SIZE, this.nodeSize);
  }

  setSpread(v: number): void {
    this.#touched.add(KEY_SPREAD);
    this.spread = clampScale(v);
    void setSetting(KEY_SPREAD, this.spread);
  }

  setLensHops(v: number): void {
    this.#touched.add(KEY_HOPS);
    this.lensHops = v;
    void setSetting(KEY_HOPS, v);
  }
}

export const graphPrefs = new GraphPrefs();
