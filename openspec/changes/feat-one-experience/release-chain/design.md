# Design: A release chain not tied to one PC

## 1. Today

`release.yml` runs every job on the self-hosted runner on the owner's PC:
Linux in a build root, Windows cross-compiled, macOS over ssh to his Mac,
which builds only while he runs a program there. If the PC is off, nothing
releases; if the Mac is asleep, macOS is missing. Signing for Windows and
macOS needs tools that do not run on Linux.

## 2. After (D2)

| Job | Runner | Why |
| --- | --- | --- |
| `plan` | `ubuntu-22.04` | Reads the version, drafts the release |
| `linux` | `ubuntu-22.04` | The AppImage's glibc floor, the same as the build root |
| `windows` | `windows-latest` | NSIS natively; Trusted Signing's action |
| `macos` | `macos-latest` | Apple Silicon; the bundler signs and notarizes here |
| `image` | `ubuntu-22.04` | buildx, multi-arch |
| `publish` | `ubuntu-22.04` | `latest.json`, publishes |

Public repository: hosted runners cost nothing. `build.yml` already proves
the toolchain compiles on all three hosted images on every PR. The release
builds from the merge commit (checkout), never a working tree, as before.
The updater signing stays as it is (`TAURI_SIGNING_PRIVATE_KEY`).

Dropped: the PATH step, the build caches, `instantnotes-prune`, the Mac
builder step, `DOCKER_CONFIG`. `.claude/scripts/build.sh` and the Mac
builder stay for local smoke builds and are not touched.

Kept: each platform ships or fails on its own; `publish` writes
`latest.json` from whatever uploaded and names what is missing; a failed job
is re-run, then `publish`.

## 3. The signed artifacts

`signed-installs/design.md`: the variables on `macos`, the action on
`windows`, both inert without secrets.

## 4. The multi-arch image

`docker/setup-buildx-action` and `docker/setup-qemu-action`, then
`docker buildx build --platform linux/amd64,linux/arm64 --push`. The
Dockerfile's build stages are pinned to the build platform
(`FROM --platform=$BUILDPLATFORM`) and cross-compile for `aarch64` with
`gcc-aarch64-linux-gnu` when `TARGETARCH` is `arm64`; the final distroless
stage is the only per-platform stage and only copies files, so the emulator
is never asked to run a compiler. Local proof:
`docker buildx build --platform linux/arm64 .` completes and the binary is
`ELF 64-bit ARM aarch64`.

## 5. Rehearsal before a merge

The owner can run the workflow on the branch:
`gh workflow run release.yml --ref 0.10.1-pre`. It drafts `v0.10.1` at the
branch commit and uploads the artifacts to the draft. Before merging, the
draft must be deleted (`gh release delete v0.10.1 --yes`), or the merge
would publish a release whose tag points at the branch commit rather than
the merge commit. The release skill records this.

## 6. The web app's code hashes

The `image` job, after the push, copies `/app/ui` out of the pushed
`linux/amd64` image (`docker create` and `docker cp`; the distroless image
has no shell or `sha256sum`), hashes every file, and uploads
`web-code-sha256.txt` to the release. Both platforms copy the same `ui`
stage, built once on the build platform, so one list serves both. The
README's "The web app is code your server sends" paragraph says how to
compare: `docker create`, `docker cp <id>:/app/ui ./ui`, `sha256sum -c` in
`./ui` against the list, or the browser's view of a file. `publish` needs
`image`, so a failed image leaves the release a draft. This closes the
0.10.0 item "published web-code hashes".

## 7. Checks

actionlint on the file; `scripts/release.test.ts` extended for the signed
footer; the rehearsal is the owner's. `docs` for the release skill updated
(local tooling, not in the repository).
