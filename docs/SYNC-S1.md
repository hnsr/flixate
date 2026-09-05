# Sync S1 implementation report

Status: completed on 2026-09-02

## Outcome

Flixate now has an isolated, transport-independent state layer for deterministic
cross-device synchronization. It does not yet read or write real personal state in
Google Drive and does not alter the current app UI; S2 will connect this tested
layer to the production Drive adapter.

## Implemented

- A stable random UUID identifies each browser installation and determines its
  owned `flixate-state-<device-id>.json` file.
- Local sync metadata stores that device ID separately from the optional Google
  Drive account binding.
- The opaque Drive `permissionId` protects against silently switching accounts.
  Replacing a different binding requires an explicit opt-in; disconnecting retains
  the browser's stable device identity.
- Version 1 sync envelopes carry a format marker, schema version, owner device ID,
  write time, and validated personal state.
- Seen and future watchlist membership are independent boolean fields with their
  own change stamps. Explicit `false` values remain durable tombstones.
- Every current `UserStateV1` record migrates without changing its visible
  seen/unseen value. Malformed or implausibly future legacy dates are safely
  clamped to migration time.

## Merge and clock invariants

Each change stamp contains canonical UTC wall time, a non-negative logical counter,
and the originating device UUID. Fields are compared in that order. This gives the
merge these properties:

- changes to different titles or different fields never overwrite one another;
- the later decision for the same field wins, including an explicit `false`;
- equal physical times resolve by logical counter and then device ID;
- the result is identical for every input order and remains unchanged when merged
  repeatedly; and
- a local edit stays newer when its clock moves backward or an accepted remote
  clock is modestly ahead.

Remote envelopes are treated as untrusted. Malformed JSON, unsupported versions,
invalid title records, impossible write ordering, and timestamps more than 24 hours
ahead are rejected before merge. Exact-stamp conflicting values should never be
produced, but `false` wins deterministically if such corrupted input reaches the
pure merge function.

## Verification

The focused S1 suite covers stable device restoration, malformed metadata recovery,
same-account rebinding, guarded account replacement, disconnect, legacy migration,
false tombstones, concurrent titles, independent fields, all three-device merge
orders, idempotence, backward clocks, modest remote clock skew, corrupt documents,
future schema versions, and excessive future skew.

Verification passed with 52 unit/integration tests, both real-browser Playwright
tests, TypeScript checking, and the production PWA build. No Google credentials or
live Drive calls are required by these tests.

## S2 handoff

S2 should keep these boundaries intact:

1. Drive transport lists and downloads candidate files as untrusted bytes.
2. The envelope parser validates each candidate before merge.
3. The pure state layer merges local and valid remote documents.
4. Local state is committed before the adapter uploads only the current device's
   envelope.
5. The adapter compares the authorized Drive `permissionId` with the saved binding
   before reading or writing personal state.

UI integration, token lifecycle, Drive retries, upload coalescing, and first-connect
merge confirmation deliberately remain S2/S3 work.
