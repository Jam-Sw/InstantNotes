import type { Plugin, PluginConfig, Prefs, Region, Result, View } from "./types";

const found = import.meta.glob<{ default: Plugin }>("/src/plugins/*/index.ts", { eager: true });

export const plugins: readonly Plugin[] = Object.values(found)
  .map((m) => m.default)
  .filter((p) => p.api === 1);

export function runPlugin(plugin: Plugin, regions: readonly Region[], prefs: Prefs): readonly Result[] {
  try {
    return plugin.run(regions, prefs);
  } catch (e) {
    console.error(`plugin ${plugin.id}`, e);
    return [];
  }
}

export function sheetViews(config: PluginConfig, rows: readonly (readonly string[])[]): Map<number, View> {
  const out = new Map<number, View>();
  const plugin = config.plugins.find((p) => p.cells);
  if (!plugin) return out;
  const [res] = runPlugin(plugin, [{ kind: "table", rows, header: false }], config.prefs[plugin.id] ?? {});
  for (const o of res?.out ?? []) if (o.views[0]) out.set(o.at, o.views[0]);
  return out;
}
