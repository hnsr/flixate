# Sync S3 implementation and rollout report

Status: completed on 2026-09-05; remaining production rollout checks moved to S4

## Outcome

Google Drive synchronization is now connected to Flixate's real seen-history flow.
Seen actions remain immediate and local, while connected browsers begin Drive
synchronization afterward and coalesce any changes made during the active request.
The old query-gated OAuth probe is no longer rendered; the production controls use
the same public OAuth client configuration.

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
4. starts sync only afterward when an account is connected.

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
retains the user activation required for optimized authorization. A connected
browser with a valid saved token synchronizes automatically on load, which both
retrieves changes from other devices and flushes a local edit whose debounced upload
was interrupted by a reload. A connected user with an expired token does not need
to find a reconnect button: the next local history interaction requests a token
immediately using an empty prompt and the remembered email hint, then synchronizes.
No authorization popup opens merely because the page loaded. **Sync now** provides
the same recovery path explicitly.

OAuth, offline, malformed-file, and Drive failures never roll back the local user
action. Status text explains whether Flixate is waiting, needs reconnection, or
ignored a corrupt Drive document. Rapid actions during an active request are
coalesced, and an intervening edit causes at most one follow-up pass.

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

At implementation handoff, 82 unit/integration tests, both Playwright browser tests,
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

A second deployed check exposed a browser-only calling-convention difference in the
production transport: it stored native `fetch` on the transport and invoked it as an
object method, supplying the transport instance as the native function's receiver.
The successful S0 probe had invoked the same function plainly. The production
transport now preserves that receiver-free call, and its regression test asserts the
exact invocation contract. Safe underlying browser error text is also retained if a
different network failure occurs.

The next live check found a reload-sized gap in the otherwise local-first behavior.
A seen action persisted immediately in the browser but scheduled its Drive upload
after a short debounce; a hard refresh could cancel that timer. Although the local
mark correctly survived the refresh, the reloaded app did not synchronize until a
later Drive-relevant interaction. Clearing site data first could therefore remove
the only copy. A previously connected browser now synchronizes on startup whenever
its saved token is valid. If the token has expired, startup remains non-interactive
and the next relevant user action performs the optimized reconnection. Regression
coverage verifies that a locally persisted mark is uploaded after reload without a
new OAuth request.

A further live reset test still failed despite allowing the scheduled upload several
seconds to run. The complete production REST adapter cycle—create an empty device
file, update it with a seen mark, then discover and merge it from a fresh device—now
has regression coverage and succeeds. To remove the remaining browser-only timing
variable, connected history changes now start synchronization immediately rather
than waiting on an idle debounce. Successful status details also state the exact
number of seen titles included in the acknowledged Drive write or match, so live
acceptance can distinguish a real one-title upload from an empty successful sync.

## S4 acceptance handoff

After the fast app deployment succeeds:

1. Open sync settings on the existing browser and connect the intended Google
   account using **Merge browser and Drive**.
2. Confirm the state reaches `Synced at …`, mark a title seen, and wait for the
   brief follow-up sync to complete; normal browsing and the seen action remain
   instant.
3. Open Flixate in a second browser profile or device, connect the same account, and
   choose **Merge browser and Drive**.
4. Mark one title seen on device A, wait for its sync to complete, then load or
   refresh device B with a still-valid token and confirm it converges automatically.
5. Simulate token expiry by waiting for normal expiry if convenient; otherwise the
   S0 expiry result remains acceptable for rollout. Confirm a later seen action shows
   at most the brief self-closing Google popup and completes sync.
6. Verify disconnect retains local seen state, then reconnect to the same account.
7. On Android Chrome and the installed PWA, inspect the narrow sync dialog and repeat
   one real seen-state round trip.

The first-connect, immediate-write, reload, and browser-reset recovery checks passed.
The remaining multi-device, offline, and mobile checks now live in
[SYNC-S4.md](SYNC-S4.md).
