#!/usr/bin/env bash
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
