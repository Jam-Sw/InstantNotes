import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CHANGELOG = new URL("../CHANGELOG.md", import.meta.url);

export function section(md, name) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`## [${name}]`));
  if (start < 0) return "";
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## ["));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

export function notes(md, version) {
  return (
    section(md, version) ||
    section(md, "Unreleased") ||
    "Maintenance release. See the commit history for details."
  );
}

export const INSTALL_FOOTER = [
  "---",
  "First install on macOS: download the `.dmg`, open it, and drag InstantNotes to Applications. macOS blocks the first launch of this unnotarized build: run `xattr -d com.apple.quarantine /Applications/InstantNotes.app` or use System Settings > Privacy & Security > \"Open Anyway\".",
  "",
  "First install on Windows: download and run the `-setup.exe` installer. SmartScreen flags the unsigned build: click \"More info\", then \"Run anyway\".",
  "",
  "First install on Linux: download the `.AppImage`, make it executable (`chmod +x`), and run it.",
  "",
  "Existing installs update in place from inside the app.",
].join("\n");

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  if (!version) throw new Error("usage: release-notes.mjs <version>");
  const md = readFileSync(CHANGELOG, "utf8");
  process.stdout.write(`${notes(md, version)}\n\n${INSTALL_FOOTER}\n`);
}
