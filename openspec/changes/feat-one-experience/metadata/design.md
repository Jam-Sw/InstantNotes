# Design: Package and repository metadata

## 1. The image

GHCR fills a package's description and its link to the repository from the
image's OCI labels. The `Dockerfile`'s final stage gets:

```
LABEL org.opencontainers.image.title="InstantNotes server" \
      org.opencontainers.image.description="Self-hosted sync for InstantNotes: end-to-end encrypted sync for the desktop apps and the web app, sign-in through your own identity provider." \
      org.opencontainers.image.source="https://github.com/Jam-Sw/InstantNotes" \
      org.opencontainers.image.url="https://github.com/Jam-Sw/InstantNotes#self-hosted-sync" \
      org.opencontainers.image.documentation="https://github.com/Jam-Sw/InstantNotes#self-hosted-sync" \
      org.opencontainers.image.licenses="PolyForm-Strict-1.0.0" \
      org.opencontainers.image.vendor="Jam-Sw"
```

The version and the revision change per build, so the release workflow
passes them: `--label org.opencontainers.image.version=$VERSION --label
org.opencontainers.image.revision=$GITHUB_SHA`, plus
`org.opencontainers.image.created` in RFC 3339.

The `source` label is what links the package to the repository on GHCR and
makes the repository README show on the package page; the description label
is the package's About text. Both take effect on the next push of the image,
so the 0.10.1 image carries them.

## 2. The repository

Owner steps, written out in `tasks.md`: the About line, the homepage (the
releases page) and the topics, through `gh repo edit`. The topics name what
the project is to someone searching: notes, note-taking, markdown, local-first,
self-hosted, end-to-end-encryption, sync, tauri, svelte, rust, sqlite,
cross-platform, linux, macos, windows.

## 3. Checks

`docker build` of the image and `docker inspect` showing the labels; the
labels are also asserted by a test that reads the Dockerfile
(`scripts/release.test.ts`), so a future edit cannot drop them silently.
