# Sync S4 production rollout report

Status: in progress on 2026-09-05; autonomous hardening complete, real-device
acceptance and Google Cloud audience confirmation remain.

## Implemented rollout safeguards

- Connected changes synchronize immediately and the acknowledged result reports
  the merged seen-title count.
- **Disconnect** remains non-destructive and keeps both local and Drive history.
- **Delete Drive history** is a distinct two-step action. It verifies the bound
  Google account, lists only validated Flixate app-data filenames, permanently
  deletes every matching device document, clears the local token/binding, and keeps
  the browser's seen history.
- The deletion copy warns that another connected device can recreate remote state.
- [SYNC-GUIDE.md](SYNC-GUIDE.md) documents normal use, merge/replacement, offline
  recovery, token renewal, disconnect, remote deletion, full removal, limitations,
  and owner configuration.

## Privacy and artifact audit

Both Pages workflows now run `npm run audit:production` after the production build
and before artifact upload. The check fails when:

- a real `.env` variant or generated output is tracked;
- a sensitive value available from CI or the local `.env` appears in the tracked
  tree or production artifact;
- a Google access-token-shaped value appears in the Pages artifact;
- the service worker references Google Identity or Drive hosts; or
- the configured public OAuth client ID is malformed or absent from the production
  artifact.

The 2026-09-05 local audit passed. Repository history contains only the intentional
`.env.example` environment template. The repository OAuth variable has the expected
Web client-ID format. The generated service worker caches same-origin app/catalog
assets and TMDB posters, with no Google Identity or Drive route.

The audit intentionally permits the public OAuth client ID in JavaScript. The TMDB
token remains a catalog-workflow secret and is checked against the built artifact
when that workflow runs.

GitHub Pages does not provide repository-controlled response headers. The app now
uses a `no-referrer` document policy. A meta-delivered Content Security Policy is
deferred until the authenticated desktop/Android matrix can verify every Google
Identity popup and Drive request; deploying an unverified allowlist would risk
silently disabling the feature it is meant to protect.

## Automated verification

Coverage includes validated-file-only REST deletion, account-safe deletion of every
listed sync document, retention of local state after deletion/disconnect, explicit
two-step UI confirmation, and the existing state, transport, OAuth, catalog, backup,
and PWA behavior. The completed local pass contains 86 unit/integration tests.

## Live acceptance already completed

- Desktop Chrome initial authorization and Drive round trip.
- Saved-token reload without an account chooser.
- Simulated expiry followed by optimized, self-closing reauthorization.
- First connection, explicit merge choice, immediate seen upload, and manual sync.
- Hard refresh with automatic startup sync.
- Complete site-data deletion followed by a fresh merge that restored Drive history.

## Remaining manual gates

1. In Google Cloud, confirm the production Web client has only the exact production
   origin `https://hnsr.github.io` (use a separate client/project for localhost if
   strict production separation is desired).
2. Confirm the OAuth audience. **Testing** requires every user to be allowlisted and
   authorizations expire after seven days; **In production** is the lower-friction
   choice for the intended few personally known users.
3. Connect a second desktop profile/device to the same account. Change different
   titles on each side, then change the same title later on one side and verify both
   converge after reload/sync.
4. Make an offline seen and unseen change, restore connectivity, and verify the
   merged count and visible state.
5. Repeat one round trip in Android Chrome and an installed PWA if that installation
   mode will be used.
6. Exercise **Disconnect** and the new destructive deletion flow only with disposable
   test history or after exporting a backup.

Passing items 1–5 closes S4. Item 6 is a privacy-control acceptance check and may be
deferred until a disposable account/history is convenient.
