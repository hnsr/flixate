# Phase 4 — focused discovery and personal watchlists

Implemented on 2026-09-05. The scope was committed separately before implementation.

## Delivered behavior

- Discovery shows at most 100 titles after search, filters, and sorting run against
  the full catalog. Displayed and total matching counts are separate. Hiding a
  newly seen title refills the shortlist from the next match.
- Release/first-air year has optional inclusive lower and upper bounds. Unknown
  years remain visible without bounds; applying a bound excludes them. Inverted
  bounds show an explanation and no results.
- Multiple named personal watchlists support create, rename, confirmed deletion,
  and independent membership in more than one list. Seen state is unaffected.
- Selecting a list resets filters while keeping the current sort and includes
  seen titles initially. Returning to Discover restores the default hide-seen
  filters. List browsing is not capped at 100. Members missing from the current
  streaming catalog remain saved and appear separately by TMDB identifier.
- Named saved filters capture search, filters, and sort; they can be applied and
  deleted. These presets are browser-local, not synchronized or exported. Current
  filter settings remain part of JSON backups.
- Mobile filters collapse behind a toggle. Watchlist controls and card actions
  wrap on narrow screens. Coverage text explains the US+NL subscription/free/ad
  union, rental/purchase-only exclusion, and possible partial series availability.
- No new service, OAuth scope, catalog crawl, performance project, or dedicated
  accessibility/keyboard pass was introduced.

## Storage, synchronization, and migration

Lists use stable random UUIDs. Names and each title/list membership have independent
hybrid timestamps using the existing deterministic merge rules. False membership
records preserve removals. A deleted list UUID stays deleted even if another device
later renames it or adds a member; recreating a list creates a fresh UUID.

Watchlist edits save locally first and trigger the existing optional Drive sync.
Exports include seen history, lists, and removal/deletion markers, without OAuth
tokens or account bindings. Version-1 seen-only imports are still accepted.

The new app writes `flixate:sync-state:v2` locally and
`flixate-state-v2-<device-id>.json` remotely, with version-2 sync envelopes. The
inner state retains its existing title-state version and adds a `lists` collection.
Readers merge legacy local records and version-1 Drive documents; existing legacy
files are left intact. Version-2 backup envelopes carry the complete personal state.

This separate namespace prevents an old cached app from overwriting lists it does
not understand. It deliberately does not make new changes visible to old clients:
**update/reload Flixate on every device**. New clients can still ingest later seen
edits from an old client. Cross-account collaboration remains out of scope.

## Verification

- 93 unit/integration tests pass across 17 files, including independent list edits,
  deterministic merges, durable removals/deletions, backward clocks, migration,
  versioned backups, invalid data, and the existing seen/account protections.
- The in-memory Drive REST integration migrates a legacy document, uploads seen
  history and list membership, restores both in a fresh browser store, and merges
  a second device's removal without rewriting the legacy document.
- Four browser tests pass, including search beyond the first 100, shortlist refill,
  year bounds, saved-filter persistence, multi-list membership, rename, reload,
  version-2 export/import into a fresh browser, deletion, and retained seen status.
- Phone-sized browser inspection and tests at 390 × 844 verify collapsed filters,
  usable list controls, and no horizontal page overflow.
- Production build/typecheck and public-bundle audit pass.

Real Google authorization was already validated during S4. This phase reuses that
connection unchanged; new watchlist round trips are covered by the automated Drive
adapter tests, not claimed as a new manual two-device Google test.
