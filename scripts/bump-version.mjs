import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const VERSION_RE = /^\d+\.\d+\.\d+$/;

export function isValidVersion(v) {
  return VERSION_RE.test(v);
}

export function bumpJsonVersion(text, next) {
  return text.replace(/("version"\s*:\s*")\d+\.\d+\.\d+(")/, `$1${next}$2`);
}

export function bumpPackageVersion(text, name, next) {
  const re = new RegExp(`(name = "${name}"\\nversion = ")\\d+\\.\\d+\\.\\d+(")`);
  return text.replace(re, `$1${next}$2`);
}

export function bumpLockVersion(text, next) {
  return text.replace(
    /("name":\s*"instantnotes",\s*"version":\s*")\d+\.\d+\.\d+(")/g,
    `$1${next}$2`,
  );
}

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
  const pkgLockPath = join(root, "package-lock.json");
  const confPath = join(root, "src-tauri", "tauri.conf.json");
  const cargoPath = join(root, "src-tauri", "Cargo.toml");
  const lockPath = join(root, "src-tauri", "Cargo.lock");

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
  rewriteFile(pkgLockPath, (t) => bumpLockVersion(t, next));
  rewriteFile(confPath, (t) => bumpJsonVersion(t, next));
  rewriteFile(cargoPath, (t) => bumpPackageVersion(t, "instantnotes", next));
  rewriteFile(lockPath, (t) => bumpPackageVersion(t, "instantnotes", next));

  console.log(`bumped ${current} -> ${next} in:`);
  console.log("  package.json, package-lock.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock");
  console.log("");
  console.log("next:");
  console.log(`  1. add a "## [${next}]" section to CHANGELOG.md`);
  console.log(`  2. git commit -am "chore: bump version to ${next}"`);
  console.log(`  3. git tag v${next} && git push origin v${next}   # CI builds, signs, publishes`);
}

const argv1 = process.argv[1] ?? "";
const isMain =
  argv1 &&
  typeof pathToFileURL === "function" &&
  import.meta.url === pathToFileURL(argv1).href;

if (isMain) {
  main(process.argv);
}
