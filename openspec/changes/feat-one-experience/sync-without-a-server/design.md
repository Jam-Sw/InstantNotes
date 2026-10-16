# Design: Sync for people without a server (decision record, D3)

A student will not run Docker and an identity provider. Today sync needs a
server someone runs. The app is complete with sync off, which is the default,
so nothing is broken; this record is about the people who want their notes
on their phone and have no server.

## 1. Options

### A. A Jam-Sw hosted sync service (recommended)

The server image as it is, run by Jam-Sw behind an identity provider Jam-Sw
runs (Pocket ID or Authentik, with sign-in by passkey or by email code, and
"Sign in with Apple" and Google as the IdP's upstreams). End-to-end
encryption is on by default, so the service holds ciphertext, cannot read a
note, and cannot recover a lost key; the recovery key and device approval
work unchanged. The app needs one preset: Settings > Sync > Sync server
offers "InstantNotes Sync" as the first address, and typing another address
still works. The people-dir and usage work of `server-operators` is what a
hosted operator needs for quotas.

Costs the owner: a VPS (one small machine runs hundreds of people; the
server is a single binary with SQLite per person), a domain, the IdP, and
the duty of care of running a service: backups of ciphertext, uptime,
abuse (rate limits exist), a privacy page, and account deletion. Free for
everyday use means a quota (for example 1 GB per person) and no payment
plan until one is needed.

### B. iCloud Drive as the folder

The Folder provider over the app's iCloud Drive container: no server, Apple
devices only (Windows through iCloud for Windows, Linux never), and three
things to prove first (placeholder files, coordinated access, iCloud's own
conflict copies mapped onto keep-both). Fits a native iOS app; leaves the
web app and Linux out, so it is a complement, not the answer.

### C. Community servers

A school or a club runs the server for its people; the design already fits
(`server-operators`). It depends on someone else's effort and reaches few.

## 2. Recommendation

A, with B as a later addition for the native iOS app. A shapes mobile: the
phone's first-run flow becomes "Sign in" rather than "Enter your server's
address", with the address field one tap away for self-hosters.

## 3. What this change does

Nothing in code. If the owner says A, the follow-up is one small unit: the
preset address and the first-run wording, plus the operations plan outside
this repository (the deployment, the IdP, the privacy page). The mobile unit
keeps the sign-in screen so that a preset drops in without redesign.
