// Copy Excalidraw's fonts into static/excalidraw/ so whiteboards draw with
// them offline. Excalidraw otherwise fetches its fonts from a CDN, which the
// app's content security policy blocks by design: InstantNotes makes no
// network requests. The app points Excalidraw here through
// EXCALIDRAW_ASSET_PATH (src/lib/whiteboard/excalidraw.ts).
//
// Xiaolai, the hand-drawn CJK face, is left out: it is 12 MB of the 12.5,
// and would roughly double the app for one script's styling. CJK text on a
// board still renders, in the system's own CJK font.
//
// Runs before `npm run dev` and `npm run build` (the predev/prebuild
// scripts), so dev, CI, and release builds all carry the fonts. The copy is
// generated, not committed (.gitignore).

import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "@excalidraw", "excalidraw", "dist", "prod", "fonts");
const target = join(root, "static", "excalidraw", "fonts");

if (!existsSync(source)) {
  console.error(`Excalidraw fonts not found at ${source}. Run npm install.`);
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, {
  recursive: true,
  filter: (path) => basename(path) !== "Xiaolai",
});
const count = readdirSync(target, { recursive: true }).length;
console.log(`copied Excalidraw fonts (${count} entries) to static/excalidraw/fonts`);
