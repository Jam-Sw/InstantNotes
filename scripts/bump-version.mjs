#!/usr/bin/env node
// Bump the app version in every file that must stay in lockstep, in one shot,
// so a release can never ship with the manifests disagreeing.
//
//   npm run bump 0.6.0
//
// Updates: package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, and
// the instantnotes entry in src-tauri/Cargo.lock. The core crate
// (src-tauri/core) versions independently and is intentionally left untouched.
// Prints the next steps (commit, tag, push); it does not git-commit for you.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const VERSION_RE = /^\d+\.\d+\.\d+$/;

/** A release version is exactly three dot-separated numbers. */
export function isValidVersion(v) {
  return VERSION_RE.test(v);
}

/** Rewrite the top-level `"version": "x.y.z"` in a JSON document. */
export function bumpJsonVersion(text, next) {
  return text.replace(/("version"\s*:\s*")\d+\.\d+\.\d+(")/, `$1${next}$2`);
}

/**
 * Rewrite the `version = "x.y.z"` that immediately follows `name = "<pkg>"`,
 * which is how both Cargo.toml ([package]) and Cargo.lock ([[package]]) lay out
 * a crate. Dependency `version = "…"` lines and other crates are left alone.
 */
export function bumpPackageVersion(text, name, next) {
  const re = new RegExp(`(name = "${name}"\\nversion = ")\\d+\\.\\d+\\.\\d+(")`);
  return text.replace(re, `$1${next}$2`);
}

/** Read the current top-level version from a JSON document. */
function readJsonVersion(text) {
  return text.match(/"version"\s*:\s*"(\d+\.\d+\.\d+)"/)?.[1] ?? null;
}

function rewriteFile(path, fn) {
  const before = readFileSync(path, "utf8");
  const after = fn(before);
  if (after === before) {
    throw new Error(`no version match in ${path} — file format may have changed`);
  }
  writeFileSync(path, after);
}

function main(argv) {
  const next = argv[2];
  if (!next || !isValidVersion(next)) {
    console.error("usage: npm run bump <x.y.z>   (e.g. npm run bump 0.6.0)");
    process.exit(1);
  }

  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const pkgPath = join(root, "package.json");
  const confPath = join(root, "src-tauri", "tauri.conf.json");
  const cargoPath = join(root, "src-tauri", "Cargo.toml");
  const lockPath = join(root, "src-tauri", "Cargo.lock");

  // Guard: package.json and tauri.conf.json should currently agree.
  const current = readJsonVersion(readFileSync(pkgPath, "utf8"));
  const confCurrent = readJsonVersion(readFileSync(confPath, "utf8"));
  if (current !== confCurrent) {
    console.error(
      `refusing to bump: tauri.conf.json is at ${confCurrent}, package.json is at ${current}`,
    );
    process.exit(1);
  }
  if (current === next) {
    console.error(`already at ${next} — nothing to do`);
    process.exit(1);
  }

  rewriteFile(pkgPath, (t) => bumpJsonVersion(t, next));
  rewriteFile(confPath, (t) => bumpJsonVersion(t, next));
  rewriteFile(cargoPath, (t) => bumpPackageVersion(t, "instantnotes", next));
  rewriteFile(lockPath, (t) => bumpPackageVersion(t, "instantnotes", next));

  console.log(`bumped ${current} -> ${next} in:`);
  console.log("  package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock");
  console.log("");
  console.log("next:");
  console.log(`  1. add a "## [${next}]" section to CHANGELOG.md`);
  console.log(`  2. git commit -am "chore: bump version to ${next}"`);
  console.log(`  3. git tag v${next} && git push origin v${next}   # CI builds, signs, publishes`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv);
}
