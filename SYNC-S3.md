# Sync S3 implementation and rollout report

Status: implemented on 2026-09-02; deployed acceptance pending

## Outcome

Google Drive synchronization is now connected to Flixate's real seen-history flow.
Seen actions remain immediate and local, while connected browsers schedule S2's
debounced synchronization afterward. The old query-gated OAuth probe is no longer
rendered; the production controls use the same public OAuth client configuration.

## Local-state integration

S1's hybrid-clock state is now the app's canonical personal state. On first load,
Flixate migrates the existing `UserStateV1` history and merges it with any newer
local sync document without changing visible seen/unseen decisions. It continues to
write the old representation for JSON backup compatibility and rolling cross-tab
compatibility.

Every seen action and backup import:

1. updates the canonical in-memory state;
2. persists both the versioned local sync document and compatible user state;
3. updates React immediately; and
4. schedules sync only afterward when an account is connected.

The same-tab state adapter is also the S2 engine's storage boundary, ensuring merged
Drive state is committed locally before upload. Storage events merge changes from
other Flixate tabs without creating write loops.

## Account and sync experience

The top bar exposes a compact state such as `Local only`, `Connected`, `Syncing…`,
`Synced at …`, `Waiting to sync`, or `Reconnect to sync`. Its dialog explains that
Flixate uses only hidden Google Drive app data and has no account backend.

First connection and account switching do not bind or read personal Drive state
until the user explicitly chooses:

- **Merge browser and Drive** — the focused and recommended action; keep the newest
  decision for each title.
- **Use Drive state here** — replace local personal state from the selected account.
  The dialog warns that local history can disappear and provides **Export first**.

If replacement cannot safely read the remote documents, local state remains intact
and the previous account binding is restored. Account mismatch still stops before
personal files are listed. Disconnect forgets the local token and binding but keeps
local history and does not delete remote data.

## Authorization and failure behavior

Google Identity is preloaded when sync is configured so a seen or import button
retains the user activation required for optimized authorization. A connected user
with an expired token does not need to find a reconnect button: the next local
history interaction requests a token immediately using an empty prompt and the
remembered email hint, then synchronizes. **Sync now** provides the same recovery
path explicitly.

OAuth, offline, malformed-file, and Drive failures never roll back the local user
action. Status text explains whether Flixate is waiting, needs reconnection, or
ignored a corrupt Drive document. Rapid actions are debounced, and an edit during an
active sync causes at most one follow-up pass.

## Accessibility and responsive behavior

The sync dialogs use labelled modal semantics, move focus into the active dialog,
trap Tab/Shift+Tab, close with Escape, and return focus to the sync trigger. Busy and
unavailable actions are disabled, status updates use live semantics, and the compact
top-bar control remains labelled for assistive technology when its visible text is
hidden on narrow screens. Mobile layouts stack account details and actions.

## Automated verification

The suite now covers local migration and hybrid-stamp preservation, React persistence,
first-connect account inspection without early binding, explicit merge/replacement,
replacement safety, optimized interaction-triggered reconnection with the login
hint, modal actions and focus, cross-device engine behavior, and all previous app,
backup, catalog, and deployment invariants.

At implementation handoff, 78 unit/integration tests, both Playwright browser tests,
TypeScript checking, and the production PWA build pass. The in-app browser was not
connected for an additional visual inspection in this workspace session.

## First-connect regression follow-up

The initial deployed S3 build could loop back to the Google account chooser when
account inspection failed before the merge-choice dialog. A successful Google token
response can omit the redundant `scope` field when it matches the sole requested
`drive.appdata` scope; Flixate now records that known requested scope instead of
rejecting the otherwise valid grant. Account-inspection retries also reuse the saved
unexpired token rather than forcing another chooser, while account changes still
explicitly request one. Finally, concrete errors are no longer masked as offline
merely because `navigator.onLine` reports an unreliable false value.

Regression coverage exercises both the omitted-scope response and a failed account
inspection followed by a chooser-free retry.

## Deployed acceptance checklist

After the fast app deployment succeeds:

1. Open sync settings on the existing browser and connect the intended Google
   account using **Merge browser and Drive**.
2. Confirm the state reaches `Synced at …` and normal browsing/seen actions remain
   instant.
3. Open Flixate in a second browser profile or device, connect the same account, and
   choose **Merge browser and Drive**.
4. Mark one title seen on device A, then use any seen action or **Sync now** on device
   B and confirm it converges.
5. Simulate token expiry by waiting for normal expiry if convenient; otherwise the
   S0 expiry result remains acceptable for rollout. Confirm a later seen action shows
   at most the brief self-closing Google popup and completes sync.
6. Verify disconnect retains local seen state, then reconnect to the same account.
7. On Android Chrome and the installed PWA, inspect the narrow sync dialog and repeat
   one real seen-state round trip.

Passing these checks completes S3's exit gate and allows S4 production rollout and
security/privacy verification to begin.
