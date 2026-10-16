# Decision D3: Sync for people without a server

Status: awaiting the owner's answer. Recorded 2026-10-15.

## The question

Sync today needs a server someone runs. The app is complete with sync off,
which is the default. Should Jam-Sw give people who have no server a way to
sync, and which?

## The owner's options

| | A. Hosted service | B. iCloud Drive folder | C. Community servers | D. Nothing for now |
| --- | --- | --- | --- | --- |
| Who it reaches | everyone, every platform, the web app | Apple devices only | the members of a school or club that runs one | self-hosters only |
| Code in the app | a preset address and first-run wording (one small unit) | the Folder provider over the app's iCloud container, plus three proofs (placeholders, coordinated access, conflict copies) | none | none |
| Ongoing cost to the owner | a small VPS, a domain, an identity provider, backups of ciphertext, uptime, abuse handling, a privacy page, account deletion | none | none | none |
| Privacy | end-to-end encrypted by default; the service holds ciphertext and cannot read or recover a note | Apple holds the files, unencrypted by the app | whatever the operator does; encryption is still on by default | unchanged |
| Risk | running a service is a duty that does not end; quotas needed (for example 1 GB per person) | iCloud's own behaviour must be proven; Linux and Windows-without-iCloud left out | depends on someone else's effort | people who want their phone synced keep asking |

## Recommendation

A, with B later as a complement for a native iOS app. A is the only option
that reaches the web app, Linux and Windows, and its privacy story is the
strongest because the service never holds readable notes. It also settles the
mobile first-run screen: "Sign in" first, with the address field one tap
away for self-hosters.

If the owner does not want to run a service now, D is safe: nothing is
broken, and the mobile unit keeps its sign-in screen shaped so that a preset
can drop in later without a redesign.

## What the owner needs to answer

1. A, B, C or D (or A now and B later).
2. If A: the quota per person, and whether sign-in is by passkey and email
   code only or also through Apple and Google upstreams.
3. If A: the service's name as the app shows it (the design says
   "InstantNotes Sync").

## The follow-up if A

One unit, `sync-preset`:

- Settings > Sync > Sync server lists the hosted address first; typing
  another address still works.
- The first-run and mobile sign-in screens say "Sign in" with the address
  one tap away.
- Tests: the preset is offered, an address typed by hand wins, the web
  build shows the same.
- Outside this repository: the deployment, the identity provider, the
  privacy page and account deletion.
