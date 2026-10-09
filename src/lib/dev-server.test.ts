import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createServer } from "vite";
import { describe, expect, it } from "vitest";
import viteConfig from "../../vite.config";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const RELATIVE_IMPORT = /(?:from\s*|import\s*\(?\s*)["'](\.[^"']*)["']/g;

function appSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return appSources(path);
    return /\.(ts|js|svelte)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

function importsOutsideSrc(): string[] {
  const found = new Set<string>();
  for (const file of appSources(SRC)) {
    for (const [, specifier] of readFileSync(file, "utf8").matchAll(RELATIVE_IMPORT)) {
      const target = resolve(dirname(file), specifier.split("?")[0]);
      if (!target.startsWith(SRC + sep)) found.add(relative(ROOT, target));
    }
  }
  return [...found].sort();
}

describe("dev server file access", () => {
  it("lets the dev server serve every file the app imports from outside src", async () => {
    const config = await viteConfig({ command: "serve", mode: "development" });
    const allowed = (config.server?.fs?.allow ?? []).map((entry) => resolve(ROOT, entry));
    const refused = importsOutsideSrc().filter((file) => {
      const path = resolve(ROOT, file);
      return !allowed.some((entry) => path === entry || path.startsWith(entry + sep));
    });
    expect(refused).toEqual([]);
  });
});

describe("dev server component styles", () => {
  it("serves a component's style when the web view asks for it before the component", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "instantnotes-vite-"));
    const server = await createServer({
      configFile: join(ROOT, "vite.config.ts"),
      cacheDir,
      logLevel: "silent",
      server: { port: 0, strictPort: false, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    try {
      const style = await server.environments.client.transformRequest(
        "/src/lib/components/LicenseLocked.svelte?svelte&type=style&lang.css",
      );
      expect(style?.code).toContain(".locked.svelte-");
    } finally {
      await server.close();
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 30_000);
});
