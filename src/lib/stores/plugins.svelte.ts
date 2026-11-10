import { getSetting, setSetting } from "$lib/api/client";
import { plugins } from "$lib/plugin";
import type { Plugin, PluginConfig, PrefSpec, Prefs } from "$lib/plugin/types";

const enabledKey = (p: Plugin): string => `plugin.${p.id}.enabled`;
const prefKey = (p: Plugin, spec: PrefSpec): string => `plugin.${p.id}.${spec.key}`;

class PluginPrefs {
  #enabled = $state<Record<string, boolean>>({});
  #values = $state<Record<string, string>>({});
  #loaded = false;
  #touched = new Set<string>();

  readonly config: PluginConfig = $derived.by(() => {
    const active = plugins.filter((p) => this.on(p));
    const prefs: Record<string, Prefs> = {};
    for (const p of active) {
      prefs[p.id] = Object.fromEntries((p.prefs ?? []).map((spec) => [spec.key, this.value(p, spec)]));
    }
    return { plugins: active, prefs };
  });

  on(p: Plugin): boolean {
    return this.#enabled[enabledKey(p)] ?? true;
  }

  value(p: Plugin, spec: PrefSpec): string {
    return this.#values[prefKey(p, spec)] ?? spec.default;
  }

  async init(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      await Promise.all(
        plugins.flatMap((p) => [
          getSetting<boolean>(enabledKey(p)).then((v) => {
            const key = enabledKey(p);
            if (!this.#touched.has(key) && typeof v === "boolean") this.#enabled[key] = v;
          }),
          ...(p.prefs ?? []).map((spec) =>
            getSetting<string>(prefKey(p, spec)).then((v) => {
              const key = prefKey(p, spec);
              if (!this.#touched.has(key) && spec.options.some((o) => o.value === v)) {
                this.#values[key] = v as string;
              }
            }),
          ),
        ]),
      );
    } catch {
    }
  }

  async reload(): Promise<void> {
    this.#loaded = false;
    this.#touched.clear();
    this.#enabled = {};
    this.#values = {};
    await this.init();
  }

  setOn(p: Plugin, v: boolean): void {
    const key = enabledKey(p);
    this.#touched.add(key);
    this.#enabled[key] = v;
    void setSetting(key, v);
  }

  setValue(p: Plugin, spec: PrefSpec, v: string): void {
    const key = prefKey(p, spec);
    this.#touched.add(key);
    this.#values[key] = v;
    void setSetting(key, v);
  }
}

export const pluginPrefs = new PluginPrefs();
