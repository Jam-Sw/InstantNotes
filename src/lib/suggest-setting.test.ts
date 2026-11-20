import { describe, it, expect } from "vitest";
import { parseSuggestSetting, SUGGEST_DEFAULT } from "./suggest-setting";

describe("parseSuggestSetting", () => {
  it("is on and balanced until the user says otherwise", () => {
    expect(parseSuggestSetting(undefined)).toEqual(SUGGEST_DEFAULT);
    expect(parseSuggestSetting(null)).toEqual(SUGGEST_DEFAULT);
    expect(parseSuggestSetting("junk")).toEqual(SUGGEST_DEFAULT);
    expect(parseSuggestSetting({ enabled: "yes", showAt: "high" })).toEqual(SUGGEST_DEFAULT);
  });

  it("keeps what was saved and snaps a stray number to a step", () => {
    expect(parseSuggestSetting({ enabled: false, showAt: 0.7 })).toEqual({ enabled: false, showAt: 0.7 });
    expect(parseSuggestSetting({ enabled: true, showAt: 0.4 }).showAt).toBe(0.35);
    expect(parseSuggestSetting({ enabled: true, showAt: 0.68 }).showAt).toBe(0.7);
  });
});
