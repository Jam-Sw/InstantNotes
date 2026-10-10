import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const QUIET = {
  "src/lib/components/GraphView.svelte": ["a11y_no_static_element_interactions"],
  "src/lib/components/LicenseNote.svelte": ["a11y_no_noninteractive_tabindex"],
  "src/lib/components/SettingsView.svelte": ["state_referenced_locally"],
  "src/lib/components/sheet/SheetGrid.svelte": ["a11y_no_static_element_interactions"],
  "src/routes/+page.svelte": [
    "a11y_no_noninteractive_element_interactions",
    "a11y_no_noninteractive_tabindex",
  ],
  "src/routes/sticky/+page.svelte": ["a11y_no_static_element_interactions"],
};

const config = {
  preprocess: vitePreprocess(),
  compilerOptions: {
    warningFilter: (warning) =>
      !Object.entries(QUIET).some(
        ([file, codes]) =>
          warning.filename?.replaceAll("\\", "/").endsWith(file) && codes.includes(warning.code),
      ),
  },
  kit: {
    adapter: adapter({
      fallback: "index.html",
    }),
  },
};

export default config;
