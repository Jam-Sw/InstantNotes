import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";

const host = process.env.TAURI_DEV_HOST;

// The macOS WKWebView (used by `tauri dev`) caches dev-server modules and serves
// them stale across reloads/restarts, so the native window can show an old build
// while a browser on the same server shows the new one. Force `no-store` on every
// dev response - wrapping setHeader so it wins even over Vite's own cache headers -
// so no webview cache layer can ever replay an old module. Localhost only, so the
// re-fetch cost is negligible.
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

  // Keep Rust errors visible while running the desktop app.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
