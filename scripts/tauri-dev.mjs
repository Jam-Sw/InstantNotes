#!/usr/bin/env node
// Dev launcher for `npm run tauri:dev`.
//
// Why this exists: the app hides to the tray on window-close (lib.rs:606) and
// uses tauri-plugin-single-instance (lib.rs:465). So a plain `tauri dev` re-run
// does NOT start fresh - single-instance detects the still-alive tray instance
// and just re-surfaces its window. That window is the webview from the FIRST
// launch: frozen on the frontend it loaded then, with its HMR socket pointing at
// a Vite server that has since died. Result: edits never show, no matter how
// many times you run it.
//
// So before launching, we kill any prior dev instance and free the Vite port,
// guaranteeing every run is a genuinely fresh process that loads the latest UI
// from a live Vite (with working hot-reload). Points the dev build at the real
// notes DB so the same notes show as the installed app.

import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8" });
  } catch {
    return "";
  }
}

function killPid(pid, label) {
  const n = Number(pid);
  if (!n) return;
  try {
    process.kill(n, "SIGTERM");
    console.log(`[tauri:dev] stopped ${label} (pid ${n})`);
  } catch {
    /* already gone */
  }
}

// 1) Kill any running dev binary by PID (never signal this script itself).
for (const line of sh("ps -axo pid=,args=").split("\n")) {
  if (
    line.includes("target/debug/instantnotes") &&
    !line.includes("tauri-dev.mjs") &&
    !line.includes("node ")
  ) {
    killPid(line.trim().split(/\s+/)[0], "stale dev instance");
  }
}

// 2) Free the Vite dev port so a fresh server is used (not a stale one).
const onPort = sh("lsof -ti tcp:1420").trim();
if (onPort) for (const pid of onPort.split("\n")) killPid(pid, "stale dev server on :1420");

// 3) Launch fresh, pointed at the real notes DB.
const dbPath = join(
  homedir(),
  "Library/Application Support/com.instantnotes.app/instantnotes.db",
);
const tauriBin = existsSync("node_modules/.bin/tauri")
  ? "node_modules/.bin/tauri"
  : "tauri";

const child = spawn(
  tauriBin,
  ["dev", "--config", "src-tauri/tauri.dev.conf.json"],
  { stdio: "inherit", env: { ...process.env, INSTANTNOTES_DB_PATH: dbPath } },
);
child.on("exit", (code) => process.exit(code ?? 0));
