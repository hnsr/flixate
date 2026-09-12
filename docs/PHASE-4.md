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

## Synopsis recovery follow-up — 2026-09-12

Nightly deployments replace content-addressed synopsis files. An app left open on
an older catalog could request a removed file and display a misleading offline
message. Synopsis loading now recovers from HTTP 404/410 by fetching a freshly
validated manifest and retrying once against its current shard layout, including
when the number of shards has changed. Only synopsis metadata changes: the visible
catalog, filters, seen state, watchlists, and saved last-known-good core manifest
are left alone.

Recovery requests bypass HTTP and service-worker manifest caching. Concurrent
loads share in-flight requests, and shard caching is keyed by file/format/checksum
rather than bucket number alone. Existing cached synopses remain usable offline;
integrity checks are not bypassed. Failed loads offer **Retry synopsis**, and closing
then reopening details retries too. A title absent from the current synopsis shard
shows the normal unavailable-synopsis message.

Regression coverage includes real gzip/checksum decoding, removed files, changed
shard counts, concurrent requests, offline cached reads, failed-refresh retries,
invalid manifests, and browser-level recovery without a page reload. The full
suite now has 99 unit/integration tests and six browser tests.

## Genre exclusions follow-up

At the user's request, **Exclude genres** now appears below the existing genre
filter, collapsed by default. The collapsed summary shows the number of excluded
genres. A title matching any excluded genre is hidden even if its other genres
match the included Any/All filter. Selecting a genre for inclusion removes its
exclusion, and excluding it removes its inclusion. Titles with missing or unknown
genre metadata are not hidden by exclusions alone.

Exclusions apply through the shared filter pipeline before the discovery limit
and when filtering an individual watchlist. Reset clears them. They are saved
alongside other browser-local filters, included in named filter presets and JSON
backups, but are not synchronized to Drive. Older settings/presets/backups default
to an empty exclusion list. Imported contradictions are resolved in favor of
exclusion, with duplicates and malformed list entries removed. No catalog format
change or new crawl is needed.

Verification: 105 unit/integration tests and seven browser tests pass, including
Any/All precedence, movie/TV genre mapping, unknown genres, mutual exclusion,
reload persistence, presets, export/import, mobile layout, and reset. Production
build/typecheck also passes.

## Continuous list scrolling follow-up

Lists above 60 titles previously used a fixed-height inner scrollbar, making the
results look truncated next to an expanded filter panel. They now use window-based
virtualization and normal page scrolling: only nearby cards render, but the full
list occupies its proper document height. The 100-title discovery limit is unchanged.

The filter panel also scrolls normally instead of pinning a panel taller than the
viewport. List offsets are remeasured after responsive and filter-layout changes;
card resizing is handled by the virtualizer's resize observer rather than resetting
all row measurements whenever a card mounts or expands.

The regression browser test reaches the last title and its controls with exclusions
expanded, opens a long synopsis without footer overlap, then repeats navigation on
mobile after changing the filter layout. It also checks that off-screen titles
remain virtualized. Full verification: 105 unit/integration tests and eight browser
tests, plus the production build/typecheck and privacy audit.
