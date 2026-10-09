import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { INSTALL_FOOTER, notes } from "./release-notes.mjs";

export const PLATFORMS = [
  { name: "Linux", file: (v) => `InstantNotes_${v}_amd64.AppImage`, keys: ["linux-x86_64", "linux-x86_64-appimage"] },
  { name: "Windows", file: (v) => `InstantNotes_${v}_x64-setup.exe`, keys: ["windows-x86_64", "windows-x86_64-nsis"] },
  { name: "macOS", file: (v) => `InstantNotes_${v}_aarch64.app.tar.gz`, keys: ["darwin-aarch64", "darwin-aarch64-app"] },
];

export function manifest({ version, assets, repo, body, signature, now }) {
  const platforms = {};
  const missing = [];
  for (const p of PLATFORMS) {
    const file = p.file(version);
    if (!assets.includes(file) || !assets.includes(`${file}.sig`)) {
      missing.push(p.name);
      continue;
    }
    const entry = {
      signature: signature(`${file}.sig`).trim(),
      url: `https://github.com/${repo}/releases/download/v${version}/${file}`,
    };
    for (const key of p.keys) platforms[key] = entry;
  }
  return { latest: { version, notes: body, pub_date: now, platforms }, missing };
}

function gh(...args) {
  return execFileSync("gh", args, { encoding: "utf8" });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  if (!version) throw new Error("usage: release-manifest.mjs <version>");
  const tag = `v${version}`;
  const repo = process.env.GITHUB_REPOSITORY ?? "Jam-Sw/InstantNotes";
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const body = notes(changelog, version);
  const assets = JSON.parse(gh("release", "view", tag, "--json", "assets")).assets.map((a) => a.name);

  const { latest, missing } = manifest({
    version,
    assets,
    repo,
    body,
    signature: (file) => gh("release", "download", tag, "--pattern", file, "--output", "-"),
    now: new Date().toISOString(),
  });
  if (Object.keys(latest.platforms).length === 0) {
    console.error(`::error::no platform uploaded an artifact for ${tag}; leaving it a draft`);
    process.exit(1);
  }

  writeFileSync("latest.json", `${JSON.stringify(latest, null, 2)}\n`);
  gh("release", "upload", tag, "latest.json", "--clobber");

  const pending = missing.length
    ? `\n\nNot in this release yet: ${missing.join(", ")}. Those installs stay on their current version until it is added.`
    : "";
  writeFileSync("notes.md", `${body}${pending}\n\n${INSTALL_FOOTER}\n`);
  gh("release", "edit", tag, "--notes-file", "notes.md", "--draft=false", "--latest");
  console.log(`${tag} published: ${PLATFORMS.length - missing.length}/${PLATFORMS.length} platforms${missing.length ? ` (missing ${missing.join(", ")})` : ""}`);
}
