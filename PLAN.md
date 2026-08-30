# Flixate product and architecture plan

Status: revised proposal, researched 2026-08-29

Scope clarification: the user wants to discover titles that are streamable
somewhere, but does not need to know the qualifying service or country.
The only required display metadata is title, movie/show type, and genres, alongside
the previously requested quality score and source link. IMDb is the required
version-1 source; Rotten Tomatoes would be an acceptable licensed substitute.
Poster and synopsis are optional. Shows use one overall series record and score;
seasons and episodes are out of scope.

## Recommendation

Build Flixate as a local-first progressive web app (PWA) hosted on GitHub Pages.
Use GitHub Actions to periodically assemble and deploy a static catalog containing
titles that are streamable in at least one supported country. Do not retain or show
which country or service caused a title to qualify.
Keep the user's small `seen` map in versioned browser `localStorage`, with JSON
export/import as the first backup and transfer mechanism.

This gives the project a genuinely useful zero-cost version with:

- no application server;
- no database account;
- no runtime API secrets;
- no generated catalog commits bloating the repository;
- an installable app that continues to use the last downloaded catalog offline.

Cross-device sync should be a later, optional feature. Using a repository as the
storage backend is technically possible, but secure browser authentication and
conflict handling make it disproportionately complex for the first version.

## Important reality check

"Every title available on streaming somewhere" cannot be guaranteed literally by
any free data source. Streaming availability changes constantly and there is no
free authoritative global registry.

For Flixate, define the promise as:

> Every top-level movie and series reported by TMDB/JustWatch as available through
> subscription, ad-supported, or free streaming in any region supported by their
> API, as of the catalog timestamp.

Country and service are ingestion details only. Once a title qualifies in one
country on one service, Flixate keeps the title but discards the availability
details. Rent and purchase offers do not count as streaming by default. Episodes
should not be separate catalog entries; their parent series should be.

TMDB is the practical free source. Its watch-provider data is supplied by
JustWatch and is country-specific, so the builder still queries each supported
region to construct the union. It no longer needs to enumerate providers, call the
per-title watch-provider endpoint, preserve offers, or keep provider data fresh.
JustWatch attribution remains required because its data decides catalog inclusion.
Watchmode's provider and deep-link advantages are no longer useful for this product.

## Proposed architecture

```text
                    scheduled / manual
                   GitHub Actions run
                           |
          +----------------+----------------+
          |                                 |
   TMDB + JustWatch                  prior Pages snapshot
   global title union                 for incremental work
          |                                 |
          +--------------+------------------+
                         |
              validate + compact + shard
                         |
              GitHub Pages deployment
                         |
                 static Flixate PWA
                         |
          +--------------+----------------+
          |                               |
  catalog + ratings cache         private user-state map
  in the PWA Cache API            in localStorage (`seen`)
                                          |
                                 JSON export / import

  IMDb's official ratings TSV is downloaded directly by the browser,
  parsed in a Web Worker, and cached locally if the Phase 0 spike confirms
  CORS and browser performance are acceptable.
```

The deployed app and catalog are public, because free GitHub Pages does not offer
private access control. This is acceptable only if no personal state or secret is
included in the deployment. Private Pages access control is an Enterprise Cloud
feature.

## Data sources

### TMDB and JustWatch: catalog eligibility

Use TMDB for:

- movie and series IDs;
- title, movie/show type, and genre IDs;
- IMDb external IDs;
- the boolean fact that a title is streamable in at least one supported region.

Discard TMDB's own vote average. It is a different rating population and must not
be presented or filtered as though it were an IMDb score. If no IMDb match/rating
exists, show the title as unrated.

TMDB discovery already returns poster paths and short overviews. Preserve them only
as an optional build output after the core version is proven; they do not require a
separate metadata crawl. If posters are enabled, load them from TMDB's image CDN
and do not copy image files into the repository or Pages artifact.

Required UI credits:

