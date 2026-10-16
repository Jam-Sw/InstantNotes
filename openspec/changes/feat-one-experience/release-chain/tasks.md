# Tasks: A release chain not tied to one PC

- [x] `release.yml` on hosted runners (design §2) with signing (§3), the
      multi-arch image (§4) and the hashes (§6); actions pinned by commit
      SHA; `publish` needs `image`
- [x] `Dockerfile`: cross-compiling build stages; proof: `docker buildx build
      --platform linux/amd64,linux/arm64 --output type=local` on a Linux
      x86_64 host with no QEMU registered: `file` gives `ELF 64-bit x86-64`
      and `ELF 64-bit ARM aarch64` for `/usr/local/bin/instantnotes`
- [x] actionlint green (`rhysd/actionlint:latest`, shellcheck on, exit 0)
- [x] `release-manifest.mjs` logic unchanged (only the footer import);
      `release-notes.mjs` footer per signed state (with `signed-installs`);
      `scripts/release.test.ts` "install footer", 8/8 pass
- [ ] README: the hashes paragraph (text handed to the integrator);
      the local release checklist (text handed to the integrator)
- [ ] CHANGELOG lines (integrator)
