# Flixate plan review

Reviewed: 2026-08-31

## Verdict

The plan is coherent and viable as a personal, zero-cost project. There is no fatal
architectural mistake. Restricting version 1 to a US+NL availability union
substantially reduces the original crawler risk while covering both the broad US
catalog and personally relevant Dutch titles, although it retains an explicit
coverage trade-off. The remaining findings are definitional or implementation
details that can be resolved without adding hosting, a database, or paid services.
The completed Phase 0 run confirms that implementation can proceed to Phase 1.
Choosing TMDB scoring removes the only unusually expensive bootstrap and the only
MVP data-republication concern. Promoting year, poster, and synopsis to the MVP does
not introduce another provider or credential; the planned core/shard split keeps
the startup payload controlled. There are no known blockers.

Implementation update: Phases 1 and 2 completed on 2026-08-31. The catalog pipeline
and app resolved the implementation wrinkles identified below; the regional,
season-level availability, and rent/buy points remain deliberate product trade-offs.
The optional Google Drive track completed on 2026-09-05 and resolved cross-device
seen state for one Google account without changing local-only behavior.

## Most important findings

### 1. US+NL bounds the region multiplier, but is not worldwide coverage

Querying only the US and Netherlands bounds the supported-regions multiplier at two.
The completed Phase 0 run found 171,436 unique titles. The original end-to-end run
finished in 11 minutes 45 seconds, including 1,000 diagnostic lookups that are no
longer needed, with no rate-limit responses. The measured score-only catalog is
4.14 MB compressed; the implemented core with year and poster path is 8.43 MB. This fits
comfortably inside free GitHub Actions and Pages limits, and there is no separate
score-mapping or metadata-enrichment bootstrap.

The premise that the US contains every streamable title is not correct. Availability
is licensed by country; Netflix, for example, explicitly says that its library
varies by country and that a title can be licensed in Latin America before the US.
The US+NL union is therefore a personally useful approximation, not a lossless
shortcut to the worldwide union. It should capture Dutch titles reported in the
Netherlands while retaining broad US coverage, but it will still miss content
exclusive to other regions. The revised plan records that limitation and leaves
additional regions as an optional later feature.

A GitHub-hosted job still has a six-hour ceiling, while the published Pages artifact
must remain under 1 GB and deployment itself has a ten-minute limit. The measured
discovery and artifact fit those constraints with comfortable margins.

References:

