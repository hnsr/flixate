# Sync S4 production rollout report

Status: completed on 2026-09-05 for the personal version-1 rollout. Automated
hardening, production configuration, desktop acceptance, and Android Chrome
cross-device recovery passed. Lower-value manual stress cases are consciously
deferred and documented below.

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
- The public homepage links to a Privacy Policy and Terms of Service, the Drive
  connection UI links directly to its Google-data disclosure, and the production
  OAuth brand has an exact 120×120 PNG logo.

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
- Android Chrome connected to the same Google account and restored the existing
  seen history, proving the version-1 cross-device outcome on the deployed app.
- The Google OAuth audience is External and In production. For this personal app it
  remains unverified under Google's fewer-than-100-user exception, accepting the
  user-facing unverified-app warning instead of Testing mode's recurring seven-day
  expiry.

## Accepted residual manual-test risk

The owner explicitly chose not to spend more time on an exhaustive manual matrix
after the real phone restored Drive-backed history successfully. The following
scenarios remain covered by automated tests and design safeguards but have not all
been repeated manually in production:

- concurrent edits to different titles from two active devices;
- competing later edits to the same title, including an unseen tombstone;
- extended offline edits followed by reconnection;
- a separate installed-PWA round trip; and
- the destructive remote-deletion flow with disposable history.

This is accepted for a free app used by the owner and a few known people. The
deterministic merge, offline retention, account mismatch, token expiry, and deletion
paths have automated coverage; JSON export remains the recovery escape hatch. Any
production report of lost or surprising state reopens the relevant S4 case rather
than requiring the complete matrix pre-emptively.

## Outcome

S4 and the promoted cross-device sync track are closed. Flixate now meets the
personal version-1 goal: optional Google Drive sync carries seen history between a
person's browsers without a Flixate server or database, while local-only use and
manual export/import remain available. Phase 4 refinement is unblocked.
