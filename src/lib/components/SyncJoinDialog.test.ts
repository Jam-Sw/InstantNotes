import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { listen } from "@tauri-apps/api/event";
import SyncJoinDialog from "./SyncJoinDialog.svelte";
import { answerSyncJoin, listSyncJoinRequests } from "$lib/api/client";
import { EVENTS } from "$lib/api/events";
import type { SyncJoinRequest } from "$lib/api/types";
import { toasts } from "$lib/stores/toasts.svelte";

vi.mock("$lib/api/client", () => ({
  answerSyncJoin: vi.fn(),
  listSyncJoinRequests: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

const LAPTOP: SyncJoinRequest = {
  id: "join-1",
  deviceName: "Work laptop",
  publicKey: "age1laptop",
  words: ["apple", "river", "bamboo", "lamp", "atlas", "fountain"],
};
const PHONE: SyncJoinRequest = {
  id: "join-2",
  deviceName: "Phone",
  publicKey: "age1phone",
  words: ["acorn", "amber", "badge", "arrow", "aspen", "banjo"],
};

let handlers: Map<string, (e: { payload: unknown }) => void>;

async function send(requests: SyncJoinRequest[]) {
  await waitFor(() => expect(handlers.has(EVENTS.SYNC_JOIN_REQUESTS)).toBe(true));
  handlers.get(EVENTS.SYNC_JOIN_REQUESTS)!({ payload: requests });
  await tick();
}

const title = (name: string) => (_: string, el: Element | null) =>
  el?.tagName === "H2" && el.textContent === `${name} wants to join.`;

afterEach(cleanup);

beforeEach(() => {
  handlers = new Map();
  vi.mocked(listen).mockReset().mockImplementation(async (event, handler) => {
    handlers.set(event as string, handler as (e: { payload: unknown }) => void);
    return () => handlers.delete(event as string);
  });
  vi.mocked(answerSyncJoin).mockReset().mockResolvedValue(undefined);
  vi.mocked(listSyncJoinRequests).mockReset().mockResolvedValue([]);
  toasts.items = [];
});

describe("SyncJoinDialog", () => {
  it("shows a request that was already waiting when it opened", async () => {
    vi.mocked(listSyncJoinRequests).mockResolvedValue([LAPTOP]);
    const { findByText } = render(SyncJoinDialog);
    expect(await findByText(title("Work laptop"))).toBeTruthy();
  });


  it("stays hidden until a request arrives", async () => {
    const { queryByRole } = render(SyncJoinDialog);
    await send([]);
    expect(queryByRole("alertdialog")).toBeNull();
  });

  it("shows the joining device and its six words in order", async () => {
    const { getByRole, getByText } = render(SyncJoinDialog);
    await send([LAPTOP]);
    expect(getByRole("alertdialog")).toBeTruthy();
    expect(getByText(title("Work laptop"))).toBeTruthy();
    expect(getByText("Do these words match the ones on it?")).toBeTruthy();
    const words = getByRole("list", { name: "Words" }).querySelectorAll(".word");
    expect([...words].map((w) => w.textContent)).toEqual(LAPTOP.words);
  });

  it("approves with the request's key", async () => {
    const { getByRole, queryByRole } = render(SyncJoinDialog);
    await send([LAPTOP]);
    await fireEvent.click(getByRole("button", { name: "Approve" }));
    expect(answerSyncJoin).toHaveBeenCalledWith("join-1", "age1laptop", true);
    await waitFor(() => expect(queryByRole("alertdialog")).toBeNull());
  });

  it("denies", async () => {
    const { getByRole, queryByRole } = render(SyncJoinDialog);
    await send([LAPTOP]);
    await fireEvent.click(getByRole("button", { name: "Deny" }));
    expect(answerSyncJoin).toHaveBeenCalledWith("join-1", "age1laptop", false);
    await waitFor(() => expect(queryByRole("alertdialog")).toBeNull());
  });

  it("shows several requests one at a time, oldest first", async () => {
    const { getByRole, getByText, findByText, queryByText } = render(SyncJoinDialog);
    await send([LAPTOP, PHONE]);
    expect(getByText(title("Work laptop"))).toBeTruthy();
    expect(getByText("1 more device waiting")).toBeTruthy();
    expect(queryByText(title("Phone"))).toBeNull();
    await fireEvent.click(getByRole("button", { name: "Approve" }));
    expect(await findByText(title("Phone"))).toBeTruthy();
    expect(queryByText("1 more device waiting")).toBeNull();
  });

  it("does not ask again about a request already answered", async () => {
    const { getByRole, getByText, queryByText } = render(SyncJoinDialog);
    await send([LAPTOP, PHONE]);
    await fireEvent.click(getByRole("button", { name: "Deny" }));
    await waitFor(() => expect(getByText(title("Phone"))).toBeTruthy());
    await send([LAPTOP, PHONE]);
    expect(queryByText(title("Work laptop"))).toBeNull();
    expect(getByText(title("Phone"))).toBeTruthy();
  });

  it("closes when the list empties", async () => {
    const { queryByRole } = render(SyncJoinDialog);
    await send([LAPTOP, PHONE]);
    expect(queryByRole("alertdialog")).toBeTruthy();
    await send([]);
    expect(queryByRole("alertdialog")).toBeNull();
    expect(answerSyncJoin).not.toHaveBeenCalled();
  });

  it("keeps the request and says why when the answer fails", async () => {
    vi.mocked(answerSyncJoin).mockRejectedValue(new Error("the server is offline"));
    const { getByRole, getByText } = render(SyncJoinDialog);
    await send([LAPTOP]);
    await fireEvent.click(getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(toasts.items.map((t) => t.message)).toEqual([
        "Couldn't approve Work laptop: the server is offline",
      ]),
    );
    expect(getByText(title("Work laptop"))).toBeTruthy();
  });

  it("does not answer on Escape", async () => {
    const { getByRole } = render(SyncJoinDialog);
    await send([LAPTOP]);
    await fireEvent.keyDown(getByRole("alertdialog"), { key: "Escape" });
    expect(answerSyncJoin).not.toHaveBeenCalled();
    expect(getByRole("alertdialog")).toBeTruthy();
  });
});
