import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";

const { note } = vi.hoisted(() => ({
  note: {
  id: "n1",
  title: "Plan for the launch",
  body: "Some body text",
  contentKind: "text",
  isPinned: false,
  isArchived: false,
  isDeleted: false,
  createdAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-01T10:00:00Z",
  tagIds: [],
  workspaceIds: [],
  },
}));

vi.mock("$lib/api/client", () => {
  const answers: Record<string, unknown> = {
    listNotes: [note],
    searchNotes: [],
    getNote: note,
    countNotes: 0,
    spaceSuggestions: [],
    libraryGraph: { nodes: [], edges: [] },
    appVersion: "0.10.1",
  };
  const fns = new Map<string, unknown>();
  return new Proxy(
    {},
    {
      has: () => true,
      get: (_, key: string) => {
        if (key === "then") return undefined;
        if (!fns.has(key)) {
          const value = key in answers ? answers[key] : key.startsWith("list") ? [] : null;
          fns.set(key, vi.fn(async () => value));
        }
        return fns.get(key);
      },
    },
  );
});
vi.mock("$lib/api/events", async (original) => ({
  ...(await original<typeof import("$lib/api/events")>()),
  listen: vi.fn(async () => () => {}),
}));

import Page from "./+page.svelte";
import { library } from "$lib/stores/library.svelte";
import { layout } from "$lib/stores/layout.svelte";
import { sidebar } from "$lib/stores/sidebar.svelte";
import { agreements } from "$lib/agreements.svelte";

let width = 1440;
let coarse = false;

function setScreen(next: number, touch = false): void {
  width = next;
  coarse = touch;
  window.matchMedia = vi.fn((query: string) => {
    const max = /max-width: (\d+)px/.exec(query);
    const matches = query === "(pointer: coarse)" ? coarse : max ? width <= Number(max[1]) : false;
    return {
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

beforeEach(() => {
  for (const doc of agreements.documents) agreements.agree(doc.id);
  Element.prototype.animate = vi.fn(() => {
    const animation = { onfinish: null as null | (() => void), cancel: () => {} };
    setTimeout(() => animation.onfinish?.());
    return animation as unknown as Animation;
  });
  vi.spyOn(history, "back").mockImplementation(() => {
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
});

afterEach(() => {
  cleanup();
  library.selectWorkspace(null);
  layout.showList();
  sidebar.narrowOpen = false;
  vi.restoreAllMocks();
});

async function open(w: number, touch = false) {
  setScreen(w, touch);
  const view = render(Page);
  await waitFor(() => expect(view.container.querySelector(".note-row")).toBeTruthy());
  return view;
}

describe("the page on the desktop", () => {
  it("shows the sidebar, the list and the editor side by side", async () => {
    const { container, queryByRole } = await open(1440);
    expect(container.querySelector(".sidebar")).toBeTruthy();
    expect(container.querySelector(".list-pane")).toBeTruthy();
    expect(container.querySelector(".editor-pane")).toBeTruthy();
    expect(queryByRole("button", { name: "Show the sidebar" })).toBeNull();
    expect(queryByRole("button", { name: "Commands" })).toBeNull();
  });
});

describe("the page on a tablet", () => {
  it("shows the list and the editor with the sidebar behind a menu button", async () => {
    const { container, getByRole } = await open(820, true);
    expect(container.querySelector(".sidebar")).toBeNull();
    expect(container.querySelector(".list-pane")).toBeTruthy();
    expect(container.querySelector(".editor-pane")).toBeTruthy();
    await fireEvent.click(getByRole("button", { name: "Show the sidebar" }));
    expect(container.querySelector(".drawer .sidebar")).toBeTruthy();
  });
});

describe("the page on a phone", () => {
  it("shows one pane at a time and goes back to the list", async () => {
    const { container, getByRole, findByRole } = await open(390, true);
    expect(container.querySelector(".list-pane")).toBeTruthy();
    expect(container.querySelector(".editor-pane")).toBeNull();

    await fireEvent.click(container.querySelector(".note-row")!);
    await findByRole("button", { name: "Back to the notes" });
    expect(container.querySelector(".list-pane")).toBeNull();
    expect(container.querySelector(".editor-pane")).toBeTruthy();

    await fireEvent.click(getByRole("button", { name: "Back to the notes" }));
    await waitFor(() => expect(container.querySelector(".list-pane")).toBeTruthy());
    expect(container.querySelector(".editor-pane")).toBeNull();
    expect(library.selected).toBeNull();
  });

  it("opens the sidebar as a drawer and closes it when a view is chosen", async () => {
    const { container, getByRole } = await open(390, true);
    await fireEvent.click(getByRole("button", { name: "Show the sidebar" }));
    const drawer = container.querySelector(".drawer");
    expect(drawer).toBeTruthy();
    await fireEvent.click(getByRole("button", { name: /Graph/ }));
    await waitFor(() => expect(sidebar.narrowOpen).toBe(false));
  });

  it("offers the command button on touch", async () => {
    const { getByRole } = await open(390, true);
    await fireEvent.click(getByRole("button", { name: "Commands" }));
    expect(getByRole("dialog", { name: "Command palette" }).parentElement?.classList).toContain(
      "sheet",
    );
  });
});
