import { describe, expect, it } from "vitest";
import {
  buildUpdateNotes,
  isReleaseNotesNoteId,
  isUpdateNoteId,
  isUpdateSpaceId,
  isVirtualNoteId,
  RELEASE_NOTES_NOTE_ID,
  releaseNotesTitle,
  sizeDeltaLine,
  UPDATE_NOTE_ID,
  UPDATE_SPACE_ID,
  updateNoteTitle,
} from "./space";

const view = {
  version: "0.10.0",
  currentVersion: "0.9.0",
  date: "2026-09-24T00:00:00.000Z",
  notes: "### Added\n- Something new",
};

describe("synthetic ids", () => {
  it("recognizes exactly the update Space and its notes", () => {
    expect(isUpdateSpaceId(UPDATE_SPACE_ID)).toBe(true);
    expect(isUpdateSpaceId("ws-1")).toBe(false);
    expect(isUpdateSpaceId(null)).toBe(false);

    expect(isUpdateNoteId(UPDATE_NOTE_ID)).toBe(true);
    expect(isReleaseNotesNoteId(RELEASE_NOTES_NOTE_ID)).toBe(true);
    expect(isVirtualNoteId(UPDATE_NOTE_ID)).toBe(true);
    expect(isVirtualNoteId(RELEASE_NOTES_NOTE_ID)).toBe(true);
    expect(isVirtualNoteId("n1")).toBe(false);
    expect(isVirtualNoteId(undefined)).toBe(false);
  });
});

describe("titles", () => {
  it("names the update note by the version jump", () => {
    expect(updateNoteTitle("0.9.0", "0.10.0")).toBe("update 0.9.0 → 0.10.0");
  });

  it("names the release-notes note by the new version", () => {
    expect(releaseNotesTitle("0.10.0")).toBe("What's new in 0.10.0");
  });
});

describe("buildUpdateNotes", () => {
  it("returns the update note first, then the release notes", () => {
    const notes = buildUpdateNotes(view);
    expect(notes.map((n) => n.id)).toEqual([
      UPDATE_NOTE_ID,
      RELEASE_NOTES_NOTE_ID,
    ]);
    expect(notes[0].title).toBe("update 0.9.0 → 0.10.0");
    expect(notes[1].title).toBe("What's new in 0.10.0");
    expect(notes[1].body).toBe(view.notes);
    // Ordinary notes in every way the list cares about.
    expect(notes.every((n) => n.contentKind === "document")).toBe(true);
    expect(notes.every((n) => !n.isArchived && !n.isDeleted)).toBe(true);
  });

  it("gives the update note a preview even when there are no release notes", () => {
    const notes = buildUpdateNotes({ ...view, notes: null });
    expect(notes[0].body.length).toBeGreaterThan(0);
    expect(notes[1].body).toBe("");
  });
});

describe("size delta", () => {
  it("phrases the delta against the running version", () => {
    expect(sizeDeltaLine(1_258_291, "0.9.0")).toBe(
      "1.2 MB larger than v0.9.0",
    );
    expect(sizeDeltaLine(-348_160, "0.9.0")).toBe(
      "340 KB smaller than v0.9.0",
    );
    expect(sizeDeltaLine(0, "0.9.0")).toBe("the same size as v0.9.0");
    expect(sizeDeltaLine(null, "0.9.0")).toBeNull();
  });
});
