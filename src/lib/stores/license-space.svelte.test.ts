// @vitest-environment jsdom
// The License Space: the library's form of the installers agreement gate.
// The rules themselves are agreements.test.ts (the shared conformance cases);
// this covers what InstantNotes adds: which document is open, and the lock.

import { beforeEach, describe, expect, it, vi } from "vitest";
import manifest from "../../../src-tauri/installer/agreements.json";

const KEY = manifest.storageKey;
const [license, eula] = manifest.documents;

async function load() {
  vi.resetModules();
  return (await import("./license-space.svelte")).licenseSpace;
}

beforeEach(() => localStorage.clear());

describe("License Space", () => {
  it("locks a first launch and opens the source license first", async () => {
    const space = await load();
    expect(space.locked).toBe(true);
    expect(space.documents.map((d) => d.id)).toEqual(["license", "eula"]);
    expect(space.shown?.id).toBe("license");
  });

  it("needs each document agreed on its own, then unlocks", async () => {
    const space = await load();
    space.agree("license");
    expect(space.locked).toBe(true);
    expect(space.isAgreed("license")).toBe(true);
    // The next document still to agree to opens by itself.
    expect(space.shown?.id).toBe("eula");

    space.agree("eula");
    expect(space.locked).toBe(false);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      license: license.version,
      eula: eula.version,
    });
  });

  it("stays open on whichever document was picked", async () => {
    const space = await load();
    space.show("eula");
    expect(space.shown?.id).toBe("eula");
  });

  it("asks again for a document whose version changed, and only that one", async () => {
    localStorage.setItem(KEY, JSON.stringify({ license: license.version, eula: "2000-01-01" }));
    const space = await load();
    expect(space.locked).toBe(true);
    expect(space.isAgreed("license")).toBe(true);
    expect(space.shown?.id).toBe("eula");
  });

  it("opens unlocked once both are agreed at their current versions", async () => {
    localStorage.setItem(KEY, JSON.stringify({ license: license.version, eula: eula.version }));
    expect((await load()).locked).toBe(false);
  });
});