- the TMDB logo and required TMDB notice in an About/Credits screen;
- JustWatch attribution in the persistent footer and About/Credits screen.

### IMDb: primary quality score, vote count, and link

Construct the link from the external ID:

`https://www.imdb.com/title/{imdbId}/`

IMDb publishes `title.ratings.tsv.gz` daily for personal, non-commercial use. The
preferred design is for the browser to download this file directly from IMDb, parse
only the IDs present in the Flixate catalog in a Web Worker, and cache the resulting
`imdbId -> rating, voteCount` map locally in the Cache API. This avoids republishing
an IMDb-derived database through a public Pages deployment.

For a show, join the rating belonging to the main IMDb series ID. IMDb explicitly
states that a TV series rating is submitted for the series as a whole and is not
calculated from its episode ratings. Flixate must never download, aggregate, or
display season or episode ratings.

Keep the UI-facing score model source-aware even though version 1 uses only IMDb:

```ts
type QualityScore = {
  source: "imdb";
  value: number; // 0–10
  voteCount: number;
  url: string;
};
```

The score filter operates on IMDb's 0–10 value. Retaining `voteCount` enables an
optional minimum-votes filter so a very high score based on a handful of ratings is
not mistaken for a well-established consensus.

Phase 0 must verify:

1. the dataset endpoint permits the required browser request;
2. download, decompression, parsing, and in-memory use are acceptable on desktop
   and a representative phone;
3. the implementation and attribution comply with IMDb's personal-use terms.

If direct browser ingestion fails, the fallback is an Action-generated ratings
subset, but that should not be publicly deployed until its use under IMDb's terms
has been reviewed. OMDb's free 1,000-requests-per-day API is useful for prototypes
or on-demand lookups, but cannot populate and filter a worldwide catalog reliably.

### Rotten Tomatoes: acceptable product fallback, not a version-1 data source

Rotten Tomatoes does not advertise a self-service public dataset or free developer
API suitable for this catalog. Its official licensing page requires an application
and approval to integrate scores through APIs or data feeds, plus source-specific
branding and linking. Its terms prohibit automated scraping/data mining.

Therefore, do not scrape Rotten Tomatoes and do not make it part of the initial
pipeline. If licensed API access becomes available later, add a source adapter and
use the overall-series score for shows. Label the source visibly and do not silently
mix IMDb and Rotten Tomatoes values as though they were the same rating system.

## Catalog update design

### Initial bootstrap

1. Fetch TMDB's supported watch-provider regions.
2. For every supported region, run movie and TV discovery for `flatrate`, `free`,
   and `ads` availability.
3. Partition large discovery queries by release/air-date ranges so no result set is
   silently truncated by API pagination limits.
4. Union and deduplicate results by `(mediaType, tmdbId)`.
5. Reuse the IMDb external ID from the previous snapshot for known TMDB IDs. Look
   it up only for new or previously unmatched titles. This lookup remains necessary
   for IMDb scores and links; do not hydrate any other detail fields and do not call
   the per-title watch-provider response. Throttle requests, back off on `429`, and
   make the job restartable.
6. Remove adult titles, seasons, episodes, and other non-top-level types. Retain
   unrated or IMDb-unmatched titles, but label them as unrated rather than dropping
   them.
7. Dictionary-encode genres; generate a manifest and compact catalog file.
8. Validate counts, referential integrity, duplicate IDs, catalog size, and a sample
   of union membership before deployment.
9. Deploy through the official Pages artifact flow. Do not commit generated catalog
   files to normal Git history.

The bootstrap can be progressive if it is too large for one responsible API run:
publish a manifest with coverage/progress, map IMDb IDs for a bounded batch per
workflow run, and let subsequent runs fetch and extend the current Pages snapshot.

### Ongoing refresh

Use one simple weekly schedule:

- rebuild the union from regional discovery, adding newly streamable titles and
  removing titles no longer reported in any supported region;
