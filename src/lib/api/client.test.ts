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
  listWorkspaceTags,
  removeNoteFromWorkspace,
  renameWorkspace,
  setTagColor,
  setWorkspaceColor,
  setWorkspaceFlag,
  workspaceTagSlices,
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

  it("deleteWorkspace passes the id and returns the member note ids", async () => {
    invoke.mockResolvedValue(["n1", "n2"]);
    await expect(deleteWorkspace("w1")).resolves.toEqual(["n1", "n2"]);
    expect(invoke).toHaveBeenCalledWith("delete_workspace", { id: "w1" });
  });

  it("listWorkspaceTags passes the workspaceId", async () => {
    invoke.mockResolvedValue([]);
    await expect(listWorkspaceTags("w1")).resolves.toEqual([]);
    expect(invoke).toHaveBeenCalledWith("list_workspace_tags", {
      workspaceId: "w1",
    });
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
    expect(invoke).toHaveBeenCalledWith("workspaces_for_note", {
      noteId: "n1",
    });
  });

  it("setWorkspaceColor passes the id and the colour, null clears it", async () => {
    invoke.mockResolvedValue({ id: "w1", color: "blue", flag: false });
    await setWorkspaceColor("w1", "blue");
    expect(invoke).toHaveBeenCalledWith("set_workspace_color", {
      id: "w1",
      color: "blue",
    });
    await setWorkspaceColor("w1", null);
    expect(invoke).toHaveBeenLastCalledWith("set_workspace_color", {
      id: "w1",
      color: null,
    });
  });

  it("setWorkspaceFlag passes the id and the flag", async () => {
    invoke.mockResolvedValue({ id: "w1", color: null, flag: true });
    await setWorkspaceFlag("w1", true);
    expect(invoke).toHaveBeenCalledWith("set_workspace_flag", {
      id: "w1",
      flag: true,
    });
  });

  it("setTagColor passes the id and the colour", async () => {
    invoke.mockResolvedValue({ id: "t1", name: "work", color: "#ff0000" });
    await setTagColor("t1", "#ff0000");
    expect(invoke).toHaveBeenCalledWith("set_tag_color", {
      id: "t1",
      color: "#ff0000",
    });
    await setTagColor("t1", null);
    expect(invoke).toHaveBeenLastCalledWith("set_tag_color", {
      id: "t1",
      color: null,
    });
  });

  it("workspaceTagSlices calls workspace_tag_slices without arguments", async () => {
    const slices = [{ workspaceId: "w1", tagId: "t1", color: "red", noteCount: 2 }];
    invoke.mockResolvedValue(slices);
    await expect(workspaceTagSlices()).resolves.toEqual(slices);
    expect(invoke).toHaveBeenCalledWith("workspace_tag_slices", undefined);
  });

  it("maps structured backend errors to ApiError", async () => {
    invoke.mockRejectedValue({ code: "CONFLICT", message: "name taken" });
    const err = await renameWorkspace("w1", "Taken").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toBe("name taken");
  });
});
