import { getSetting, pluginHttpCancel, pluginHttpPost, pluginReadText, setSetting } from "$lib/api/client";
import { isWeb } from "$lib/api/runtime";
import { plugins } from "$lib/plugin";
import { toasts } from "$lib/stores/toasts.svelte";
import { prefShown, type Host, type Plugin, type PluginConfig, type PrefSpec, type Prefs } from "$lib/plugin/types";

const SETTINGS = "Settings > Editor > More";
const TEXT_LIMIT = 2000;

const enabledKey = (p: Plugin): string => `plugin.${p.id}.enabled`;
const prefKey = (p: Plugin, spec: PrefSpec): string => `plugin.${p.id}.${spec.key}`;

const valid = (spec: PrefSpec, v: unknown): v is string =>
  typeof v === "string" &&
  (spec.kind === "text" || spec.kind === "file"
    ? v.length <= TEXT_LIMIT
    : (spec.options ?? []).some((o) => o.value === v));

let posts = 0;

async function post(url: string, body: string, signal?: AbortSignal): Promise<string> {
  if (!isWeb) {
    const id = ++posts;
    const stop = (): void => void pluginHttpCancel(id).catch(() => {});
    signal?.addEventListener("abort", stop, { once: true });
    try {
      return await pluginHttpPost(id, url, body);
    } finally {
      signal?.removeEventListener("abort", stop);
    }
  }
  const reply = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal,
  });
  if (!reply.ok) throw new Error(`${url} answered ${reply.status}`);
  return reply.text();
}

class PluginPrefs {
  #enabled = $state<Record<string, boolean>>({});
  #values = $state<Record<string, string>>({});
  #epoch = $state(0);
  #loaded = false;
  #touched = new Set<string>();

  readonly host: Host = {
    readText: (path) => (isWeb ? Promise.reject(new Error("files are desktop only")) : pluginReadText(path)),
    post,
    notify: (message) => toasts.show(message),
    refresh: () => {
      this.#epoch++;
    },
  };

  readonly config: PluginConfig = $derived.by(() => {
    void this.#epoch;
    const active = plugins.filter((p) => this.on(p));
    const prefs: Record<string, Prefs> = {};
    for (const p of active) prefs[p.id] = this.prefs(p);
    const off = plugins
      .filter((p) => !this.on(p))
      .map((p) => ({
        label: p.label,
        fences: Array.isArray(p.fences) ? p.fences : [],
      }));
    return {
      plugins: active,
      prefs,
      context: { off, settings: SETTINGS, host: this.host },
    };
  });

  on(p: Plugin): boolean {
    return this.#enabled[enabledKey(p)] ?? true;
  }

  value(p: Plugin, spec: PrefSpec): string {
    return this.#values[prefKey(p, spec)] ?? spec.default;
  }

  prefs(p: Plugin): Prefs {
    return Object.fromEntries((p.prefs ?? []).map((spec) => [spec.key, this.value(p, spec)]));
  }

  shown(p: Plugin, spec: PrefSpec): boolean {
    return !(isWeb && spec.kind === "file") && prefShown(spec, this.prefs(p));
  }

  async #read(): Promise<void> {
    const enabled: Record<string, boolean> = {};
    const values: Record<string, string> = {};
    await Promise.allSettled(
      plugins.flatMap((p) => [
        getSetting<boolean>(enabledKey(p)).then((v) => {
          if (typeof v === "boolean") enabled[enabledKey(p)] = v;
        }),
        ...(p.prefs ?? []).map((spec) =>
          getSetting<string>(prefKey(p, spec)).then((v) => {
            if (valid(spec, v)) values[prefKey(p, spec)] = v;
          }),
        ),
      ]),
    );
    for (const key of this.#touched) {
      if (key in this.#enabled) enabled[key] = this.#enabled[key];
      if (key in this.#values) values[key] = this.#values[key];
    }
    this.#enabled = enabled;
    this.#values = values;
  }

  async init(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    await this.#read();
  }

  async reload(): Promise<void> {
    this.#loaded = true;
    this.#touched.clear();
    await this.#read();
  }

  setOn(p: Plugin, v: boolean): void {
    const key = enabledKey(p);
    this.#touched.add(key);
    this.#enabled[key] = v;
    void setSetting(key, v);
  }

  setValue(p: Plugin, spec: PrefSpec, v: string): void {
    if (!valid(spec, v)) return;
    const key = prefKey(p, spec);
    this.#touched.add(key);
    this.#values[key] = v;
    void setSetting(key, v);
  }
}

export const pluginPrefs = new PluginPrefs();
