# InstantNotes

Instantly externalize your writing. Capture and locate your thoughts.

> **02/10/2026: Use InstantNotes directly inside Claude Code, with offical UI mods** <br/> Search, read, and capture notes directly inside [Claude Code](https://claude.com/product/claude-code)! <br/> Get the new `instantnotes` plugin from [toolbox](https://github.com/jamubc/toolbox).<br/>
Usage: 
>
> ```
> /plugin marketplace add jamubc/toolbox
> /plugin install instantnotes@toolbox
> ```
>
> Explore notes with `/notes` or take ***an instant note*** with `/note <text>`. <br/>
Usage: See the [plugin's readme](https://github.com/jamubc/toolbox/tree/main/plugins/instantnotes) for more details.

## Features

- **Quick Capture:** Global hotkey (`Opt` / `Ctrl+Shift+Space`) with drafts.
- **Command Palette:** `Cmd/Ctrl+P` for actions, search, and themes.
- **Flexible Organization:** Group notes with Spaces and `#inline` tags instead of strict folders.
- **Plain Markdown Vault and Sync:** Keep every note as a Markdown file in a folder you choose, readable in any editor. Point several devices at the same folder (a network drive, Syncthing, Dropbox) and they stay in sync; edits made in the folder come back in.
- **Agents, on your terms:** Connect Claude Code, Codex, or Cursor over MCP (Settings > Agents). Off until you turn it on; what an agent reads or changes lights up as it happens, every call is traced, and every change can be reverted.
- **Themes:** Eight built-in themes with live previews, light and dark, shareable as files.
- **Self-hosted sync:** Run the InstantNotes server on your own machine and sync one library across the desktop apps and any browser. The web app works on phones and tablets: one pane at a time on a phone, side by side on a tablet, with touch-sized controls and a command button for the palette. Notes are end-to-end encrypted by default: the server stores only ciphertext.
- **100% Local & Private:** Your library lives in a local SQLite database, and in the vault folder if you set one. No server unless you run your own, zero telemetry.

## Installation
> The builds are unsigned, You will likely be prompted on first launch.
Download the latest build for your platform from the [releases page](../../releases). 

### macOS (Apple Silicon)

Download the `.dmg`, open it, and drag InstantNotes to Applications. 
The app is not notarized, macOS blocks the first launch with an "Apple could not verify" message. 
Clear the quarantine flag and it opens normally from then on:

```sh
xattr -d com.apple.quarantine /Applications/InstantNotes.app
```

Alternatively, after the blocked first launch, open System Settings, go to Privacy and Security, scroll down, and click "Open Anyway". On macOS 14 and earlier, right-click the app and choose Open instead.

### Windows (x64)

Download release then run installer. 
You will get a SmartScreen flags due to the unsigned build: 
    1. To proceed --> click "More info", then "Run anyway".

## Self-hosted sync

Sync is a choice in Settings > Sync, per library: Off (the default), Folder, or Sync server. Sync server keeps one library in step across your desktop apps and browsers through a server you run. Every device keeps its full copy and works offline; edits made in two places at once are both kept, the other copy tagged `conflict`.

### Run the server

```
docker run -d --name instantnotes \
  -p 8080:8080 \
  -v /srv/instantnotes:/data \
  -e INSTANTNOTES_PUBLIC_URL=https://notes.example.org \
  -e INSTANTNOTES_OIDC_ISSUER=https://id.example.org \
  -e INSTANTNOTES_OIDC_CLIENT_ID=instantnotes \
  -e INSTANTNOTES_OIDC_CLIENT_SECRET=change-me \
  ghcr.io/jam-sw/instantnotes-server:0.10.1
```

| Setting | Required | Meaning |
| --- | --- | --- |
| `INSTANTNOTES_PUBLIC_URL` | yes | The address people type. Must be `https://` unless it is `localhost`. |
| `INSTANTNOTES_OIDC_ISSUER` | yes | Your identity provider's issuer URL (any OpenID Connect provider: Pocket ID, Authentik, Keycloak, Authelia, Zitadel, Kanidm, Dex). |
| `INSTANTNOTES_OIDC_CLIENT_ID`, `INSTANTNOTES_OIDC_CLIENT_SECRET` | yes | A confidential client at that provider. |
| `INSTANTNOTES_DATA_DIR` | set by the image (`/data`) | Everything the server keeps. Back it up. |
| `INSTANTNOTES_LISTEN` | set by the image (`0.0.0.0:8080`) | Address and port to listen on. |
| `INSTANTNOTES_TRUST_PROXY` | no | `true` behind a reverse proxy that sets `X-Forwarded-For`, so rate limits see the real client. |
| `INSTANTNOTES_MAX_OBJECT_MB` | no | Largest single object the server accepts, default `64`. |
| `INSTANTNOTES_PEOPLE_DIR` | no | Where each person's notes live, for example `/people/{username}/notes` (`{sub}`, `{username}`, `{email}`), so each can sit under their own disk quota. Unset: under `INSTANTNOTES_DATA_DIR`. |
| `INSTANTNOTES_SIGN_IN_STYLESHEET` | no | An `https://` address or same-origin path of a stylesheet the sign-in page loads after its own; override `--bg`, `--glow`, `--ink`, `--accent` and `--accent-ink` on `:root`. |

- **At your identity provider**: create one confidential client with the scopes `openid profile email`, the redirect URI `https://<your address>/auth/callback`, and the post-logout redirect URI `https://<your address>`. Allow it the refresh token grant and, where the provider offers it, the `offline_access` scope. The desktop apps need nothing registered: they sign in through your server.
- **In front**: a reverse proxy with TLS, with a read timeout above 30 seconds (devices hold one request open for up to 25 seconds to hear about changes).
- **After a deploy**: `docker exec instantnotes instantnotes check` proves the encrypted sync path end to end as a reserved test person and cleans up after itself; it prints `ok` (exit 0) or the step that failed (exit 1). Add `--url http://127.0.0.1:8080` to test from inside the container.
- **Usage**: `docker exec instantnotes instantnotes usage` (or `--json`) lists each person's disk use.
- **Read-only root**: the server writes only to `/data` and the people folders, so `--read-only` (compose `read_only: true`) works with those volumes owned by uid 1000, and no tmpfs.
- **Platforms**: the image is published for `linux/amd64` and `linux/arm64`. Building it yourself needs BuildKit (`docker buildx build`); the legacy `docker build` stops at the first `FROM`.
- **Health**: `GET /healthz` answers `200 ok`, or `503` with the reason (data folder not writable, the identity provider check misconfigured).
- **Who can sign in** is decided at your identity provider; everyone it lets through gets their own library, and nobody can read anyone else's. When the provider stops accepting a person (disabled, deleted, removed from the app), the server signs out all their devices at its next hourly check, while keeping their stored data. This needs a provider that re-checks the person when a sign-in is refreshed (Pocket ID, Authentik, Keycloak, Zitadel and Kanidm do; Authelia does not, and Dex depends on its connector). Without refresh tokens, devices sign in again every 24 hours.

### Connect a device

In Settings > Sync, choose Sync server, type the server's address, and sign in. The first device makes the library's encryption key and shows a recovery key to keep somewhere safe. Each further device is approved from one you already use, after checking that the same six words show on both.

On a computer with no browser (a container or a remote desktop), the app shows a short code and an address instead: open the address on any other device, type the code, sign in, and allow. Set `INSTANTNOTES_SIGN_IN=code` in the app's environment to always sign in this way.

### What the server can and cannot see

With end-to-end encryption on (the default), notes, titles, tags, Spaces and images are encrypted on your device before they leave it. The server, its operator and its backups hold only ciphertext and never the key. They can still see who signs in, from which devices and when, and roughly how many notes and images there are and how large. If you lose the recovery key and every device, nobody can recover the notes, including whoever runs the server.

The encryption switch is in Settings > Sync. Turned off, the server stores notes readable, and a new device only needs to sign in.

The web app is code your server sends to your browser. Whoever controls the server, or the image it runs, could change that code. For the strongest protection, use the desktop app.

Each release lists the SHA-256 of every web app file in `web-code-sha256.txt`. To check an image: `id=$(docker create ghcr.io/jam-sw/instantnotes-server:<version>) && docker cp $id:/app/ui ./ui && docker rm $id`, then in `./ui` run `sha256sum -c web-code-sha256.txt`.

## Development
To build from source instead

### Prerequisites

- macOS, Windows, Linux
- [Rust](https://rustup.rs/) via rustup (the version is pinned by `rust-toolchain.toml`)
- Node.js 22+
- Windows: the Visual Studio Build Tools with the C++ workload

<details>
<summary>Arch / CachyOS Linux</summary>

Install system dependencies:
```sh
paru -S --needed webkit2gtk-4.1 base-devel openssl libayatana-appindicator librsvg squashfs-tools
```

If using system `rust` instead of `rustup`, configure `~/.cargo/config.toml`:
```toml
[target.x86_64-unknown-linux-gnu]
linker = "gcc"
```

To build local bundles (`npm run tauri build`):
```sh
NO_STRIP=1 npm run tauri build -- --config '{"bundle":{"createUpdaterArtifacts":false}}'
```
</details>

### Run the app

```sh
npm install
npm run tauri:dev
```

### Test

```sh
cargo test --workspace --manifest-path src-tauri/Cargo.toml  # Rust tests (app and core)
npm run check                                                # type-check frontend (runs svelte-kit sync)
npm test                                                     # frontend unit tests (Vitest)
```

### Build

```sh
npm run tauri build
```

Produces the platform's bundles under `src-tauri/target/release/bundle/`: an `.app` and `.dmg` on macOS, an NSIS `-setup.exe` on Windows, and an `.AppImage` on Linux. The builds are unsigned (macOS is ad-hoc signed, not notarized), so downloaded copies require the first-launch steps described under [Installation](#installation). Builds made locally on your own machine open normally.

### Release (with self-update)

The app checks GitHub Releases for updates on launch and every 6 hours, via `latest.json` attached to the latest release. 

Release's are shown on update panel
Releases are built, signed, and published by CI:

```sh
# 1. Add a "## [X.Y.Z]" section to CHANGELOG.md describing the release.
# 2. Bump every version file in lockstep:
npm run bump X.Y.Z
# 3. Commit, tag, and push; .github/workflows/release.yml builds macOS, Windows,
#    and Linux in a matrix and assembles a draft release with a merged latest.json.
git commit -am "chore: bump version to X.Y.Z"
git tag vX.Y.Z && git push origin vX.Y.Z
# 4. Smoke test the draft's artifacts, then publish the draft to ship.
```

`npm run bump` updates package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, and src-tauri/Cargo.lock together (the `instantnotes-core` crate versions independently). Publishing the smoke-tested draft is the deliberate ship gate; the draft stays invisible to the in-app updater until then.

CI signs the updater artifact with the minisign key stored in the repo secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and the app verifies downloads against the matching public key in `tauri.conf.json`.


Product requirements and conventions live in [`openspec/`](openspec/):

- [`openspec/specs/instantnotes/spec.md`](openspec/specs/instantnotes/spec.md): requirements and scenarios
- [`openspec/project.md`](openspec/project.md): tech stack, architecture, and workflow conventions

### Contributing

This is a private project developed by the jam-sw team.

- Each branch should contain one clear product step
- All changes land via pull request into `main`
- Commit subjects stay short and concrete; bodies explain what changed in one or two sentences
- Core behavior is covered with Rust tests against SQLite, frontend utilities with Vitest, and components must pass `svelte-check`

## License

InstantNotes is source-available under the [PolyForm Strict License 1.0.0](LICENSE.md).
You can read the code and use the app for personal, noncommercial purposes. Using it for
a business or paid work, redistributing it, or publishing modified versions needs a
commercial license from Jam-Sw: write to jam.sw.org@gmail.com. Installing or using the
app means agreeing to the [end user license agreement](src-tauri/installer/EULA.txt).
