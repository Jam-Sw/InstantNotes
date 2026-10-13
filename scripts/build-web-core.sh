#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/static/web/pkg"
wanted=$(awk '/^name = "wasm-bindgen"$/ { getline; gsub(/[^0-9.]/, ""); print; exit }' "$root/src-tauri/Cargo.lock")
have=$(wasm-bindgen --version 2>/dev/null | awk '{ print $2 }' || true)

if [ "$have" != "$wanted" ]; then
  echo "error: wasm-bindgen $wanted is needed (found ${have:-none})." >&2
  echo "Install it with: cargo install wasm-bindgen-cli --version $wanted --locked" >&2
  exit 1
fi

cargo build --manifest-path "$root/src-tauri/Cargo.toml" -p instantnotes-web \
  --target wasm32-unknown-unknown --release --locked
rm -rf "$out"
wasm-bindgen --target web --no-typescript --out-dir "$out" \
  "$root/src-tauri/target/wasm32-unknown-unknown/release/instantnotes_web.wasm"
