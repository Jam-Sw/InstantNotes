import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // sveltekit() is required so *.svelte.ts files compile their runes
  // ($state, etc, otherwise a bare "$state is not defined" at test time)
  // and so the $lib alias resolves the way it does in the real app.
  plugins: [sveltekit()],
  // Resolve Svelte's browser build so component tests can mount (jsdom). The
  // pure-helper and store tests are unaffected: they run the same in jsdom.
  resolve: { conditions: ["browser"] },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "jsdom",
  },
});