- [GitHub Actions limits](https://docs.github.com/en/actions/reference/limits)
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Netflix on country-specific availability](https://help.netflix.com/en/node/125345)

### 2. The TMDB query trap is now addressed

TMDB treats commas as **AND** and pipes as **OR** for the monetization filter. The
revised bootstrap now specifies one `flatrate|free|ads` query, avoiding the risk of
a comma-separated query producing seriously incomplete results.

Reference: [TMDB movie discovery documentation](https://developer.themoviedb.org/reference/discover-movie)

### 3. Date partitioning needs a completeness strategy, not merely date ranges

Fixed yearly or monthly partitions can themselves become too large, so the builder
now subdivides date ranges adaptively. The live run created 43 retrievable leaf
partitions without a saturated single day. Titles with no known release or first-air
date remain the completeness wrinkle: dated results were roughly 0.5% below the
unpartitioned regional membership counts, and TMDB does not expose a clean pageable
null-date filter. The catalog therefore includes exhaustive dated discovery plus a
configurable unpartitioned popularity window and does not claim literal 100%
coverage.

Reference: [TMDB TV discovery parameters](https://developer.themoviedb.org/reference/discover-tv)

### 4. TV availability may not mean that the complete series is available

TMDB exposes provider information at both show and season level. A TV show might
qualify because only one season is available somewhere. Since Flixate deliberately
discards provider and season information, it cannot distinguish that case. The
simplest definition would be “at least some of the series is streamable,” but that
expectation should be consciously accepted.

Reference: [TMDB season-provider endpoint](https://developer.themoviedb.org/reference/tv-season-watch-providers)

## Product and data-model wrinkles

### 5. Documentaries should remain a cross-media genre

The plan correctly treats Documentary as a genre shortcut spanning movies and
series rather than as a third media type. Phase 2 now maps TMDB's separate movie and
TV vocabularies into shared labels, including Documentary.

### 6. Release year is now correctly part of the MVP

The title record now distinguishes shows and remakes with the same name, such as
different versions of *The Office*. All 171,436 titles in the measured union had a
captured release/first-air year, and adding it increases the compressed core by only
about 0.29 MB.

### 7. Movie and TV genre labels need a defined relationship

TMDB maintains separate movie and TV genre taxonomies. Some concepts have different
labels, such as action-oriented or science-fiction genres. Phase 2 resolved this
with an explicit shared mapping; combined TV categories can yield multiple useful
labels, such as both Action and Adventure.

### 8. Unrated-title behavior is slightly ambiguous

The plan says not to hide unrated titles unless explicitly requested, but an unrated
title cannot satisfy a numeric minimum TMDB score. A sensible interpretation is
that setting a score threshold implicitly excludes unrated records, but this should
be made unambiguous in tests and UI copy.

### 9. Rent/buy exclusion deserves one final conscious confirmation

The plan defines streaming as subscription, free, or ad-supported and excludes
rental/purchase-only titles. That is reasonable, but it is narrower than “available
outside theaters.” It is a product choice rather than a technical necessity.

## Operational wrinkles

### 10. Deferring IMDb is a meaningful simplification

TMDB scores arrive with each discovery result. The MVP therefore avoids roughly
171,000 external-ID requests, a separate daily dataset download and join, mapping
correction logic, IMDb acknowledgement work, and a redistribution/licensing TODO.
IMDb can still be evaluated after the core app is useful without shaping the MVP
schema around it.

### 11. Low-vote TMDB scores need confidence semantics

TMDB score coverage is broad—133,535 of 171,436 titles have at least one vote—but
only 31,128 have at least 50. A small vote count can make a precise-looking score
misleading. Retain and display vote count, provide a minimum-votes filter, and mark
fewer than 50 votes as low-confidence. Do not remove low-vote or unrated titles from
the catalog merely because their quality signal is weak.

### 12. Seen state can now follow one Google account across devices

Local-only use remains per browser profile, and export/import remains available.
The completed optional Google Drive sync track now carries seen state between a
person's connected devices without adding a Flixate backend. Different Google
accounts still have independent histories; shared household state remains outside
version 1 by design.

### 13. GitHub Pages introduces a small routing and PWA gotcha

A repository site is normally hosted below `/flixate/`. Vite's production base,
manifest resolution, service-worker scope, and runtime cache patterns now account
for that prefix, and Flixate intentionally has no client-side routes. Phase 3 added
the official Pages workflow and prompt-based service-worker updates. The first live
Chrome smoke test verified the asset paths, catalog and synopsis delivery, poster
CDN, `/flixate/` service-worker scope, and offline reload.

Reference: [Vite's GitHub Pages guidance](https://vite.dev/guide/static-deploy.html)

### 14. Catalog text should remain deterministic

The same title can now be encountered in both regions. The revised plan specifies
`language=en-US` and a fixed region preference for selecting display fields.
Deduplication and output sorting should also remain deterministic so identical
source snapshots produce identical artifacts.

### 15. Posters and synopses need different delivery strategies

Poster paths and overviews already arrive in discovery, with measured coverage of
94.9% and 96.4% respectively, so neither requires another service or per-title API
call. Poster paths belong in the core catalog while image bytes should load lazily
from TMDB's CDN with a placeholder and bounded cache.

Synopses are different: embedding every overview raises the projected compressed
catalog from 8.42 MB to 30.38 MB and the uncompressed JSON to 83.44 MB. Keeping
overview records in deterministic, on-demand static shards preserves the feature
without imposing that startup cost. Phase 2 implemented 128 content-addressed gzip
shards; the largest measured shard is 174.8 kB. Missing English overviews and
unavailable images remain normal, tested states.

Reference: [TMDB image basics](https://developer.themoviedb.org/docs/image-basics)
