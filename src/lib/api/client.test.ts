// Workspace API client wrappers: command names, argument shapes, and error
// mapping, with the Tauri invoke boundary mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import {
  addNoteToWorkspace,
  ApiError,
  getOrCreateWorkspace,
  listWorkspaces,
  removeNoteFromWorkspace,
  renameWorkspace,
  deleteWorkspace,
  workspacesForNote,
} from "./client";

beforeEach(() => {
  invoke.mockReset();
});

describe("workspace client wrappers", () => {
  it("listWorkspaces calls list_workspaces", async () => {
    invoke.mockResolvedValue([]);
    await expect(listWorkspaces()).resolves.toEqual([]);
    expect(invoke).toHaveBeenCalledWith("list_workspaces", undefined);
  });

  it("getOrCreateWorkspace passes the name", async () => {
    invoke.mockResolvedValue({ id: "w1", name: "Focus" });
    await getOrCreateWorkspace("Focus");
    expect(invoke).toHaveBeenCalledWith("get_or_create_workspace", {
      name: "Focus",
    });
  });

  it("renameWorkspace passes id and name", async () => {
    invoke.mockResolvedValue({ id: "w1", name: "Deep Work" });
    await renameWorkspace("w1", "Deep Work");
    expect(invoke).toHaveBeenCalledWith("rename_workspace", {
      id: "w1",
      name: "Deep Work",
    });
  });

  it("deleteWorkspace passes the id", async () => {
    invoke.mockResolvedValue(undefined);
    await deleteWorkspace("w1");
    expect(invoke).toHaveBeenCalledWith("delete_workspace", { id: "w1" });
  });

  it("membership wrappers pass noteId and workspaceId", async () => {
    invoke.mockResolvedValue(undefined);
    await addNoteToWorkspace("n1", "w1");
    expect(invoke).toHaveBeenCalledWith("add_note_to_workspace", {
      noteId: "n1",
      workspaceId: "w1",
    });
    await removeNoteFromWorkspace("n1", "w1");
    expect(invoke).toHaveBeenCalledWith("remove_note_from_workspace", {
      noteId: "n1",
      workspaceId: "w1",
    });
  });

  it("workspacesForNote passes the noteId", async () => {
    invoke.mockResolvedValue([]);
    await workspacesForNote("n1");
    expect(invoke).toHaveBeenCalledWith("workspaces_for_note", { noteId: "n1" });
  });

  it("maps structured backend errors to ApiError", async () => {
    invoke.mockRejectedValue({ code: "CONFLICT", message: "name taken" });
    const err = await renameWorkspace("w1", "Taken").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toBe("name taken");
  });
});
