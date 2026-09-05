# Phase 2 implementation report

Completed: 2026-08-31

## Outcome

**Complete.** The Phase 0 US+NL discovery process now produces the production data
contract consumed by the Phase 1 app. A complete 171,436-title snapshot was rebuilt
from the raw TMDB response cache and exercised through Chrome end-to-end tests.
Generated catalog data remains ignored and is not added to normal Git history.

## Production data path

- `npm run catalog` performs the US+NL movie/show discovery, deterministic merge,
  validation, and artifact build.
- The compact core contains title, type, complete canonical genre mapping, release
  year, TMDB score and vote count, and optional poster path.
- TMDB overviews are assigned by `tmdbId % shardCount` to 128 deterministic shards.
- The stable manifest describes counts, coverage, freshness, image configuration,
  scores, every artifact URL, SHA-256 hash, and byte size.
- Core and shard filenames include their content hash. Gzip bytes use the opaque
  `.json.gz.bin` suffix so static hosts cannot transparently decompress them before
  Flixate verifies the compressed-byte hash.
- The browser checks the manifest, fetches the core, verifies its hash, explicitly
  decompresses it, parses it, and validates all records in a Web Worker.
- A synopsis shard goes through the same hash and schema checks only when a title is
  expanded. Concurrent titles in one shard share one request.
- A last-known-good manifest is retained locally. If a newly fetched snapshot or
  core fails integrity/schema validation, Flixate attempts the prior content-
  addressed snapshot and shows a warning.

## Complete snapshot measurements

The repeatable validation run used snapshot date 2026-08-30 and all 11,103 cached
TMDB responses, making no network requests.

| Measurement | Result |
| --- | ---: |
| Titles | 171,436 |
| Movies | 138,300 |
| Shows | 33,136 |
| TMDB-rated | 133,535 |
| Release-year coverage | 171,436 (100%) |
| Poster coverage | 162,707 (94.9%) |
| Synopsis coverage | 165,253 (96.4%) |
| Compressed core | 8,431,755 bytes |
| Uncompressed core JSON | 33,568,369 bytes |
| Synopsis shards | 128 |
| Total compressed synopses | 20,881,624 bytes |
| Largest compressed shard | 174,796 bytes |
| Saturated single-day discovery partitions | 0 |

The production data directory contains one manifest, one report, one core, and 128
shards. Superseded content-addressed files are removed only after the new manifest
has been written successfully.

## Validation and recovery

The builder rejects duplicate/mismatched keys, invalid years, scores or poster
paths, ratings without votes, unknown TMDB genres, oversized synopsis shards, and
saturated discovery partitions. The browser independently validates manifest
counts, artifact hashes, core schema and title count, every title record, duplicate
keys, and synopsis records.

The nightly/manual GitHub Actions workflow builds and validates the catalog, writes
a coverage/size summary, saves its same-run TMDB response cache for restartable job
reruns, builds the production app against the result, and uploads the catalog as a
seven-day workflow artifact. Normal app pushes use that artifact without rerunning
discovery. Failed builds cannot publish or replace a snapshot.
The measured cold crawl is roughly 12 minutes, so the planned progressive multi-run
bootstrap is unnecessary; response-level caching still makes interrupted reruns
safe and economical.

## Verification

```bash
npm run typecheck
npm test
VITE_CATALOG_MANIFEST_URL=data/live/manifest.json npm run build
npm run test:e2e
```

Current automated coverage includes 27 unit/component tests and two Chrome journeys.
The Chrome journeys were also run against the complete catalog and passed in 7.1
seconds, covering worker loading, filtering/virtualization, lazy compressed synopsis
delivery, seen persistence, and backup export/import.

## Phase 3 boundary

Phase 3 can now focus on the GitHub Pages release path: add the official Pages
deployment job after successful catalog/app validation, configure the repository's
`TMDB_API_TOKEN` secret and Pages source, verify the deployed CDN/content headers and
PWA update behavior, and document manual recovery. No additional data provider,
database, or paid hosting is required.
