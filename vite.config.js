import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";

const host = process.env.TAURI_DEV_HOST;

/** @returns {import("vite").Plugin} */
function noStore() {
  return {
    name: "tauri-dev-no-store",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        const set = res.setHeader.bind(res);
        res.setHeader = /** @type {typeof res.setHeader} */ (
          (/** @type {string} */ name, /** @type {any} */ value) =>
            set(name, name.toLowerCase() === "cache-control" ? "no-store" : value)
        );
        next();
      });
    },
  };
}

export default defineConfig(async () => ({
  plugins: [sveltekit(), noStore()],

  clearScreen: false,
  server: {
    port: 1422,
    strictPort: true,
    host: host || false,
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
