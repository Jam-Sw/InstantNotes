# Design: Signed installs

The pipeline signs every build the moment the secrets exist, and ships
unsigned until then, so adding the accounts later changes nothing in the
code. Nothing secret is ever in the repository or in a session.

## 1. macOS: Developer ID and notarization

Tauri's bundler signs with the identity named by `APPLE_SIGNING_IDENTITY`
(or imports a certificate from `APPLE_CERTIFICATE` and
`APPLE_CERTIFICATE_PASSWORD` into a temporary keychain on the runner) and
notarizes the `.app` and the `.dmg` when `APPLE_ID`, `APPLE_PASSWORD` (an
app-specific password) and `APPLE_TEAM_ID` are set. The `macos` job passes
all of them from secrets; empty secrets mean the bundler sees no variable
and ad-hoc signs as today. `tauri.conf.json` keeps `signingIdentity: "-"`
as the default the environment overrides.

The updater's `.app.tar.gz` holds the same signed, notarized app, and the
minisign signature on top of it stays as it is.

With a signed build, the README's "xattr" paragraph and the release notes'
first-install footer change to "open it"; `release-notes.mjs` prints the
unsigned footer only when the release has no signed macOS asset, decided by
a `signed` flag the workflow passes.

## 2. Windows: Azure Trusted Signing

The `windows` job builds on `windows-latest` and, when `AZURE_TENANT_ID`,
`AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SIGNING_ENDPOINT`,
`AZURE_SIGNING_ACCOUNT` and `AZURE_SIGNING_PROFILE` exist, signs the
installer and the app binary with `azure/trusted-signing-action` after the
bundle step. SmartScreen reputation builds from the first signed release;
the README says the warning fades over the first weeks.

Rejected: a certificate on a hardware token (the key must stay on this PC,
the opposite of `release-chain`); an OV certificate as a `.pfx` (CAs no
longer issue exportable keys); `osslsigncode` on Linux (no cloud HSM
support for Trusted Signing).

## 3. Linux

AppImages carry no platform signature; the minisign updater signature is
the integrity check, as before.

## 4. Owner steps

In `tasks.md`, in order, with what each one produces. The secrets are set
with `gh secret set` from his machine; the session never sees a value.
