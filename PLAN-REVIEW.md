# Flixate plan review

Reviewed: 2026-08-30

## Verdict

The plan is coherent and viable as a personal, zero-cost project. There is no fatal
architectural mistake. Restricting version 1 to US availability substantially
reduces the original crawler risk, although it introduces an explicit coverage
trade-off. The remaining findings are definitional or implementation details that
can be resolved without adding hosting, a database, or paid services.

## Most important findings

### 1. US-only discovery resolves the region multiplier, but not worldwide coverage

Querying only the US removes the supported-regions multiplier from discovery and
makes the scheduled job far more likely to fit comfortably inside free GitHub
Actions. It does not remove pagination, date partitioning, or the initial IMDb-ID
mapping workload, so the complete US pass still needs to be measured in Phase 0.

The premise that the US contains every streamable title is not correct. Availability
is licensed by country; Netflix, for example, explicitly says that its library
varies by country and that a title can be licensed in Latin America before the US.
US-only discovery is therefore an approximation that will miss some regional and
non-English content, not a lossless shortcut to the worldwide union. The revised
plan records that limitation and leaves additional regions as an optional later
feature.

A GitHub-hosted job still has a six-hour ceiling, while the published Pages artifact
must remain under 1 GB and deployment itself has a ten-minute limit. The spike should
produce concrete US request-count, runtime, and output-size measurements before
Phase 2 begins.

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
needs adaptive subdivision. Titles with no known release or first-air date need
special handling as well; TMDB TV discovery excludes null first-air dates by
default. This should be explicitly tested alongside the partitioning work in the
bootstrap.

Reference: [TMDB TV discovery parameters](https://developer.themoviedb.org/reference/discover-tv)

### 4. TV availability may not mean that the complete series is available

TMDB exposes provider information at both show and season level. A TV show might
qualify because only one season is available somewhere. Since Flixate deliberately
discards provider and season information, it cannot distinguish that case. The
simplest definition would be “at least some of the series is streamable,” but that
expectation should be consciously accepted.

Reference: [TMDB season-provider endpoint](https://developer.themoviedb.org/reference/tv-season-watch-providers)

## Product and data-model wrinkles

### 5. Documentaries are not yet reflected in the document

They should remain a genre or preset spanning movies and series, rather than become
a third media type. The MVP supports genres generally, but does not call out a
convenient Documentary shortcut.

### 6. A release year is probably worth retaining

The proposed title record cannot visibly distinguish two shows or remakes with the
same title. Examples such as different versions of *The Office* would otherwise be
identical until someone follows the IMDb link. Year is tiny in storage terms and
unusually valuable here.

### 7. Movie and TV genre labels need a defined relationship

TMDB maintains separate movie and TV genre taxonomies. Some concepts have different
labels, such as action-oriented or science-fiction genres. Flixate must either
present the source genres unchanged or map them into a shared vocabulary; otherwise
a single genre filter may behave surprisingly across movies and shows.

### 8. Unrated-title behavior is slightly ambiguous

The plan says not to hide unrated titles unless explicitly requested, but an unrated
title cannot satisfy a numeric minimum IMDb score. A sensible interpretation is
that setting a score threshold implicitly excludes unrated records, but this should
be made unambiguous in tests and UI copy.

### 9. Rent/buy exclusion deserves one final conscious confirmation

The plan defines streaming as subscription, free, or ad-supported and excludes
rental/purchase-only titles. That is reasonable, but it is narrower than “available
outside theaters.” It is a product choice rather than a technical necessity.

## Operational wrinkles

### 10. IMDb mappings can be corrected over time

Reusing IDs indefinitely and looking them up only for new or unmatched titles is
efficient, but a mistaken TMDB-to-IMDb mapping would then persist forever. A slow
periodic revalidation, perhaps a rotating fraction each week, would prevent
permanent bad links and ratings.

### 11. IMDb requires prescribed acknowledgement wording

The plan requires general IMDb attribution in its acceptance criteria, but its
explicit UI credits currently mention only TMDB and JustWatch. IMDb publishes
specific acknowledgement text that should be included during implementation. This
is separate from the already-acknowledged republication risk.

Reference: [IMDb usage guidance](https://help.imdb.com/article/imdb/general-information/can-i-use-imdb-data-in-my-software/G5JTRESSHJBBHTGX)

### 12. Seen state will not automatically be shared between people or devices

It is per browser profile and device. Export/import supports manual transfer, but
two people using Flixate independently will have two seen lists. That is already an
intentional architectural trade-off in the user-state design.

### 13. GitHub Pages introduces a small routing and PWA gotcha

A repository site is normally hosted below `/flixate/`, so Vite's base path,
manifest paths, service-worker scope, and cached catalog URL must all use that
prefix. Client-side routes also need a Pages-compatible strategy, such as hash
routing or avoiding routes altogether.

Reference: [Vite's GitHub Pages guidance](https://vite.dev/guide/static-deploy.html)

### 14. Catalog text should remain deterministic

The move to one region removes cross-region merge order as a source of variation.
The revised plan also specifies `language=en-US`. Deduplication and output sorting
should nevertheless remain deterministic so identical source snapshots produce
identical artifacts.
