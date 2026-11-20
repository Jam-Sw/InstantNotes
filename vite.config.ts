import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";

const host = process.env.TAURI_DEV_HOST;

function preserveBundledLicenses(): Plugin {
  const cache = new Map<string, string | null>();
  const readPkgLicense = (pkgRoot: string): string | null => {
    if (cache.has(pkgRoot)) return cache.get(pkgRoot)!;
    for (const file of ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE"]) {
      const full = path.join(pkgRoot, file);
      if (fs.existsSync(full)) {
        const text = fs.readFileSync(full, "utf8").trim().replace(/\*\//g, "* /");
        cache.set(pkgRoot, text);
        return text;
      }
    }
    cache.set(pkgRoot, null);
    return null;
  };

  return {
    name: "preserve-bundled-licenses",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk") continue;
        const seenRoots = new Set<string>();
        const notices: string[] = [];
        for (const modId of item.moduleIds) {
          const clean = modId.split("?")[0].replace(/\\/g, "/");
          const idx = clean.lastIndexOf("/node_modules/");
          if (idx === -1) continue;
          const after = clean.slice(idx + "/node_modules/".length);
          const parts = after.split("/");
          const pkgName = parts[0]?.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
          if (!pkgName) continue;
          const pkgRoot = path.join(clean.slice(0, idx), "node_modules", pkgName);
          if (seenRoots.has(pkgRoot)) continue;
          seenRoots.add(pkgRoot);
          const lic = readPkgLicense(pkgRoot);
          if (lic) notices.push(`@pkg ${pkgName}\n${lic}`);
        }
        if (notices.length > 0) {
          item.code = `/*!\n${notices.join("\n\n---\n\n")}\n*/\n${item.code}`;
        }
      }
    },
  };
}

function noStore(): Plugin {
  return {
    name: "tauri-dev-no-store",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        const set = res.setHeader.bind(res);
        res.setHeader = ((name: string, value: Parameters<typeof set>[1]) =>
          set(name, name.toLowerCase() === "cache-control" ? "no-store" : value)) as typeof res.setHeader;
        next();
      });
    },
  };
}

const SVELTE_STYLE = /^([^?]+\.svelte)\?svelte&type=style(?:&|$)/;

function compileBeforeStyle(): Plugin {
  return {
    name: "tauri-dev-compile-before-style",
    apply: "serve",
    enforce: "pre",
    async load(id) {
      const file = SVELTE_STYLE.exec(id)?.[1];
      if (!file || this.environment.mode !== "dev") return;
      if (this.getModuleInfo(file)?.meta?.svelte?.css) return;
      await this.environment.transformRequest(`/@fs/${file.replace(/^\//, "")}`);
    },
  };
}

export default defineConfig(async () => ({
  plugins: [compileBeforeStyle(), sveltekit(), preserveBundledLicenses(), noStore()],

  clearScreen: false,
  server: {
    port: 1422,
    strictPort: true,
    host: host || false,
    fs: {
      allow: ["src-tauri/installer", "CHANGELOG.md"],
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1423,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
