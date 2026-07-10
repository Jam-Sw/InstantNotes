import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // sveltekit() is required so *.svelte.ts files compile their runes
  // ($state, etc, otherwise a bare "$state is not defined" at test time)
  // and so the $lib alias resolves the way it does in the real app.
  plugins: [sveltekit()],
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
  },
});
