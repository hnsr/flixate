# Phase 0 feasibility report

Run date: 2026-08-30

## Outcome

**Go.** The US+NL catalog is practical as a static, zero-cost application. The
complete discovery pass fits comfortably within a GitHub-hosted Actions job, the
catalog artifact is small, and in-memory filtering is fast on the development
machine.

TMDB's own `vote_average` and `vote_count` are the MVP quality signal. They arrive
in the discovery response, so the pipeline needs no per-title IMDb-ID lookup and no
separate ratings import. This removes the previously projected 2.6-hour one-time
mapping bootstrap and the IMDb redistribution question from the MVP.

## Live measurements

The original uncached run used a conservative limit of 18 requests per second with
eight concurrent page workers. The regenerated TMDB-scored catalog reused the raw
response cache and exercised 11,103 discovery requests without any enrichment
calls.

| Measurement | Result |
| --- | ---: |
| Unique US+NL titles | 171,436 |
| Movies | 138,300 |
| Shows | 33,136 |
| Present in both regions | 47,414 |
| US-only | 116,389 |
| NL-only | 7,633 |
| TMDB-rated titles | 133,535 |
| Unrated (zero-vote) titles | 37,901 |
| Titles with at least 50 votes | 31,128 |
| Cached discovery requests in final run | 11,103 |
| Original uncached elapsed time, including 1,000 now-removed diagnostic IMDb lookups | 704.57 seconds (11m 44.57s) |
| Original retries / rate-limit responses | 0 / 0 |
| Compressed TMDB-scored catalog | 4,139,803 bytes |
| Uncompressed JSON | 22,505,642 bytes |
| Decompress + parse median on this machine | 125.292 ms |
| Filter-query p95 on this machine | 37.811 ms |
| Mobile-class Chrome download + decompress (4× CPU throttle) | 363.8 ms |
| Mobile-class Chrome JSON parse (4× CPU throttle) | 237.8 ms |
| Mobile-class Chrome filter scan (4× CPU throttle) | 16.6 ms |
| Mobile-class Chrome reported JS heap | 52,303,865 bytes |
| Validation errors | 0 |

The Netherlands adds 7,633 titles not found by the US discovery pass, confirming
that including NL provides meaningful personal coverage for relatively little
additional complexity.

The headless Chrome run used a 390×844 mobile viewport and 4× CPU throttling. Its
reported 52 MB JavaScript heap, 238 ms JSON parse, and 17 ms filter scan are
reasonable for a first implementation. An actual phone test remains part of the
Phase 1 UI slice, but sharding or IndexedDB is not justified yet.

## TMDB scoring decision

TMDB score coverage across the 171,436-title union is:

| Vote threshold | Titles |
| --- | ---: |
| At least 1 vote | 133,535 |
| At least 5 votes | 88,833 |
| At least 10 votes | 67,861 |
| At least 50 votes | 31,128 |
| At least 100 votes | 21,249 |
| At least 250 votes | 12,334 |

A random comparison against IMDb found that TMDB is adequate for the intended
quick quality gauge, especially for established titles. For records with at least
50 TMDB votes, the Pearson correlation was 0.858 for 233 sampled movies and 0.684
for 192 sampled shows; scores were within one point for 90.1% and 88.0%
respectively. This is not equivalence—the populations and weighting differ—but it
is sufficient for MVP filtering.

Flixate should always label the value as TMDB, retain vote count, offer a
minimum-votes filter, and treat fewer than 50 votes as low-confidence rather than
silently dropping the title. A numeric score threshold naturally excludes unrated
records. IMDb remains a possible post-MVP adapter.

## Discovery completeness

Adaptive date splitting was required and worked: the unpartitioned US movie query
advertised 6,649 pages, while TMDB exposes only a bounded page window. The builder
recursively split the date range into 43 retrievable leaf partitions across the four
region/media combinations. No single-day partition remained saturated.

| Query | Advertised | Dated records fetched | Difference |
| --- | ---: | ---: | ---: |
| US movies | 132,980 | 132,725 | 255 |
| US shows | 31,744 | 31,078 | 666 |
| NL movies | 42,060 | 42,028 | 32 |
| NL shows | 13,117 | 13,019 | 98 |

The roughly 0.5% difference in regional memberships is consistent with records that
have no release or first-air date, plus possible source changes during the crawl.
TMDB does not provide a clean, independently pageable “date is null” filter. The
builder additionally fetches a configurable popularity window, but the first 500
popular records did not add an undated record in this run. Therefore the catalog
must not claim literal 100% coverage; it provides exhaustive dated discovery plus
the configured unpartitioned popularity window.

The raw TMDB response cache lives under ignored `.cache/phase0/`. Generated catalog,
manifest, and JSON report files live under ignored `artifacts/phase0/`. Neither
contains credentials.

## Commands

```bash
npm install
npm run typecheck
npm test
npm run phase0:sample
npm run phase0
npm run benchmark:browser
```

The runner accepts these optional controls:

```text
--top-window-pages <count>
--requests-per-second <count>
```

It reads `TMDB_API_TOKEN` first and falls back to `TMDB_API_KEY`. The values belong
only in the ignored `.env` file locally and in GitHub Actions secrets remotely.

## Remaining decisions, not Phase 0 blockers

- Accept that TMDB may qualify a show when only some seasons are streamable.
- Add Documentary as a cross-media genre preset.
- Retain release year to distinguish identically named titles; this is recommended.
- Define a small canonical mapping between TMDB's movie and TV genre vocabularies.
- Make the score threshold/unrated behavior explicit in tests and UI copy.
- Confirm the simulated mobile-class measurements on a real phone during the Phase
  1 vertical slice.
