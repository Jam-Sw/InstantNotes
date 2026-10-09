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
