// Guards openspec/SEQUENCE.md against the omission that actually happened: on
// 2026-09-24 `feat-update-notification` was archived with every task checked
// and shipped in 0.9.0, yet no unit was ever added to the ledger, so the file
// that says what a release contains silently under-reported it. Nothing failed,
// because nothing was checking.
//
// The invariant is self-describing rather than a baseline list. A change whose
// tasks.md records "Landed on <branch>" is by its own account a unit that
// landed, and every such unit must be named in SEQUENCE.md. Changes archived
// before SEQUENCE.md existed carry no such line and are not implicated, so this
// needs no allowlist to stay quiet about them.

import { describe, it, expect } from "vitest";
import sequenceRaw from "../openspec/SEQUENCE.md?raw";

const tasks = import.meta.glob("../openspec/changes/archive/*/tasks.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** `../openspec/changes/archive/feat-graph-view/tasks.md` -> `feat-graph-view` */
const changeName = (path: string) => path.split("/").at(-2)!;

describe("the SEQUENCE ledger", () => {
  it("names every archived change that records landing on a release branch", () => {
    const landed = Object.entries(tasks)
      .filter(([, md]) => md.includes("Landed on"))
      .map(([path]) => changeName(path))
      .sort();

    // Also catches the glob matching nothing, which would make this vacuous.
    expect(landed.length).toBeGreaterThan(0);

    const missing = landed.filter((name) => !sequenceRaw.includes(name));
    expect(missing).toEqual([]);
  });
});
