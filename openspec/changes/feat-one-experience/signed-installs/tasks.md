# Tasks: Signed installs

- [ ] `release.yml`: the macOS signing and notarization variables from
      secrets; the Windows signing step, conditional on the secrets
- [ ] `release-notes.mjs`: the install footer per signed state; test
- [ ] README: installing, per signed state
- [ ] CHANGELOG line

## Owner steps

Each step says what success looks like. Nothing here is run by a session.

### Apple (macOS)

1. Join the Apple Developer Program at https://developer.apple.com/programs/enroll/
   with the Jam-Sw Apple ID. Success: the account page shows a Team ID.
2. In Xcode or at https://developer.apple.com/account/resources/certificates/add
   create a **Developer ID Application** certificate. Export it from Keychain
   Access as a `.p12` with a password. Success: a `.p12` file on the Mac.
3. At https://appleid.apple.com, Sign-In and Security > App-Specific
   Passwords, make one named "InstantNotes notarization". Success: a
   16-character password shown once.
4. From the Mac, in a terminal (each prompts for its value; nothing is
   typed in the command line):

```
base64 -i ~/Downloads/DeveloperID.p12 | gh secret set APPLE_CERTIFICATE --repo Jam-Sw/InstantNotes
gh secret set APPLE_CERTIFICATE_PASSWORD --repo Jam-Sw/InstantNotes
gh secret set APPLE_SIGNING_IDENTITY --repo Jam-Sw/InstantNotes
gh secret set APPLE_ID --repo Jam-Sw/InstantNotes
gh secret set APPLE_PASSWORD --repo Jam-Sw/InstantNotes
gh secret set APPLE_TEAM_ID --repo Jam-Sw/InstantNotes
```

   `APPLE_SIGNING_IDENTITY` is the certificate's full name, for example
   `Developer ID Application: Jam-Sw (TEAMID1234)`. Success:
   `gh secret list --repo Jam-Sw/InstantNotes` shows the six names.
5. Delete the `.p12` from Downloads once the secret is set.

### Microsoft (Windows)

1. Create an Azure account at https://azure.microsoft.com (a subscription
   with a payment method). Success: the portal opens.
2. Create a **Trusted Signing** account (search "Trusted Signing" in the
   portal), Basic tier, in a region near you. Success: the account shows
   "Identity validation: pending".
3. Complete the identity validation (an individual or an organisation;
   Jam-Sw as an organisation needs its registration documents). Success:
   "Identity validation: completed".
4. Add a **certificate profile** of type Public Trust, named
   `instantnotes`. Success: the profile shows "Active".
5. Create an app registration (Microsoft Entra ID > App registrations) named
   `instantnotes-signing`, add a client secret, and give that app the role
   **Trusted Signing Certificate Profile Signer** on the signing account
   (Access control (IAM) on the account). Success: the role assignment is
   listed.
6. Set the secrets (each prompts):

```
gh secret set AZURE_TENANT_ID --repo Jam-Sw/InstantNotes
gh secret set AZURE_CLIENT_ID --repo Jam-Sw/InstantNotes
gh secret set AZURE_CLIENT_SECRET --repo Jam-Sw/InstantNotes
gh secret set AZURE_SIGNING_ENDPOINT --repo Jam-Sw/InstantNotes
gh secret set AZURE_SIGNING_ACCOUNT --repo Jam-Sw/InstantNotes
gh secret set AZURE_SIGNING_PROFILE --repo Jam-Sw/InstantNotes
```

   The endpoint is the account's URL (for example
   `https://eus.codesigning.azure.net`), the account its name, the profile
   `instantnotes`. Success: `gh secret list` shows all twelve names.

### Then

The next release signs both. Success: on a Mac, the downloaded `.dmg` opens
with no warning; on Windows, the installer shows "Verified publisher:
Jam-Sw" (SmartScreen may still warn for the first weeks).