- carry forward existing IMDb ID mappings and query only new/missing mappings;
- after every successful run: publish only if validation passes, retaining the last
  good snapshot otherwise.

The UI must show the catalog timestamp. It does not need availability details or a
provider-specific staleness model; the only relevant age is the global-union
snapshot date.

Action secrets should contain the TMDB read token. The token must never appear in
the built JavaScript, Pages files, logs, pull-request workflows, or catalog output.

### Static data format

Start with one compact compressed JSON catalog plus a small manifest. Cache the last
good response through the PWA Cache API, parse it in a Web Worker, and query it in
memory. Activate a new version only after its hash and schema validate. Add
IndexedDB, SQLite-WASM, or sharding only if Phase 0 measurements show they are
needed.

Suggested manifest fields:

- schema version;
- snapshot ID and creation timestamp;
- source timestamps;
- title, movie, and series counts plus number of source regions scanned;
- coverage/bootstrap status;
- catalog URL, hash, and byte size;
- attribution version.

Suggested title record:

- stable key: `movie:{tmdbId}` or `tv:{tmdbId}`;
- TMDB and IMDb IDs;
- display title;
- media type (`movie` or `show`);
- genre IDs;
- optionally, poster path and short overview.

If the Phase 0 measurements show excessive memory use, a first load above roughly
10 seconds on a mid-range phone, or poor multi-filter latency, compare IndexedDB,
SQLite-WASM, or partitioned Parquet before committing to the in-memory approach.

## User-state design

Keep personal state as one small, versioned `localStorage` document keyed by the
stable title key. Replacing or clearing the catalog cache must never replace user
state. The browser `storage` event can keep multiple Flixate tabs in sync.

Version 1 state:

```ts
type UserStateV1 = {
  version: 1;
  titles: Record<
    `movie:${number}` | `tv:${number}`,
    { seen: boolean; updatedAt: string }
  >;
};
```

Use explicit tombstones (`seen: false`) rather than deleting records. That makes a
future sync merge deterministic. Add `seenAt`, personal rating, notes, and watchlist
status only after the basic interaction is proven. Move to IndexedDB only if state
grows beyond what is sensible for `localStorage`.

Version 1 backup:

- export a small versioned `flixate-backup.json` file;
- import with validation and a preview of additions/changes;
- merge by `updatedAt` rather than replacing blindly;
- include settings but never catalog data or credentials.

## Repository-as-backend assessment

The idea is not wild. A static app can write `seen.json` to a private repository
through GitHub's Contents API. It would need compare-and-swap updates using the
file's SHA, debounced writes, conflict merging, tombstones, and retry logic.

The awkward part is authentication:

- a normal OAuth web flow needs a client secret/token exchange that a public static
  app cannot keep secret;
- GitHub documents PKCE for public clients, but token lifecycle and refresh still
  have client-secret constraints in common GitHub App flows;
- device flow avoids a client secret but is intended for headless clients and is
  discouraged for ordinary browser apps;
- asking the user to paste a fine-grained personal access token works, but leaves a
  password-equivalent credential accessible to browser code and any XSS bug.

Therefore:

- do not make GitHub sync part of the MVP;
- if JSON transfer becomes annoying, prototype a GitHub App limited to Contents
  read/write on one dedicated private `flixate-data` repository;
- use a tiny serverless OAuth/token broker if secure GitHub authentication cannot be
  completed entirely as a public client;
- batch writes rather than making a commit for every click;
- never store personal state in the public application repository or a "secret"
  gist (secret gists are unlisted, not private).

A simpler optional sync service would be a small Cloudflare Worker plus KV/D1 on
the free tier. It is more conventional and safer to authenticate, but it introduces
the external service and database setup the project is trying to avoid. Revisit it
only after there is a demonstrated cross-device need.

## Product scope

### MVP interactions

