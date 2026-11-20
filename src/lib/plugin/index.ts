import { NO_CONTEXT, type Context, type Plugin, type PluginConfig, type Prefs, type Region, type Result, type View } from "./types";

const found = import.meta.glob<{ default: Plugin }>("/src/plugins/*/index.ts", { eager: true });

export const plugins: readonly Plugin[] = Object.values(found)
  .map((m) => m.default)
  .filter((p) => p.api === 1);

export function runPlugin(
  plugin: Plugin,
  regions: readonly Region[],
  prefs: Prefs,
  context: Context = NO_CONTEXT,
): readonly Result[] {
  try {
    return plugin.run(regions, prefs, context);
  } catch (e) {
    console.error(`plugin ${plugin.id}`, e);
    return [];
  }
}

export function sheetViews(config: PluginConfig, rows: readonly (readonly string[])[]): Map<number, View> {
  const out = new Map<number, View>();
  const plugin = config.plugins.find((p) => p.cells);
  if (!plugin) return out;
  const [res] = runPlugin(
    plugin,
    [{ kind: "table", rows, header: false }],
    config.prefs[plugin.id] ?? {},
    config.context,
  );
  for (const o of res?.out ?? []) if (o.views[0]) out.set(o.at, o.views[0]);
  return out;
}
