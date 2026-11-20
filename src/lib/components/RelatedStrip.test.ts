import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import RelatedStrip from "./RelatedStrip.svelte";
import type { RelatedNote } from "$lib/api/types";

afterEach(cleanup);

const sample: RelatedNote[] = [
  {
    noteId: "e1",
    title: "Winter pruning",
    excerpt: "Cut deadwood before sap rises in late February",
    contentKind: "document",
    createdAt: "2026-01-01T12:00:00Z",
    updatedAt: "2026-01-15T12:00:00Z",
    score: 0.78,
    reasons: ["prune", "#orchard"],
  },
  {
    noteId: "e2",
    title: "",
    excerpt: "Scion storage in damp sawdust",
    contentKind: "document",
    createdAt: "2026-01-01T12:00:00Z",
    updatedAt: "2026-01-03T12:00:00Z",
    score: 0.56,
    reasons: ["scion"],
  },
];

describe("RelatedStrip", () => {
  it("renders nothing when no note is related and it was never shown", () => {
    const { container } = render(RelatedStrip, {
      related: [],
      canFold: true,
      onOpen: vi.fn(),
      onFold: vi.fn(),
      onDismiss: vi.fn(),
    });
    expect(container.querySelector(".related-strip")).toBeNull();
  });

  it("keeps a quiet bar in place once it has shown notes for this one", () => {
    const { getByRole, queryAllByRole } = render(RelatedStrip, {
      related: [],
      keepOpen: true,
      canFold: true,
      onOpen: vi.fn(),
      onFold: vi.fn(),
      onDismiss: vi.fn(),
    });
    expect(getByRole("complementary", { name: "Around this note" })).toBeTruthy();
    expect(queryAllByRole("button")).toHaveLength(0);
  });

  it("expands a pill, collapses on Escape, and fires fold, open and dismiss", async () => {
    const onOpen = vi.fn();
    const onFold = vi.fn();
    const onDismiss = vi.fn();
    const { getByRole, getByText, queryByText } = render(RelatedStrip, {
      related: sample,
      canFold: true,
      onOpen,
      onFold,
      onDismiss,
    });

    expect(getByText("Around this note")).toBeTruthy();
    expect(getByRole("button", { name: /Untitled/ })).toBeTruthy();
    expect(queryByText(/Cut deadwood/)).toBeNull();

    const firstPill = getByRole("button", { name: /Winter pruning/ });
    await fireEvent.click(firstPill);
    expect(getByText(/Cut deadwood/)).toBeTruthy();
    expect(getByText("#orchard")).toBeTruthy();

    await fireEvent.keyDown(getByRole("complementary", { name: "Around this note" }), {
      key: "Escape",
    });
    expect(queryByText(/Cut deadwood/)).toBeNull();

    await fireEvent.click(firstPill);
    await fireEvent.click(getByRole("button", { name: "Fold in" }));
    expect(onFold).toHaveBeenCalledWith(sample[0]);

    await fireEvent.click(firstPill);
    await fireEvent.click(getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledWith("e1");

    await fireEvent.click(firstPill);
    await fireEvent.click(getByRole("button", { name: "Not related" }));
    expect(onDismiss).toHaveBeenCalledWith(sample[0]);
  });

  it("keeps an open card while its note drops out of the list", async () => {
    const props = {
      related: sample,
      canFold: true,
      onOpen: vi.fn(),
      onFold: vi.fn(),
      onDismiss: vi.fn(),
    };
    const { getByRole, getByText, rerender } = render(RelatedStrip, props);
    await fireEvent.click(getByRole("button", { name: /Winter pruning/ }));
    await rerender({ ...props, related: [sample[1]] });
    expect(getByText(/Cut deadwood/)).toBeTruthy();
    expect(getByRole("button", { name: /Winter pruning/ })).toBeTruthy();
  });

  it("hides Fold in when the open note is a surface that cannot absorb prose", async () => {
    const { getByRole, queryByRole } = render(RelatedStrip, {
      related: [sample[0]],
      canFold: false,
      onOpen: vi.fn(),
      onFold: vi.fn(),
      onDismiss: vi.fn(),
    });
    await fireEvent.click(getByRole("button", { name: /Winter pruning/ }));
    expect(queryByRole("button", { name: "Fold in" })).toBeNull();
    expect(getByRole("button", { name: "Open" })).toBeTruthy();
  });
});
