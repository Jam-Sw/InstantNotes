import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { setSetting } from "$lib/api/client";
import { agents } from "$lib/stores/agents.svelte";
import SettingsAgents from "./SettingsAgents.svelte";

vi.mock("$lib/api/client", () => ({
  getAgentConnection: vi.fn().mockResolvedValue(null),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  cleanup();
  agents.tags = {};
  agents.blocked = [];
  vi.clearAllMocks();
});

describe("SettingsAgents tags", () => {
  it("saves the tags typed for a kind of agent, trimmed and without repeats", async () => {
    const { getByLabelText } = render(SettingsAgents);
    const field = getByLabelText("Tags for Codex") as HTMLInputElement;
    await fireEvent.input(field, { target: { value: " #ai, codex ,ai," } });
    await fireEvent.change(field);
    expect(setSetting).toHaveBeenCalledWith("agents.tags", { codex: ["ai", "codex"] });
    expect(field.value).toBe("ai, codex");
  });

  it("blocks and unblocks a kind of agent from its row", async () => {
    const { getByLabelText } = render(SettingsAgents);
    const box = getByLabelText("Block Codex") as HTMLInputElement;
    await fireEvent.click(box);
    expect(setSetting).toHaveBeenLastCalledWith("agents.blocked", ["codex"]);
    expect(box.checked).toBe(true);
    await fireEvent.click(box);
    expect(setSetting).toHaveBeenLastCalledWith("agents.blocked", []);
  });

  it("drops a kind of agent from the setting once its tags are cleared", async () => {
    agents.tags = { codex: ["codex"], hermes: ["hermes"] };
    const { getByLabelText } = render(SettingsAgents);
    const field = getByLabelText("Tags for Codex") as HTMLInputElement;
    expect(field.value).toBe("codex");
    await fireEvent.input(field, { target: { value: "" } });
    await fireEvent.change(field);
    expect(setSetting).toHaveBeenCalledWith("agents.tags", { hermes: ["hermes"] });
  });
});
