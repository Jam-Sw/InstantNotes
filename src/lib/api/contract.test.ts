import { readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "./error-codes";
import { EVENTS } from "./events";

const root = `${process.cwd()}/`;
const read = (path: string) => readFileSync(root + path, "utf8");

function sourceFiles(dir: string, exts: string[]): string[] {
  return readdirSync(root + dir).flatMap((entry) => {
    const rel = `${dir}/${entry}`;
    if (statSync(root + rel).isDirectory()) return sourceFiles(rel, exts);
    return exts.some((e) => entry.endsWith(e)) ? [rel] : [];
  });
}

describe("error codes", () => {
  const core = read("src-tauri/core/src/error.rs");
  const codeArms = core
    .slice(core.indexOf("pub fn code("), core.indexOf("pub fn is_corruption("))
    .matchAll(/=> "([A-Z_]+)"/g);
  const fromCore = new Set([...codeArms].map((m) => m[1]));

  it("matches the codes the core emits", () => {
    expect(fromCore.size).toBeGreaterThan(0);
    expect([...fromCore].sort()).toEqual(Object.keys(ERROR_CODES).sort());
  });

  it("matches the API.md table", () => {
    const section = read("docs/API.md").split("## 14. Error codes")[1];
    const documented = [...section.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((m) => m[1]);
    expect(documented.sort()).toEqual(Object.keys(ERROR_CODES).sort());
  });

  it("matches the Rust ErrorCode enum", () => {
    const shell = read("src-tauri/src/error.rs");
    const arms = [...shell.matchAll(/=> "([A-Z_]+)"/g)].map((m) => m[1]);
    expect(arms.sort()).toEqual(Object.keys(ERROR_CODES).sort());
  });

  it("is the only way a command error names a code", () => {
    const literal = new RegExp('code:\\s*"');
    for (const file of sourceFiles("src-tauri/src", [".rs"])) {
      expect(literal.test(read(file)), file).toBe(false);
    }
  });
});

describe("event names", () => {
  const rust = read("src-tauri/src/events.rs");
  const declared = [...rust.matchAll(/pub const [A-Z_]+: &str = "([^"]+)"/g)].map((m) => m[1]);

  it("matches the Rust list exactly", () => {
    expect(declared.length).toBe(Object.keys(EVENTS).length);
    expect(declared.sort()).toEqual([...Object.values(EVENTS)].sort());
  });

  it("is the only way either side names an event", () => {
    const emit = new RegExp('emit\\(\\s*"');
    for (const file of sourceFiles("src-tauri/src", [".rs"])) {
      expect(emit.test(read(file)), file).toBe(false);
    }
    const listen = new RegExp('listen\\(\\s*"');
    for (const file of sourceFiles("src", [".ts", ".svelte"])) {
      if (file.endsWith(".test.ts")) continue;
      expect(listen.test(read(file)), file).toBe(false);
    }
  });
});
