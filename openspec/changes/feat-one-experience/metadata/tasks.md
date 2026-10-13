# Tasks: Package and repository metadata

- [x] `Dockerfile`: the OCI labels on the final stage (design §1)
- [x] `release.yml` image job: `--label` version, revision and created
- [x] `scripts/release.test.ts`: the Dockerfile names `source`,
      `description` and `licenses` (ran `npx vitest run scripts/release.test.ts`: 5 passed)
- [ ] `docker build` and `docker inspect` show the labels
- [x] CHANGELOG line

## Owner steps (GitHub)

Run from any folder. Success: the repository page shows the new About line,
the topics and the homepage link.

```
gh repo edit Jam-Sw/InstantNotes --description "Instant capture, organized knowledge. Local-first notes for Mac, Windows, Linux and the web, with end-to-end encrypted sync through a server you run." --homepage "https://github.com/Jam-Sw/InstantNotes/releases/latest"
```

```
gh repo edit Jam-Sw/InstantNotes --add-topic notes --add-topic note-taking --add-topic markdown --add-topic local-first --add-topic self-hosted --add-topic end-to-end-encryption --add-topic sync --add-topic tauri --add-topic svelte --add-topic rust --add-topic sqlite --add-topic cross-platform
```

The package page (https://github.com/orgs/Jam-Sw/packages/container/package/instantnotes-server)
takes its description and its repository link from the image labels at the
next push, which the 0.10.1 release does. One manual step remains if the
package was never made public: Package settings > Danger zone > Change
visibility > Public.