- compact virtualized movie/show list or card grid;
- instant title search;
- one-click seen/unseen toggle on every result;
- three-state seen filter: hide seen (default), show all, seen only;
- minimum/maximum IMDb score and minimum vote count;
- genres with any/all matching;
- movie, series, or both;
- sort by IMDb score, IMDb vote count, or title;
- IMDb link;
- catalog freshness, coverage, and attribution in the UI;
- installable PWA with the last successful catalog usable offline.

Useful defaults:

- hide seen titles;
- catalog eligibility means subscription, free, or ad-supported availability in at
  least one supported country;
- rent and buy alone do not make a title eligible;
- hide adult content;
- do not hide unrated titles unless explicitly requested.

### Later features

- poster and short synopsis, if the text-first interface feels too sparse;
- shareable filter presets;
- watchlist/"maybe" state separate from seen;
- personal rating and notes;
- suggestions based on genres, score, and unseen state;
- optional cross-device sync;
- a licensed Rotten Tomatoes score adapter, only if official access becomes
  available and replacing IMDb remains desirable.

## Implementation stack

- TypeScript;
- React and Vite for the static app;
- `vite-plugin-pwa` for installation and app-shell caching;
- the Cache API for replaceable catalog and derived IMDb-rating caches;
- versioned `localStorage` for user state;
- a Web Worker for catalog and IMDb TSV parsing;
- a virtualized grid for large result sets;
- Node/TypeScript scripts for catalog assembly;
- Vitest for units and Playwright for critical browser flows;
- GitHub Actions for checks, scheduled catalog work, and Pages deployment.

Keep the catalog builder independent of React so it can be tested and run locally.
React is a convenience, not an architectural dependency.

## Delivery plan

### Phase 0 — feasibility spike and decisions (small, mandatory)

- Initialize the repository and basic TypeScript workspace.
- Fetch a multi-region TMDB sample (for example NL, US, and JP).
- Measure title counts, cross-region duplication, request count, and payload size.
- Prove date partitioning for discovery result sets.
- Test direct IMDb ratings ingestion in desktop and mobile-class browsers.
- Verify that sampled shows map to their overall IMDb series entries and that no
  season/episode IDs or ratings enter the output.
- Confirm required TMDB, JustWatch, and IMDb attribution/licensing behavior.
- Test a representative Pages artifact, Cache API update, and in-memory parse.

Exit gate: data can be acquired within terms, score filtering works, projected
global size fits comfortably inside Pages/browser limits, and no runtime key leaks.

### Phase 1 — local-first vertical slice (medium)

- Build the compact result view, IMDb link, and seen toggle.
- Add persistent local state, backup export/import, and core filters.
- Use the small multi-region fixture so UI work is fast and deterministic.
- Add unit tests for filtering and state migrations plus an end-to-end seen flow.

Exit gate: the app is already useful on one device and survives reloads, upgrades,
and backup round-trips.

### Phase 2 — worldwide catalog pipeline (medium/highest risk)

- Implement restartable global-union discovery, deduplication, IMDb-ID mapping,
  compaction, and validation.
- Add progressive bootstrap if one run is too large.
- Add the weekly rebuild and previous-snapshot IMDb-ID reuse.
- Produce coverage and freshness summaries in Action job output and the manifest.

Exit gate: every record returned by the defined regional discovery snapshot is
accounted for, updates are repeatable, and a failed run cannot replace good data.

### Phase 3 — GitHub Pages production deployment (small)

- Build and deploy with the official Pages Actions flow.
- Store only source credentials in Actions secrets.
- Add PWA caching, update notification, Credits/About, and error recovery.
- Document one-time setup and how to run a manual refresh.

Exit gate: normal use and scheduled refresh require no server or manual database
maintenance and remain within free GitHub limits.

### Phase 4 — refinement (medium)

- Add remaining filters, presets, accessibility, keyboard use, and responsive polish.
- Add optional posters/synopses if they materially improve discovery.
- Tune parse/query performance from real catalog measurements and shard only if
  necessary.
- Add snapshot-age and coverage indicators.

