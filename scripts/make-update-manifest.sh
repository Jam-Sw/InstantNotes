#!/usr/bin/env bash
# Build latest.json for the in-app updater from a signed release build.
#
# ============================ macOS-ONLY FALLBACK =============================
# This writes a latest.json with ONLY the darwin-aarch64 platform. Since 0.7.0
# ships Windows and Linux too, publishing this manifest to a real release would
# strand every non-macOS install (their updater reads a manifest that omits
# their platform). Use it only for a local, macOS-only test build. The real
# multi-platform manifest is assembled by .github/workflows/release.yml, which
# merges all three platforms; ship releases with a tag push, not this script.
# =============================================================================
#
# Run after `npm run tauri build` (with TAURI_SIGNING_PRIVATE_KEY_PATH set so
# the .sig exists), then upload latest.json AND InstantNotes.app.tar.gz to the
# GitHub release. The app polls:
#   https://github.com/Jam-Sw/InstantNotes/releases/latest/download/latest.json
set -euo pipefail

echo "warning: this writes a macOS-only (darwin-aarch64) latest.json. Do NOT use" >&2
echo "it to publish a multi-platform release; it would break Windows and Linux"   >&2
echo "updaters. For real releases push a v* tag and let release.yml build."       >&2

REPO="Jam-Sw/InstantNotes"
BUNDLE_DIR="src-tauri/target/release/bundle/macos"
ARCHIVE="$BUNDLE_DIR/InstantNotes.app.tar.gz"
SIG="$ARCHIVE.sig"

VERSION=$(node -p "require('./package.json').version")

if [[ ! -f "$ARCHIVE" || ! -f "$SIG" ]]; then
  echo "error: $ARCHIVE or its .sig is missing." >&2
  echo "Build with updater artifacts first:" >&2
  echo "  TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/instantnotes.key npm run tauri build" >&2
  exit 1
fi

SIGNATURE=$(cat "$SIG") \
VERSION="$VERSION" \
URL="https://github.com/$REPO/releases/download/v$VERSION/InstantNotes.app.tar.gz" \
node -e '
const { VERSION, SIGNATURE, URL } = process.env;
const manifest = {
  version: VERSION,
  pub_date: new Date().toISOString(),
  platforms: {
    "darwin-aarch64": { signature: SIGNATURE, url: URL },
  },
};
require("fs").writeFileSync("latest.json", JSON.stringify(manifest, null, 2) + "\n");
'

echo "wrote latest.json for v$VERSION"
echo "next: gh release create v$VERSION <dmg> <app.zip> \"$ARCHIVE\" latest.json ..."
