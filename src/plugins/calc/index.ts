import { compileLine, errorText, runBlock, type Precision, type Scope, type Value } from "$lib/calc/engine";
import { formatGrid, formatValue } from "$lib/calc/format";
import { evaluateGrid, isFormula } from "$lib/calc/table";
import { Figures, sameFigure, type Figure } from "$lib/calc/plot";
import { mountFigure } from "$lib/graphics/figure-view";
import type { Out, Plugin, Prefs, Region, Result, View } from "$lib/plugin/types";

class Env implements Scope {
  readonly vars = new Map<string, Value>();
  precision: Precision = "short";
  draw?: Figures;
  get(name: string): Value | undefined {
    return this.vars.get(name);
  }
  set(name: string, value: Value): void {
    this.vars.set(name, value);
  }
}

function part(value: Value, precision: Precision): View {
  return { text: formatValue(value, precision), error: false, grid: formatGrid(value, precision) };
}

function errorPart(text: string): View {
  return { text, error: true, grid: null };
}

function runLine(src: string, env: Env): View[] {
  const views: View[] = [];
  try {
    for (const st of compileLine(src)) {
      if (st.format) {
        env.precision = st.format;
        continue;
      }
      const v = st.run(env);
      if (!st.suppressed && !st.draw) views.push(part(v, env.precision));
    }
  } catch (e) {
    views.push(errorPart(errorText(e)));
  }
  return views;
}

function fence(lines: readonly string[], env: Env): Result {
  env.draw = new Figures();
  const res = runBlock(lines, env, env.precision);
  env.precision = res.precision;
  const byLine = new Map<number, View[]>();
  for (const o of res.outcomes) {
    const arr = byLine.get(o.line) ?? [];
    if (o.error !== undefined) arr.push(errorPart(o.error));
    else if (o.value !== undefined) arr.push(part(o.value, o.precision));
    byLine.set(o.line, arr);
  }
  const out: Out[] = [];
  for (const [at, views] of byLine) if (views.length > 0) out.push({ at, views });
  const figures = env.draw.list();
  env.draw = undefined;
  return { out, blocks: figures.map((f) => ({ id: f.id, data: f })) };
}

function table(rows: readonly (readonly string[])[], header: boolean, env: Env): Result {
  const out: Out[] = [];
  for (const [at, o] of evaluateGrid(rows, header, env, env.precision)) {
    out.push({ at, views: [o.error ? errorPart(o.text) : part(o.value as Value, env.precision)] });
  }
  return { out };
}

function run(regions: readonly Region[], prefs: Prefs): Result[] {
  const env = new Env();
  env.precision = prefs.precision === "long" ? "long" : "short";
  return regions.map((region) => {
    switch (region.kind) {
      case "fence":
        return fence(region.lines, env);
      case "inline":
        return { out: [{ at: 0, views: runLine(region.text.slice(1), env) }] };
      case "table":
        return table(region.rows, region.header, env);
    }
  });
}

const plugin: Plugin = {
  id: "calc",
  label: "Calc",
  api: 1,
  fences: ["calc", "matlab", "m"],
  inline: { prefix: "=", test: isFormula },
  cells: { prefix: "=", test: isFormula },
  prefs: [
    {
      key: "precision",
      label: "Calc precision",
      options: [
        { value: "short", label: "Short" },
        { value: "long", label: "Long" },
      ],
      default: "short",
    },
  ],
  theme: {
    ".cm-figure": {
      position: "relative",
      display: "block",
      width: "100%",
      touchAction: "none",
      cursor: "grab",
      userSelect: "none",
      WebkitUserSelect: "none",
      WebkitTouchCallout: "none",
    },
    ".cm-figure.cm-figure-grabbing, .cm-figure.cm-figure-grabbing *": {
      cursor: "grabbing !important",
    },
    ".cm-figure-plotly": {
      width: "100%",
      overflow: "hidden",
    },
    ".cm-figure svg": {
      display: "block",
      width: "100%",
      height: "auto",
    },
    ".cm-figure polyline": {
      fill: "none",
      strokeLinejoin: "round",
      strokeLinecap: "round",
    },
    ".cm-figure-frame polyline": {
      stroke: "var(--text-tertiary)",
      strokeWidth: "1",
    },
    ".cm-figure-lines polyline": {
      strokeWidth: "1.75",
    },
    ".cm-figure-labels text": {
      fill: "var(--text-secondary)",
      fontFamily: "var(--font-meta)",
      fontSize: "10.5px",
    },
  },
  block: {
    same: (a, b) => sameFigure(a as Figure, b as Figure),
    mount(data) {
      const h = mountFigure(data as Figure);
      return { el: h.el, update: (next) => h.update(next as Figure), destroy: () => h.destroy() };
    },
  },
  run,
};

export default plugin;
