import { defineConfig, type Plugin } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";

const host = process.env.TAURI_DEV_HOST;

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
  plugins: [compileBeforeStyle(), sveltekit(), noStore()],

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
