import { describe, expect, it } from "vitest";
import { notes, section } from "../.github/release-notes.mjs";
import { manifest } from "../.github/release-manifest.mjs";

const CHANGELOG = `# Changelog

## [Unreleased]

### Fixed
- Updater: restart into the installed update.

## [0.9.3] - 2026-10-02

### Fixed
- Errors: CONFLICT copy is per caller.
`;

describe("release notes", () => {
  it("takes a section's body up to the next release heading", () => {
    expect(section(CHANGELOG, "0.9.3")).toBe("### Fixed\n- Errors: CONFLICT copy is per caller.");
    expect(section(CHANGELOG, "0.1.0")).toBe("");
  });

  it("uses the version's own section, else [Unreleased], else a fallback", () => {
    expect(notes(CHANGELOG, "0.9.3")).toContain("CONFLICT copy");
    expect(notes(CHANGELOG, "0.9.4")).toContain("restart into the installed update");
    expect(notes("# Changelog\n", "0.9.4")).toMatch(/^Maintenance release/);
  });
});

describe("release manifest", () => {
  const base = {
    version: "0.9.4",
    repo: "Jam-Sw/InstantNotes",
    body: "notes",
    now: "2026-10-03T00:00:00.000Z",
    signature: (file: string) => `sig of ${file}\n`,
  };

  it("lists every platform that uploaded an artifact and its signature", () => {
    const { latest, missing } = manifest({
      ...base,
      assets: [
        "InstantNotes_0.9.4_amd64.AppImage",
        "InstantNotes_0.9.4_amd64.AppImage.sig",
        "InstantNotes_0.9.4_x64-setup.exe",
        "InstantNotes_0.9.4_x64-setup.exe.sig",
        "InstantNotes_0.9.4_aarch64.app.tar.gz",
        "InstantNotes_0.9.4_aarch64.app.tar.gz.sig",
      ],
    });
    expect(missing).toEqual([]);
    expect(Object.keys(latest.platforms).sort()).toEqual([
      "darwin-aarch64",
      "darwin-aarch64-app",
      "linux-x86_64",
      "linux-x86_64-appimage",
      "windows-x86_64",
      "windows-x86_64-nsis",
    ]);
    expect(latest.platforms["windows-x86_64"]).toEqual({
      signature: "sig of InstantNotes_0.9.4_x64-setup.exe.sig",
      url: "https://github.com/Jam-Sw/InstantNotes/releases/download/v0.9.4/InstantNotes_0.9.4_x64-setup.exe",
    });
  });

  it("leaves out a platform that failed, or uploaded no signature, and names it", () => {
    const { latest, missing } = manifest({
      ...base,
      assets: [
        "InstantNotes_0.9.4_amd64.AppImage",
        "InstantNotes_0.9.4_amd64.AppImage.sig",
        "InstantNotes_0.9.4_aarch64.app.tar.gz",
      ],
    });
    expect(missing).toEqual(["Windows", "macOS"]);
    expect(Object.keys(latest.platforms)).toEqual(["linux-x86_64", "linux-x86_64-appimage"]);
  });
});
