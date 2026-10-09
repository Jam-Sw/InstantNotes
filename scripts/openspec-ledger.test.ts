import { describe, it, expect } from "vitest";
import sequenceRaw from "../openspec/SEQUENCE.md?raw";

const tasks = import.meta.glob("../openspec/changes/archive/*/tasks.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const changeName = (path: string) => path.split("/").at(-2)!;

describe("the SEQUENCE ledger", () => {
  it("names every archived change that records landing on a release branch", () => {
    const landed = Object.entries(tasks)
      .filter(([, md]) => md.includes("Landed on"))
      .map(([path]) => changeName(path))
      .sort();

    expect(landed.length).toBeGreaterThan(0);

    const missing = landed.filter((name) => !sequenceRaw.includes(name));
    expect(missing).toEqual([]);
  });
});
