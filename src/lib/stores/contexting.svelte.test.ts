import { describe, it, expect, vi } from "vitest";

const notes: Record<string, { id: string; title: string; body: string; updatedAt: string }> = {
  "01J9ZK4Q6V7W8X9Y0A1B2C3D4E": {
    id: "01J9ZK4Q6V7W8X9Y0A1B2C3D4E",
    title: "First",
    body: "one",
    updatedAt: "2026-10-15T10:00:00.000Z",
  },
  "01J9ZK4Q6V7W8X9Y0A1B2C3D4F": {
    id: "01J9ZK4Q6V7W8X9Y0A1B2C3D4F",
    title: "Second",
    body: "two",
    updatedAt: "2026-10-15T10:00:00.000Z",
  },
};

vi.mock("$lib/api/client", () => ({
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => {}),
  getAttachmentsDir: vi.fn(async () => null),
  getNote: vi.fn(async (id: string) => notes[id]),
  tagsForNote: vi.fn(async () => [{ name: "work" }]),
}));

import { contexting } from "./contexting.svelte";

describe("contexting.renderIds", () => {
  it("renders each note with a source line holding its own Note.id, in order", async () => {
    const out = await contexting.renderIds(Object.keys(notes));
    const ids = [...out.matchAll(/^From InstantNotes .+ · id (\S+)$/gm)].map((m) => m[1]);
    expect(ids).toEqual(Object.keys(notes));
    expect(out.indexOf("First")).toBeLessThan(out.indexOf("Second"));
  });

  it("drops the source line when the setting is off", async () => {
    contexting.setAddSourceLine(false);
    const out = await contexting.renderIds(["01J9ZK4Q6V7W8X9Y0A1B2C3D4E"]);
    expect(out).not.toContain("From InstantNotes");
    contexting.setAddSourceLine(true);
  });
});
