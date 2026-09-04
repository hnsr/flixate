# Cross-device sync plan

Status: S0 authorization feasibility, S1 deterministic state, and S2's production
Drive adapter are complete. S3 account and sync UX is implemented; deployed
multi-device acceptance is pending. See
[SYNC-SPIKE.md](SYNC-SPIKE.md), [SYNC-S1.md](SYNC-S1.md), and
[SYNC-S2.md](SYNC-S2.md) for the foundation reports and [SYNC-S3.md](SYNC-S3.md)
for the current rollout checklist.

## Decision

Add optional, local-first synchronization through Google Drive's hidden
`appDataFolder`. Each person connects their own Google account and receives an
independent seen history and, later, watchlist on every connected browser. Flixate
continues to work without an account, network, server, or database.

This track is deliberately scheduled before general Phase 4 refinement. The first
step is a small feasibility spike: the architecture is only a go if Google's
browser authorization is tolerable in desktop Chrome, Android Chrome, and the
installed PWA.

Google documents `appDataFolder` as per-user application storage that is hidden
from Drive's normal UI and accessible only by the creating app. Its narrow
`drive.appdata` OAuth scope is classified as non-sensitive.

References:

- [Store application-specific data in Drive](https://developers.google.com/workspace/drive/api/guides/appdata)
- [Choose Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Identity Services browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)

## Goals

- Carry seen/unseen state across a person's browsers and devices.
- Use the same mechanism for watchlists when that feature is added.
- Preserve instant local writes and full offline use.
- Require no Flixate server, database, long-lived per-user credential, or paid account.
- Make sync optional and keep JSON export/import as a permanent escape hatch.
- Merge concurrent and offline edits without silently losing a newer decision.
- Keep one person's state isolated from every other Google account.

## Non-goals for the first release

- A shared household history or collaborative watchlist across Google accounts.
- Background synchronization while Flixate is closed.
- Real-time updates between two simultaneously open devices.
- Synchronizing search text, filters, layout preferences, or cached catalog data.
- A general Google Drive file browser, Picker integration, or access to visible
  Drive files.
- Supporting identity providers other than Google in the first implementation.

`appDataFolder` files cannot be shared. A future shared-household mode would need a
normal shared Drive file or a small backend and should be treated as a separate
product decision.

## User experience

Flixate remains usable immediately with no sign-in. An optional account area adds:

- **Connect Google Drive** — opens Google's account/permission dialog.
- **Sync now** — manually retries authorization or synchronization when necessary;
  routine Drive-backed actions normally initiate reconnection themselves.
- **Disconnect** — forgets the local account binding and token without deleting
  local or remote history.
- a compact state such as `Local only`, `Syncing…`, `Synced just now`, `Offline`,
  `Reconnect to sync`, or `Sync needs attention`.

The first connection shows the detected Drive account and asks the user to confirm
one of two explicit actions:

1. **Merge this browser with the account** — the safe default; keeps the newest
   decision for each title.
2. **Use account state on this browser** — replaces local personal state only after
   confirmation and offers a JSON export first.

Normal seen/watchlist actions always update local storage synchronously. If the
saved token is still valid, Flixate begins synchronizing immediately and coalesces
any further changes made while that request is active. If the token has expired,
the same user gesture initiates a fresh token request using the remembered account
hint, then synchronizes. A Drive failure never blocks browsing or changes the local
result of the user's action; the mutation remains queued locally. On a later page
load, an already connected browser automatically synchronizes when its saved token
is still valid, recovering uploads interrupted by reload and retrieving other
devices' changes without opening an OAuth prompt. An expired token remains
non-interactive until the next relevant user action.

## OAuth and account identity

Use Google Identity Services' browser token flow and request only:

```text
https://www.googleapis.com/auth/drive.appdata
```

The OAuth client ID is public configuration and may be present in the built app.
There is no client secret. To avoid reauthorization after an ordinary reload,
Flixate may store the short-lived access token, granted scope, and exact expiry in
local browser storage. It must purge expired tokens with a safety margin and remove
them on disconnect, account mismatch, or an authorization failure. Tokens must
never enter backups, logs, URLs, Git, build artifacts, or the service-worker cache.

Google's browser tokens are short-lived and Flixate has no backend refresh token.
After expiry, Google requires another token request initiated by a user action.
Flixate uses the next seen/watchlist/sync action to request one with an empty prompt
and the remembered email as `login_hint`. With a valid Google session and grant,
this should avoid manual account selection; the feasibility spike measures the
actual popup behavior in each target environment. A visible reconnect state remains
the fallback when Google requires attention.

After authorization, call Drive `about.get` with the minimal user fields. Store the
opaque Drive `permissionId` as the local account binding, retain the email locally
as a future `login_hint`, and show the display name or email when available. This
allows Flixate to detect account switching before it merges local data. The
`about.get` endpoint accepts the `drive.appdata` scope.

Reference: [Drive `about.get`](https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get)

## Local-first storage model

The current `UserStateV1` already provides useful synchronization semantics:

- every title has an ISO `updatedAt` value;
- `seen: false` remains stored, so marking a title unseen is a durable tombstone;
- backup import merges per title rather than replacing the whole document; and
- invalid or older records cannot overwrite newer local records.

Keep local storage as the immediate source of truth. Introduce a storage/sync
boundary so React does not know whether state is local-only or mirrored to Drive.
The initial implementation should not require IndexedDB; the personal state is
small enough for the existing local JSON record.

Watchlists should extend the per-title record rather than introduce an unrelated
sync system. Each independently mutable field needs its own value and change stamp,
so a recent watchlist edit cannot accidentally overwrite a newer seen edit.

S1 uses this logical shape (shown with abbreviated device IDs):

```json
{
  "seen": {
    "value": true,
    "changedAt": {
      "wallTime": "2026-09-01T20:30:00.000Z",
      "counter": 0,
      "deviceId": "<device-a>"
    }
  },
  "watchlisted": {
    "value": false,
    "changedAt": {
      "wallTime": "2026-09-01T20:31:00.000Z",
      "counter": 0,
      "deviceId": "<device-b>"
    }
  }
}
```

False records are retained as tombstones. Removing them would allow an older `true`
record from another offline device to reappear. The hybrid change stamp adds a
logical counter so a new decision remains newer even if a device clock moves
backward or several decisions occur in the same millisecond.

## Remote layout

Give each browser installation a random UUID stored locally. It owns one Drive
file and never overwrites another device's file:

```text
appDataFolder/
  flixate-state-<device-a>.json
  flixate-state-<device-b>.json
  flixate-state-<device-c>.json
```

Each document includes a recognizable format marker, schema version, device ID,
write time, and validated personal state. The device ID is not an identity or a
secret; it only provides write ownership and deterministic tie-breaking.

Per-device files avoid the classic sequence where two devices download one JSON
file, make different changes, and whichever uploads last erases the other change.
With the expected handful of devices, listing and downloading all small files is
cheap and simple. Remote-file cleanup can wait until real use demonstrates a need.

## Merge algorithm

For every synchronization:

1. List only Flixate state files in `appDataFolder`.
2. Download, parse, migrate, and strictly validate each supported document.
3. Merge local state and every valid remote state per title and per mutable field.
4. Prefer the greater hybrid change stamp in wall-time, counter, then device-ID
   order so merge order cannot affect the result.
5. Save the merged state locally before updating the current device's remote file.
6. Upload only when that device document would materially change.
7. Re-read or retry with exponential backoff after ambiguous network failures.

A corrupt or future-version remote document is ignored and reported; it must not
erase valid local state or other device documents. Unknown future fields are
preserved when practical, and unsupported future schema versions are never
downgraded in place.

S1 chose a small hybrid logical clock rather than relying on ISO timestamps alone.
It advances the logical counter when local time moves backward or an accepted
remote stamp is ahead, and rejects documents more than 24 hours in the future so a
bad device clock cannot indefinitely dominate valid decisions.

## Failure and recovery behavior

- Offline or Google unavailable: keep local changes and show `Waiting to sync`.
- Token expired: retain data and initiate optimized reauthorization from the next
  Drive-relevant user action; show **Reconnect to sync** only if that attempt needs
  attention or the grant was revoked.
- Rate limit or transient server error: use bounded exponential backoff with jitter.
- Malformed remote file: ignore it, show a non-destructive warning, and leave it
  available for diagnosis.
- Account mismatch: stop before reading or writing personal state and ask the user
  whether to switch, merge, or cancel.
- Remote app data removed: recreate the current device file from confirmed local
  state; do not interpret absence as a request to erase local state.
- Local browser storage cleared: reconnect and rebuild from the remaining remote
  device documents.

Export/import stays available whether connected or not. A user should be able to
export before account replacement, disconnect, or any future destructive reset.
Google notes that app data can be manually deleted and is removed when the user
uninstalls the app from Drive, so Drive sync is not the sole backup mechanism.

## Security and privacy rules

- Request only `drive.appdata`; do not request broad Drive access.
- Persist only the current short-lived access token with its exact expiry; eagerly
  purge it when expired or invalid, and never persist a refresh token.
- Never export, sync, log, cache through the service worker, or put OAuth tokens in
  URLs or build artifacts.
- Restrict the OAuth client's production JavaScript origin to
  `https://hnsr.github.io`; add explicit localhost origins only for development.
- Load Google Identity Services only when sync is offered, and keep a strict content
  security policy as a follow-up hardening task if Pages delivery permits it.
- Treat every Drive response as untrusted input and reuse versioned state validators.
- Store no catalog data remotely: only title keys and personal state.
- Do not put Google account identifiers into exported backups unless the user opts
  in; the opaque local binding belongs in sync metadata.
- Disconnect revokes local use of the token. Offer a separate, clearly destructive
  action if remote Flixate data deletion is ever implemented.

## Cost and operational fit

The state files should remain in the kilobyte-to-low-megabyte range and generate a
few Drive reads/writes per active session. This is far below current standard Drive
API quotas for several personal users. Google currently charges no additional cost
for standard use below its threshold, but its quota/pricing policy can change and
should be checked during rollout.

Reference: [Drive API usage limits](https://developers.google.com/workspace/drive/api/guides/limits)

There is still a one-time developer configuration cost: create a Google Cloud
project, enable Drive API, configure the OAuth consent screen/audience, create a Web
OAuth client, and register production and development origins. This is configuration
rather than application hosting. Personal use by a few known users fits Google's
documented personal-use category, but the exact consent-screen publishing mode and
warnings must be recorded from the spike rather than assumed.

Reference: [Google OAuth personal-use policy](https://developers.google.com/identity/protocols/oauth2/policies)

## Delivery plan

### S0 — authorization and Drive feasibility spike

Status: completed on 2026-09-02.

- Add an isolated development adapter behind a feature flag.
- Configure a Google Cloud test project and browser OAuth client.
- Obtain and safely restore a short-lived token in desktop Chrome, Android Chrome,
  and the installed PWA.
- Verify `about.get`, list/create/download/update in `appDataFolder`, REST+CORS, and
  account switching using only `drive.appdata`.
- Measure first consent, later-session reconnection, expiry/revocation recovery, and
  popup behavior.
- Record request counts, latency, actual warnings, and required Cloud setup.

Exit gate: all target environments can round-trip a small state document without a
backend, broad Drive scope, long-lived credential, or unacceptable recurring consent.

### S1 — state schema and deterministic merge

Status: completed on 2026-09-02. See [SYNC-S1.md](SYNC-S1.md).

- Introduce a versioned sync envelope, stable device ID, and account binding.
- Extend merge semantics to deterministic timestamp ties and future watchlist fields.
- Preserve false tombstones and migrate every current `UserStateV1` record without
  changing its visible seen state.
- Add tests for concurrent devices, offline edits, account replacement, corrupt and
  future documents, clock skew, and repeated idempotent merges.

Exit gate: the same inputs produce the same merged state in every order, and no
tested offline/concurrent sequence loses the newest user decision.

### S2 — production Drive adapter

Status: completed on 2026-09-02. See [SYNC-S2.md](SYNC-S2.md).

- Implement list, download, create, and update through Drive REST/CORS.
- Reuse an unexpired locally saved token, purge it predictably, debounce writes,
  coalesce concurrent authorization/sync requests, and use bounded retry/backoff.
- Separate Drive transport, schema validation, merge logic, and UI state.
- Add mock-transport integration tests without requiring Google credentials in CI.

Exit gate: local behavior is unchanged when sync is disabled or unavailable, and
the adapter cannot write another device's document.

### S3 — account and sync UX

Status: implemented on 2026-09-02; deployed first-connect and multi-device checks
remain. See [SYNC-S3.md](SYNC-S3.md).

- Add connect, first-merge confirmation, sync status, manual retry, and disconnect.
- Initiate optimized reauthorization from the next Drive-relevant user action and
  reserve reconnect-required UI for cases that genuinely need attention.
- Make pending local changes understandable without blocking local actions.
- Ensure keyboard, screen-reader, narrow-screen, and installed-PWA behavior.
- Keep export/import prominent as recovery.

Exit gate: a new user can connect without documentation, while account switching or
replacement cannot silently disclose or erase the existing browser's state.

### S4 — production rollout

- Configure the production OAuth client and documented consent-screen audience.
- Test two desktop profiles, Android Chrome, an installed PWA, offline edits, token
  expiry/revocation, and a real multi-device merge on GitHub Pages.
- Verify that the client ID is public but no token, account data, or personal state
  enters Git, Actions logs, Pages assets, URLs, or service-worker caches; the one
  intentional token location is local browser storage on the connected device.
- Document setup, normal use, limitations, disconnect, recovery, and remote deletion.
- Roll out as optional; retain local-only mode permanently.

Exit gate: seen changes converge across supported devices on load when authorization
is still valid, or after a Drive-relevant interaction/explicit sync when renewal is
needed; offline/local-only use remains reliable, and no server or database
maintenance is introduced.

## Acceptance criteria

- Connecting Google is optional and never blocks catalog use.
- First authorization asks only for Flixate's private app-data permission.
- A title marked seen or unseen on one device appears that way on another after both
  have synchronized.
- Concurrent changes to different titles are both retained.
- A later change to the same title wins deterministically, including `false`
  tombstones.
- The same guarantees apply independently to watchlist membership when introduced.
- Offline changes remain local and synchronize after reconnection.
- Switching Google accounts requires explicit confirmation before personal data is
  merged or replaced.
- Expired/revoked authorization degrades to local-only use without data loss.
- A short-lived OAuth token may exist only in local browser storage until its exact
  expiry; no token is exposed in application artifacts, exports, URLs, or logs.
- JSON backup export/import remains compatible with synchronized state.
- The implementation stays comfortably within the no-cost Drive API threshold for
  the intended handful of users.

## Remaining rollout decisions

1. The saved-token path shows no UI; reauthorization after simulated expiry showed
   only a brief self-closing popup in the tested environments.
2. Can the OAuth app be published for the known personal users without a recurring
   test-mode authorization expiry or confusing warning?
3. `about.get` returned an opaque `permissionId` using only `drive.appdata` in all
   tested environments.
4. S1 adopted a hybrid logical clock and a 24-hour future-skew limit.
5. Should connecting always perform an immediate sync, or first show local/remote
   counts before confirmation?
6. Filters remain intentionally device-local under the first release's non-goals.

Items 2 and 5 remain S3/S4 rollout decisions, not reasons to add a backend
pre-emptively.
