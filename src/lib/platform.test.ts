import { describe, expect, it } from "vitest";
import { platformName } from "./platform";

describe("platformName", () => {
  it("names the desktop platforms from the user agent", () => {
    expect(platformName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 0)).toBe("macOS");
    expect(platformName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", 0)).toBe("Windows");
    expect(platformName("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36", 0)).toBe("Linux");
  });

  it("tells an iPad from a Mac by its touch points, and names iOS", () => {
    expect(platformName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 5)).toBe("iPadOS");
    expect(platformName("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", 5)).toBe("iPadOS");
    expect(platformName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 5)).toBe("iOS");
  });

  it("falls back to Unknown", () => {
    expect(platformName("Something else", 0)).toBe("Unknown");
  });
});
