#!/usr/bin/env node

import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEV_PORT = 1422;

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
  }
}

if (process.platform !== "win32") {
  for (const line of sh("ps -axo pid=,args=").split("\n")) {
    if (
      line.includes("target/debug/instantnotes") &&
      !line.includes("tauri-dev.mjs") &&
      !line.includes("node ")
    ) {
      killPid(line.trim().split(/\s+/)[0], "stale dev instance");
    }
  }

  const onPort = sh(`lsof -ti tcp:${DEV_PORT}`).trim();
  if (onPort) for (const pid of onPort.split("\n")) killPid(pid, `stale dev server on :${DEV_PORT}`);
}

const appDataRoot =
  process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support")
    : process.platform === "win32"
      ? (process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"))
      : (process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"));
const dbPath = join(appDataRoot, "com.instantnotes.app", "instantnotes.db");

const binName = process.platform === "win32" ? "tauri.cmd" : "tauri";
const localBin = join("node_modules", ".bin", binName);
const tauriBin = existsSync(localBin) ? localBin : binName;

const child = spawn(
  tauriBin,
  ["dev", "--config", "src-tauri/tauri.dev.conf.json"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      INSTANTNOTES_DB_PATH: dbPath,
      ...(process.platform === "linux" && !process.env.WEBKIT_DISABLE_DMABUF_RENDERER
        ? { WEBKIT_DISABLE_DMABUF_RENDERER: "1" }
        : {}),
    },
    shell: process.platform === "win32",
  },
);
child.on("exit", (code) => process.exit(code ?? 0));