### Phase 5 — optional sync experiment (only if needed)

- First test the dedicated-private-repo approach with a narrowly installed GitHub
  App and a mergeable state file.
- Threat-model browser token storage and XSS before shipping it.
- Compare the setup and UX with a tiny Worker/KV implementation.
- Keep JSON export/import permanently available as an escape hatch.

## Acceptance criteria for version 1

- A user can browse the defined global streaming union and see the snapshot date.
- A title shows an IMDb score/vote count when IMDb has one and always links correctly
  when an IMDb ID is known.
- Every show represents the series as a whole; no season or episode records or
  ratings enter the catalog.
- Seen/unseen is one action, persists locally, and can be hidden by default.
- Search and all documented filters compose correctly without a page reload.
- Personal state is absent from the repository, Pages deployment, logs, and URLs.
- API credentials are absent from all client assets and generated data.
- The last valid catalog and user state remain usable after a failed refresh.
- The app includes all source attribution required by TMDB, JustWatch, and IMDb.
- The catalog artifact and traffic remain comfortably below GitHub Pages' 1 GB
  published-site and 100 GB/month soft bandwidth limits.

## Main risks and mitigations

| Risk | Mitigation |
| --- | --- |
| "All worldwide" is larger or less complete than expected | Define coverage precisely, measure first, publish counts and timestamps |
| Initial TMDB crawl is too slow or unfriendly to the API | Throttle, back off, partition, checkpoint, and progressively map IMDb IDs |
| Streamable/not-streamable membership becomes stale | Weekly clean union rebuild and a visible snapshot date |
| IMDb browser ingestion fails or violates expected usage | Make it a Phase 0 gate; do not silently scrape IMDb pages |
| Rotten Tomatoes looks like an easy fallback but has no self-service free feed | Use IMDb for version 1; use RT only through approved licensed access and never scrape it |
| Large catalog performs poorly on phones | Worker parsing, validated cache swaps, virtual grid, benchmark before global rollout |
| GitHub Pages is mistaken for a private site | Store no personal data there; document that the URL and assets are public |
| User clears browser storage or changes devices | Versioned JSON export/import first; optional sync later |
| Generated data bloats Git history | Deploy an artifact; do not commit snapshots on every run |
| A scheduled build publishes corrupt/incomplete data | Validate first and deploy atomically only on success |

## Sources checked

- [TMDB watch-provider endpoint and JustWatch attribution](https://developer.themoviedb.org/reference/movie-watch-providers)
- [TMDB discover TV filters](https://developer.themoviedb.org/reference/discover-tv)
- [TMDB available watch-provider regions](https://developer.themoviedb.org/reference/watch-providers-available-regions)
- [TMDB non-commercial use and attribution FAQ](https://developer.themoviedb.org/docs/faq)
- [TMDB rate limiting guidance](https://developer.themoviedb.org/docs/rate-limiting)
- [IMDb non-commercial datasets](https://www.imdb.com/interfaces/)
- [IMDb guidance for software use](https://help.imdb.com/article/imdb/general-information/can-i-use-imdb-data-in-my-software/G5JTRESSHJBBHTGX)
- [IMDb explanation of overall TV-series ratings](https://help.imdb.com/redirect/votestopfaq?votestopfaqWho=)
- [Rotten Tomatoes data and trademark licensing](https://www.rottentomatoes.com/help_desk/licensing)
- [Rotten Tomatoes terms prohibiting automated data extraction](https://www.rottentomatoes.com/policies/terms-of-use)
- [OMDb API and free-key limit](https://www.omdbapi.com/apikey.aspx)
- [Watchmode coverage and current plans](https://api.watchmode.com/)
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [GitHub Pages overview](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [GitHub Pages private access control](https://docs.github.com/en/enterprise-cloud@latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site)
- [GitHub Actions free-use allowances](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [GitHub Contents API](https://docs.github.com/en/rest/repos/contents)
- [GitHub OAuth application best practices](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app)
