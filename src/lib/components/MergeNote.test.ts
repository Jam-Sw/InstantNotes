import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import type { MergeReview, Note } from "$lib/api/types";

const { client, library } = vi.hoisted(() => ({
  client: {
    getMergeReview: vi.fn(),
    getNote: vi.fn(),
    settleMergePair: vi.fn(),
    undoMergeCombine: vi.fn(),
    clearMergeReview: vi.fn(),
  },
  library: {
    selected: null as { id: string } | null,
    selectWorkspace: vi.fn(),
    selectVirtual: vi.fn(),
  },
}));

vi.mock("$lib/api/client", () => client);
vi.mock("$lib/api/events", () => ({
  EVENTS: { VAULT_STATUS: "vault:status" },
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("$lib/stores/library.svelte", () => ({ library }));
vi.mock("$lib/stores/toasts.svelte", () => ({ toasts: { show: vi.fn() } }));

import MergeNote from "./MergeNote.svelte";
import { mergeSpace } from "$lib/stores/merge-space.svelte";
import { COPIES_NOTE_ID, pairNoteId } from "$lib/merge/space";

const note = (id: string, title: string, body: string, isDeleted = false): Note => ({
  id,
  title,
  body,
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-01T09:00:00.000Z",
  isPinned: false,
  isArchived: false,
  isDeleted,
  contentKind: "document",
});

const notes: Record<string, Note> = {
  a: note("a", "Groceries", "Groceries\n- milk\n- eggs\n- bread"),
  b: note("b", "Groceries", "Groceries\n- milk\n- eggs"),
  kept: note("kept", "Bike checklist", "Chain, brakes, tyres."),
  spare: note("spare", "Bike checklist", "Chain, brakes, tyres.", true),
};

const pair = { a: "a", b: "b", reason: "almost the same text" };
const full: MergeReview = { combined: [{ kept: "kept", trashed: "spare" }], pairs: [pair] };
const empty: MergeReview = { combined: [], pairs: [] };

afterEach(cleanup);

beforeEach(async () => {
  vi.clearAllMocks();
  client.getNote.mockImplementation(async (id: string) => notes[id]);
  client.getMergeReview.mockResolvedValue(full);
  client.settleMergePair.mockResolvedValue({ ...full, pairs: [] });
  client.undoMergeCombine.mockResolvedValue({ ...full, combined: [] });
  client.clearMergeReview.mockResolvedValue(undefined);
  await mergeSpace.refresh();
});

function showPair() {
  library.selected = { id: pairNoteId(pair) };
  return render(MergeNote);
}

describe("MergeNote", () => {
  it("lists combined exact copies, and Undo brings the spare copy back", async () => {
    library.selected = { id: COPIES_NOTE_ID };
    const { getByText } = render(MergeNote);

    expect(getByText("Bike checklist")).toBeTruthy();
    expect(getByText(/The\s+spare copy went to the Trash/)).toBeTruthy();
    await fireEvent.click(getByText("Undo"));
    expect(client.undoMergeCombine).toHaveBeenCalledWith("spare");
  });

  it("shows the pair side by side and says where a discarded copy goes", () => {
    const { container, getByText } = showPair();

    const panes = container.querySelectorAll(".cm-content");
    expect(panes).toHaveLength(2);
    expect(panes[0].textContent).toContain("bread");
    expect(panes[1].textContent).not.toContain("bread");
    expect(getByText(/The one you don't keep goes to the Trash/)).toBeTruthy();
  });

  it("has Keep both preselected, and choosing it keeps both notes", async () => {
    const { getByText } = showPair();

    const both = getByText("Keep both");
    expect(both.classList.contains("primary")).toBe(true);
    await fireEvent.click(both);
    expect(client.settleMergePair).toHaveBeenCalledWith("a", "b", null);
  });

  it("Keep this one keeps the left note", async () => {
    const { getByText } = showPair();

    await fireEvent.click(getByText("Keep this one"));
    expect(client.settleMergePair).toHaveBeenCalledWith("a", "b", "a");
  });

  it("Keep that one keeps the right note", async () => {
    const { getByText } = showPair();

    await fireEvent.click(getByText("Keep that one"));
    expect(client.settleMergePair).toHaveBeenCalledWith("a", "b", "b");
  });

  it("Leave all as they are clears the list and hides the Space", async () => {
    const { getByText } = showPair();
    expect(mergeSpace.visible).toBe(true);

    await fireEvent.click(getByText("Leave all as they are"));
    expect(client.clearMergeReview).toHaveBeenCalledTimes(1);
    expect(mergeSpace.visible).toBe(false);
  });

  it("the Space is hidden while there is nothing to review", async () => {
    client.getMergeReview.mockResolvedValue(empty);
    await mergeSpace.refresh();

    expect(mergeSpace.visible).toBe(false);
    expect(mergeSpace.notes).toEqual([]);
  });
});
