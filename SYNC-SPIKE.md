# Google Drive OAuth feasibility spike

Status: localhost round trip and optimized reconnect passed on 2026-09-02;
deployed-device checks pending

## Purpose

This spike answers the S0 questions in [SYNC-PLAN.md](SYNC-PLAN.md) before Flixate's
real personal state is connected to Google Drive. It verifies that a browser-only
PWA can obtain the narrow `drive.appdata` permission and round-trip private app data
with acceptable user friction.

The probe is intentionally isolated. It never reads or uploads seen state, filters,
backups, or catalog data. It writes only this hidden test file:

```text
appDataFolder/flixate-oauth-spike.json
```

The file contains a format marker, schema version, random nonce, and timestamp. Each
successful rerun updates the same file and downloads it again to verify the exact
nonce. The current experiment persists the short-lived OAuth access token and its
exact expiry in local storage so reload continuity can be measured. The remembered
account remains after token expiry and is used as Google's `login_hint`.

## Configuration

The ignored local `.env` must contain the public browser client ID:

```dotenv
VITE_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
```

The Google OAuth client needs these authorized JavaScript origins:

```text
http://localhost:5173
https://hnsr.github.io
```

Only this scope should be configured and requested:

```text
https://www.googleapis.com/auth/drive.appdata
```

No client secret, API key, billing credential, or redirect URI belongs in Flixate.

## Deployed probe flag

The production build receives the public client ID through the
`VITE_GOOGLE_CLIENT_ID` GitHub repository variable, not a secret. The normal Pages
app keeps the development probe hidden. Enable it for the current browser profile
with:

```text
https://hnsr.github.io/flixate/?drive-spike=1
```

The flag persists in local storage so an installed PWA on the same profile can be
launched and tested. Disable and forget the probe flag afterward with:

```text
https://hnsr.github.io/flixate/?drive-spike=0
```

Neither URL contains an OAuth token or personal state.

## Local interactive test

1. Start Flixate with `npm run dev` and open the exact URL printed by Vite. If Vite
   chooses a port other than 5173, stop the conflicting process or register that
   exact origin in the OAuth client.
2. Scroll below the catalog to **Google Drive OAuth feasibility**.
3. Click **Connect and test Drive**.
4. Select the configured Google test account and inspect the consent text before
   accepting. It must describe only Flixate's own Drive application data, not broad
   access to visible Drive files.
5. Wait for **Drive round trip passed**. Record the account, whether the file was
   created or updated, total time, and token expiry shown by the probe.
6. Reload the page and click **Test Drive using saved token**. It should run without
   opening Google while the original token remains valid.
7. Click **Simulate token expiry**. This removes only the saved token, deliberately
   retaining the account hint and Google grant.
8. Click **Test expired-token reconnect**. Record whether Google shows an account
   picker, consent, a brief self-closing popup, or no visible UI, and verify that the
   result says `updated`.

If the dialog reports `origin_mismatch`, confirm that the browser origin exactly
matches an authorized JavaScript origin. If Drive returns 403, confirm the Drive API
is enabled and the selected account is listed in the OAuth app's testing audience.

## Automated coverage

The unit suite verifies:

- the token request contains exactly `drive.appdata`;
- a repeat request uses an empty prompt and the remembered account hint;
- only unexpired saved tokens are restored while account identity survives expiry;
- the browser OAuth client ID is passed without any client secret;
- every Drive request uses the current bearer token without exposing it;
- a new file is created under `appDataFolder`;
- an existing probe file is updated rather than duplicated; and
- a download with a different nonce is rejected.

Run the normal checks with:

```bash
npm run typecheck
npm test
npm run build
```

## Measured localhost result

The interactive probe passed in desktop Chrome on 2026-09-02. Authorization,
account lookup, `appDataFolder` listing, writing, downloading, and exact nonce
validation all completed successfully. A second run reported `updated`, confirming
that Flixate found and reused the existing probe file instead of creating a
duplicate.

The measured second-run time was 3,139 ms. Google issued a token with an indicated
lifetime of approximately one hour, as expected for the browser token flow. After
a full reload, the original probe again showed Google's account chooser because the
request used the library's default `select_account` prompt. That result identified
a correctable probe behavior rather than a platform limitation. With the revised
probe, a valid saved token survived a reload with no popup. After simulated expiry,
the empty prompt plus remembered email produced only a brief self-closing popup:
there was no account selection, consent, or other user input. This is acceptable for
the backend-free design and is the best supported Google browser-token behavior.

## Evidence matrix

| Environment | Authorization | Account ID | List | Write | Read/validate | Reconnect UX |
| --- | --- | --- | --- | --- | --- | --- |
| Desktop Chrome, localhost | Pass | Pass | Pass | Pass (update) | Pass: no UI while valid; brief automatic popup after expiry |
| Desktop Chrome, GitHub Pages | Pending | Pending | Pending | Pending | Pending | Pending |
| Android Chrome, GitHub Pages | Pending | Pending | Pending | Pending | Pending | Pending |
| Installed Android PWA | Pending | Pending | Pending | Pending | Pending | Pending |

The localhost result decides whether to prepare a temporary production probe. The
GitHub Pages/Android checks require the public client ID at build time; because a
client ID is not secret, it can later be supplied as a repository variable or
checked-in public configuration. That production change is not part of the local
probe yet.

## Go/no-go gate

S0 passes only if all target environments can round-trip the file using
`drive.appdata`, the optimized recurring authorization interaction is acceptable,
account identity is reliable, and neither a backend nor long-lived refresh
credential is needed.

On success, remove the visible development probe and proceed to S1's versioned
per-device state envelope and deterministic merge. On failure, remove the probe
without changing the existing local state implementation.
