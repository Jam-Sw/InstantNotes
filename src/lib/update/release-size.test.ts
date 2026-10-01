import { describe, expect, it, vi } from "vitest";
import { fetchUpdateSizeDelta, selectAsset } from "./release-size";

const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";

const MAC_ASSETS = [
  { name: "InstantNotes_aarch64.app.tar.gz", size: 4_000_000 },
  { name: "InstantNotes_aarch64.app.tar.gz.sig", size: 400 },
  { name: "InstantNotes_0.9.0_aarch64.dmg", size: 9_000_000 },
];
const WIN_ASSETS = [
  { name: "InstantNotes_0.9.0_x64-setup.exe", size: 3_000_000 },
  { name: "InstantNotes_0.9.0_x64-setup.exe.sig", size: 400 },
];
const LINUX_ASSETS = [
  { name: "InstantNotes_0.9.0_amd64.AppImage", size: 80_000_000 },
  { name: "InstantNotes_0.9.0_amd64.AppImage.sig", size: 400 },
];

describe("selectAsset", () => {
  it("picks the updater artifact, not its signature or an installer", () => {
    expect(selectAsset(MAC_ASSETS, MAC_UA)?.size).toBe(4_000_000);
    expect(selectAsset(WIN_ASSETS, WIN_UA)?.size).toBe(3_000_000);
    expect(selectAsset(LINUX_ASSETS, LINUX_UA)?.size).toBe(80_000_000);
  });

  it("returns null when nothing matches", () => {
    expect(selectAsset(MAC_ASSETS, WIN_UA)).toBeNull();
    expect(selectAsset([], MAC_UA)).toBeNull();
  });
});

/** A fetch stand-in keyed by the release tag in the URL. */
function fakeFetch(byTag: Record<string, { name: string; size: number }[]>) {
  return vi.fn(async (url: string) => {
    const tag = Object.keys(byTag).find((t) => url.includes(`/tags/${t}`));
    return {
      ok: tag !== undefined,
      json: async () => ({ assets: tag ? byTag[tag] : [] }),
    } as Response;
  }) as unknown as typeof fetch;
}

describe("fetchUpdateSizeDelta", () => {
  it("diffs the running and offered updater artifacts", async () => {
    const fetchImpl = fakeFetch({
      "v0.9.0": [{ name: "InstantNotes_aarch64.app.tar.gz", size: 4_000_000 }],
      "v0.10.0": [{ name: "InstantNotes_aarch64.app.tar.gz", size: 5_200_000 }],
    });
    const delta = await fetchUpdateSizeDelta({
      currentVersion: "0.9.0",
      version: "0.10.0",
      userAgent: MAC_UA,
      fetchImpl,
    });
    expect(delta).toBe(1_200_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("is null when either release has no matching artifact", async () => {
    const fetchImpl = fakeFetch({
      "v0.10.0": [{ name: "InstantNotes_aarch64.app.tar.gz", size: 5_200_000 }],
    });
    expect(
      await fetchUpdateSizeDelta({
        currentVersion: "0.9.0",
        version: "0.10.0",
        userAgent: MAC_UA,
        fetchImpl,
      }),
    ).toBeNull();
  });

  it("is null, never a throw, when the network fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(
      await fetchUpdateSizeDelta({
        currentVersion: "0.9.0",
        version: "0.10.0",
        userAgent: MAC_UA,
        fetchImpl,
      }),
    ).toBeNull();
  });
});
