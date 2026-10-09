import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
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
