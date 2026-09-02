# Sync S2 implementation report

Status: completed on 2026-09-02

## Outcome

Flixate now has a production Google Drive transport and synchronization engine around
S1's deterministic state layer. The engine remains deliberately separate from the
React UI: existing local-only behavior is unchanged until S3 adds account controls,
first-connect confirmation, and visible sync status.

## Drive transport

The production transport uses the narrow `drive.appdata` scope and the same
REST/CORS endpoints proven in S0. It:

- obtains the authorized account's opaque `permissionId` through `about.get`;
- paginates every matching file in `appDataFolder` and accepts only exact
  `flixate-state-<uuid>.json` filenames;
- downloads state documents as untrusted text for S1 validation;
- creates the current browser's file with multipart upload and updates it with a
  media upload;
- refuses envelopes or existing filenames owned by another device;
- retries safe reads and idempotent updates with bounded exponential backoff and
  jitter; and
- re-lists after an ambiguous create failure before retrying, avoiding blind
  duplicate creation when Drive accepted a request but its response was lost.

Authorization failures are distinguished from transient network, server, and Drive
rate-limit failures. Error messages contain bounded Drive response details but never
the bearer token.

## Token and request lifecycle

The production token session is separate from the S0 probe. It stores only the
short-lived access token, exact expiry, and granted scope. A 30-second safety margin,
scope validation, malformed-state recovery, and explicit invalidation ensure an
expired or rejected token is removed predictably.

Simultaneous Google authorization requests share one promise. The high-level sync
service can reuse a valid token, request a new token only when called from an
authorized interaction, inspect an account without silently binding it, and purge a
token after a Drive `401` or non-rate-limit `403`. It then waits for a later eligible
user interaction rather than attempting an unsupported background refresh.

## Synchronization transaction

For one pass, the engine:

1. requires an already confirmed local account binding;
2. verifies the live Drive `permissionId` before listing personal state;
3. downloads and validates every per-device document, retaining warnings for corrupt
   files without merging them;
4. merges all valid remote documents with both the initial and latest local state;
5. saves the merged result locally before any Drive write; and
6. creates or updates only this browser's file, skipping the upload when that file
   already contains the complete merged state.

A network error while reading a remote file aborts the pass rather than treating the
missing document as empty. Duplicate files for the current device are reported and
the newest is repaired. A debounced coordinator collapses rapid local changes and
allows at most one active pass plus one follow-up pass when a change arrives during
network activity.

## Verification

Fourteen focused tests use fake Drive transports and fetch responses; CI needs no
Google account, OAuth client, token, or network access. They cover pagination,
filename filtering, authorization headers, bounded retries, authorization failure,
write ownership, ambiguous-create recovery, token expiry and scope validation,
authorization coalescing, corrupt documents, deterministic merge integration,
local-before-remote commit ordering, unchanged-upload suppression, account safety,
edits during download, sync coalescing/debouncing, token invalidation, and account
inspection without binding.

Full verification passed with 66 unit/integration tests, both real-browser
Playwright tests, TypeScript checking, and the production PWA build.

## S3 handoff

S3 can now focus on user experience rather than Drive correctness. It needs to:

- adapt React's current local state to the S1 `SyncStateStore` boundary;
- add connect, safe first-merge choice, account display, sync status, retry, and
  disconnect controls;
- schedule the coordinator after seen changes and import operations;
- initiate optimized authorization only from eligible user interactions; and
- replace the query-gated S0 probe once the production controls cover its diagnostic
  needs.

Watchlist UI remains separate future product work, but its field is already supported
by the state and merge engine.
