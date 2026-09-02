# Flixate product and architecture plan

Status: revised proposal, researched through 2026-08-31

Scope clarification: the user wants to discover titles that are streamable
somewhere, but does not need to know the qualifying service. Version 1 uses the
combined US and Netherlands streaming catalogs as a deliberately simple, broad,
personally relevant approximation rather than crawling every country.
The MVP display metadata is title, release year, movie/show type, genres, poster,
short synopsis, quality score, and source link. Version 1 uses TMDB's 0–10 user
score and vote count. IMDb and Rotten Tomatoes are possible later adapters, not MVP
dependencies. Shows use one overall series record and score; seasons and episodes
are out of scope.

## Quick glossary

- **TMDB (The Movie Database):** an online movie/TV database with a developer API.
  Flixate uses it for titles, release years, movie/show type, genres, quality
  scores, posters, synopses, and determining whether something is streamable in
  the US or Netherlands.
- **JustWatch:** a service that tracks where movies and shows are available to
  stream. TMDB exposes availability data supplied by JustWatch, so Flixate can use
  it through TMDB without integrating every streaming service separately. Flixate
  only keeps the answer “streamable in the US or Netherlands,” not the service or
  qualifying country.
- **IMDb (Internet Movie Database):** another well-known 0–10 rating source. It is
  deliberately deferred until after the MVP because using it would require mapping
  every TMDB title and resolving redistribution/licensing questions.
- **GitHub Pages:** GitHub's static website hosting. It serves the Flixate web app
  and generated catalog without requiring a conventional server.
- **GitHub Actions:** automated jobs run by GitHub. A scheduled Action periodically
  rebuilds the streaming catalog and publishes it to GitHub Pages.
- **PWA (Progressive Web App):** a website that can be installed and behave much
  like a normal app, including retaining its last downloaded catalog for offline
  use.

## Recommendation

Build Flixate as a local-first progressive web app (PWA) hosted on GitHub Pages.
Use GitHub Actions to periodically assemble and deploy a static catalog containing
titles that are streamable in the US or Netherlands. Do not retain or show which
country or service caused a title to qualify.
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

## Zero-cost sanity check

The version-1 plan has no required license fee, hosting bill, database bill, domain
purchase, or paid API. It is technically viable at $0 for personal use and a couple
of friends, with these conditions and small frictions:

| Component | Cost | Friction/condition |
| --- | --- | --- |
| GitHub Pages | $0 | The repository, deployed app, and generated catalog are public on GitHub Free; use the supplied `github.io` URL rather than buying a domain |
| GitHub Actions | $0 | Standard runners are free for public repositories, but GitHub disables scheduled workflows after 60 days without repository activity; provide a manual Refresh workflow and show catalog age |
| TMDB metadata/API and poster CDN | $0 | Register for a developer API key, remain non-commercial, show required attribution, refresh cached TMDB content within its six-month limit, respect rate limits, and lazy-load modest poster sizes |
| JustWatch-derived eligibility | $0 through TMDB | JustWatch attribution is mandatory; no separate Watchmode/JustWatch subscription is planned |
| TMDB ratings | $0 through TMDB | `vote_average` and `vote_count` arrive in discovery results, so no second data source, title mapping, or rating import is needed |
| IMDb ratings | Not used in MVP | Reconsider after the app is useful; its mapping and distribution constraints do not affect version 1 |
| Seen state | $0 | Browser-local storage plus manual JSON backup/import; no automatic cross-device sync |
| Rotten Tomatoes | Not used | Official data integration requires an approved licensing arrangement, so it cannot be assumed to fit the budget |

Occasional manual re-enabling/triggering of the catalog workflow is the only
expected operational friction. No rating-file download, import, passphrase, or
separate rating account is required by an app user.

## Important reality check

"Every title available on streaming somewhere" cannot be guaranteed literally by
any free data source. Streaming availability changes constantly, catalogs differ
by country, and there is no free authoritative global registry. Combining the broad
US catalog with the personally relevant Netherlands catalog should cover most likely
interests, but it does not contain every title streamable elsewhere and must not be
described as worldwide coverage.

For Flixate, define the promise as:

> Every top-level movie and series reported by TMDB/JustWatch as available through
> subscription, ad-supported, or free streaming in the US or Netherlands, as of the
> catalog timestamp.

The qualifying region and service are ingestion details only. Once a title qualifies
on one US or Netherlands service, Flixate keeps the title but discards the
availability details. Rent and purchase offers do not count as streaming by default.
Episodes should not be separate catalog entries; their parent series should be.

TMDB is the practical free source. Its watch-provider data is supplied by
JustWatch and is country-specific. Version 1 queries only `watch_region=US` and
`watch_region=NL`, which removes most of the cost and complexity of a worldwide
regional union but knowingly misses titles available exclusively elsewhere. The
builder does not need to enumerate providers, call the per-title watch-provider
endpoint, preserve offers, or keep provider data fresh. JustWatch attribution
remains required because its data decides catalog inclusion. Watchmode's provider
and deep-link advantages are no longer useful for this product.

## Proposed architecture

```text
 scheduled/manual catalog workflow          push/manual app workflow
                 |                                  |
         TMDB + JustWatch                 latest catalog artifact
         US + NL title union                        |
                 |                         validate snapshot hashes
        validate + compact                         |
                 |                                  |
       seven-day catalog artifact +----------------+
                 |                                  |
                 +---------- build app -------------+
                                    |
                         GitHub Pages deployment
                                    |
                            static Flixate PWA
                         |
          +--------------+----------------+
          |                               |
  core catalog + synopsis shards  private user-state map
  cached by the PWA               in localStorage (`seen`)
                                          |
                                 JSON export / import

  Poster paths come from discovery; poster images load lazily from TMDB's CDN.
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
- user score and vote count;
- the boolean fact that a title is streamable in the US or Netherlands.

Keep TMDB's `vote_average` and `vote_count` directly from discovery. Present the
value explicitly as a TMDB score, never as IMDb or Rotten Tomatoes. A zero-vote
record is unrated. Do not impose a hard minimum-vote cutoff on catalog inclusion;
retain vote count so users can filter it and the UI can mark scores based on fewer
than 50 votes as low-confidence.

TMDB discovery already returns release/first-air date, poster path, and short
overview, so these MVP fields require no per-title enrichment crawl or additional
data provider. Store only the year in the core catalog. Store the poster path there
too, but load an appropriately sized image lazily from TMDB's image CDN; do not copy
poster files into the repository or Pages artifact. The builder may read TMDB's
configuration once per run to publish the supported image base URL and size.

Keep synopses out of the core catalog because the text materially increases initial
download and parse cost. Publish them in deterministic, compressed static shards
indexed by stable title key. Fetch a shard only when the user expands a title, and
use a clear fallback when TMDB has no English overview. No runtime TMDB credential
is needed.

Required UI credits:

- the TMDB logo and required TMDB notice in an About/Credits screen;
- JustWatch attribution in the persistent footer and About/Credits screen.

Construct the title link directly from the existing TMDB ID:

- movie: `https://www.themoviedb.org/movie/{tmdbId}`;
- show: `https://www.themoviedb.org/tv/{tmdbId}`.

Keep the UI-facing score model source-aware so another provider can be added later:

```ts
type QualityScore = {
  source: "tmdb";
  value: number; // 0–10
  voteCount: number;
  url: string;
};
```

The score filter operates on TMDB's 0–10 value. Retaining `voteCount` enables an
optional minimum-votes filter so a very high score based on a handful of ratings is
not mistaken for a well-established consensus.

Phase 0 verified score coverage, output size, and in-memory performance on desktop
and simulated mobile-class Chrome. IMDb can be reconsidered after MVP as an
optional source adapter, subject to mapping cost, attribution, and distribution
terms. It must not be silently mixed with TMDB scores.

### Rotten Tomatoes: acceptable product fallback, not a version-1 data source

Rotten Tomatoes does not advertise a self-service public dataset or free developer
API suitable for this catalog. Its official licensing page requires an application
and approval to integrate scores through APIs or data feeds, plus source-specific
branding and linking. Its terms prohibit automated scraping/data mining.

Therefore, do not scrape Rotten Tomatoes and do not make it part of the initial
pipeline. If licensed API access becomes available later, add a source adapter and
use the overall-series score for shows. Label the source visibly and do not silently
mix TMDB and Rotten Tomatoes values as though they were the same rating system.

## Catalog update design

### Initial bootstrap

1. For each of `watch_region=US` and `watch_region=NL`, run movie and TV discovery
   with a fixed `language=en-US` and
   `with_watch_monetization_types=flatrate|free|ads`. The pipe is important: TMDB
   treats it as OR, while a comma means AND.
2. Partition large discovery queries by release/air-date ranges so no result set is
   silently truncated by API pagination limits.
3. Union and deduplicate results by `(mediaType, tmdbId)`. When a title occurs in
   both regions, select display fields deterministically using a fixed region
   preference so identical source snapshots produce identical artifacts.
4. Copy TMDB's release/first-air year, poster path, overview, score, and vote count
   from the discovery response; no per-title enrichment request or rating import is
   needed.
5. Remove adult titles, seasons, episodes, and other non-top-level types. Retain
   zero-vote titles, but label them as unrated rather than dropping them.
6. Retain TMDB's compact genre IDs with an explicit shared movie/show label mapping,
   and generate the core catalog containing year and poster path. Generate
   deterministic synopsis shards separately.
7. Validate per-region and union counts, referential integrity, duplicate IDs,
   core/shard sizes, metadata and score coverage, and a sample of US and Netherlands
   discovery membership before deployment.
8. Deploy through the official Pages artifact flow. Do not commit generated catalog
   files to normal Git history.

The bootstrap can be progressive if it is too large for one responsible API run:
publish a manifest with coverage/progress and let subsequent workflow runs fetch
and extend the current Pages snapshot.

### Ongoing refresh

Use one simple nightly schedule:

- rebuild the US+NL union from discovery, adding newly streamable titles and removing
  titles no longer reported in either region;
- after every successful run: publish only if validation passes, retaining the last
  good snapshot otherwise.

Keep catalog generation separate from normal app deployment. The catalog workflow
uploads a seven-day immutable snapshot artifact after validating its manifest,
sizes, SHA-256 hashes, compressed payloads, record counts, and synopsis shards. A
normal app push downloads the latest successful catalog artifact, repeats that
validation, and builds Pages without contacting TMDB. If a catalog format change is
incompatible with the retained artifact, the app deployment must fail safely until
the catalog workflow is run manually with the new format.

Also expose the catalog updater through `workflow_dispatch`. GitHub automatically
disables scheduled workflows in public repositories after 60 days without
repository activity. The app should treat this as expected zero-cost maintenance:
show a stale-catalog warning and link the owner to the manual workflow instructions.
Do not create fake keep-alive commits merely to evade that policy.

The UI must show the catalog timestamp. It does not need availability details or a
provider-specific staleness model; the only relevant age is the US+NL union snapshot
date.

Action secrets should contain the TMDB read token. It may not appear in built
JavaScript, Pages files, logs, pull-request workflows, or generated output.
Workflows triggered from untrusted pull requests must never receive it. The
deferred IMDb integration is not part of this workflow.

### Static data format

Use one compact compressed core catalog, deterministic compressed synopsis shards,
and a small manifest. The core contains everything needed to search, filter, sort,
and render collapsed result cards. Fetch a synopsis shard only when a title is
expanded. Cache the last good core response through the PWA Cache API, parse it in
a Web Worker, and query it in memory. Activate a new version only after its hash and
schema validate. Store gzip payloads with an opaque `.json.gz.bin` suffix and
explicitly decompress their bytes in the worker rather than allowing a host to add
`Content-Encoding` and transform the response. Add IndexedDB,
SQLite-WASM, or further core-catalog partitioning only if measurements show they are
needed.

Phase 0 projections for the full union are 4.43 MB compressed for year plus the
current compact fields and 8.42 MB after adding poster paths. Putting all synopses
in that same file would raise it to 30.38 MB, which is why synopsis delivery is
separate. Target synopsis shards small enough that expanding one title downloads
only a few hundred kilobytes at most.

Suggested manifest fields:

- schema version;
- snapshot ID and creation timestamp;
- source timestamps;
- title, movie, and series counts plus the source regions (`US` and `NL`);
- coverage/bootstrap status;
- catalog URL, hash, and byte size;
- synopsis shard scheme, URLs, hashes, and byte sizes;
- score source and low-confidence vote threshold;
- TMDB poster base URL and selected image size;
- attribution version.

Suggested title record:

- stable key: `movie:{tmdbId}` or `tv:{tmdbId}`;
- TMDB ID;
- display title;
- release/first-air year;
- media type (`movie` or `show`);
- genre IDs;
- TMDB rating and vote count when at least one vote exists;
- poster path when available.

Suggested synopsis-shard record:

- stable title key;
- short TMDB overview.

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
- release/first-air year and a lazy-loaded poster with a neutral missing-image
  placeholder;
- expandable title details containing the short synopsis or a clear unavailable
  state;
- instant title search;
- one-click seen/unseen toggle on every result;
- three-state seen filter: hide seen (default), show all, seen only;
- minimum/maximum TMDB score and minimum vote count;
- genres with any/all matching, including a Documentary shortcut spanning movies
  and shows;
- movie, series, or both;
- sort by TMDB score, TMDB vote count, or title;
- TMDB link;
- catalog freshness, coverage, and attribution in the UI;
- installable PWA with the last successful catalog usable offline.

Useful defaults:

- hide seen titles;
- catalog eligibility means subscription, free, or ad-supported availability in the
  US or Netherlands;
- rent and buy alone do not make a title eligible;
- hide adult content;
- do not hide unrated titles unless explicitly requested.
- keep titles with missing posters or synopses visible and show intentional fallback
  states;
- guarantee offline access to the app shell, core catalog, and user state; uncached
  posters and synopsis shards may be unavailable while offline.

### Later features

- shareable filter presets;
- watchlist/"maybe" state separate from seen;
- personal rating and notes;
- suggestions based on genres, score, and unseen state;
- optional cross-device sync;
- optional additional watch regions or a worldwide union if US+NL coverage proves
  too limiting;
- an optional IMDb score/link adapter after MVP, subject to mapping cost,
  attribution, and redistribution terms;
- a licensed Rotten Tomatoes score adapter, only if official access becomes
  available and replacing TMDB remains desirable.

## Implementation stack

- TypeScript;
- React and Vite for the static app;
- `vite-plugin-pwa` for installation and app-shell caching;
- the Cache API for the replaceable catalog;
- versioned `localStorage` for user state;
- a Web Worker for catalog parsing;
- a virtualized grid for large result sets;
- Node/TypeScript scripts for catalog assembly;
- Vitest for units and Playwright for critical browser flows;
- GitHub Actions for checks, scheduled catalog work, and Pages deployment.

Keep the catalog builder independent of React so it can be tested and run locally.
React is a convenience, not an architectural dependency.

## Delivery plan

### Phase 0 — feasibility spike and decisions (small, mandatory)

Status: completed on 2026-08-30. See [PHASE-0.md](PHASE-0.md) for the reproducible
commands, measurements, and remaining caveats. The result is a go for Phase 1.

- Initialize the repository and basic TypeScript workspace.
- Fetch representative US and Netherlands TMDB samples and then exercise a complete
  two-region discovery pass.
- Measure per-region counts, overlap, unique additions, request count, runtime, and
  payload size.
- Prove date partitioning for discovery result sets.
- Measure TMDB score coverage and compare a sample with IMDb to confirm it is
  adequate for quick quality filtering.
- Measure release-year, poster-path, and overview coverage plus their projected core
  and sharded payload sizes.
- Test the resulting scored catalog in desktop and mobile-class browsers.
- Verify that only top-level shows enter the output; seasons and episodes remain
  out of scope.
- Confirm required TMDB and JustWatch attribution.
- Test a representative Pages artifact, Cache API update, and in-memory parse.

Exit gate: data comes only from the documented official sources, score filtering
works, the complete US+NL union fits comfortably inside Pages/browser limits, and
no runtime key leaks.

### Phase 1 — local-first vertical slice (medium)

Status: implemented on 2026-08-31. See [PHASE-1.md](PHASE-1.md) for the feature
inventory, verification results, and original Phase 2 boundary. The representative
fixture remains the default development source; Phase 2 has since connected the
same UI contract to the complete generated catalog.

- Build the compact result card with title, year, poster, score, TMDB link, expandable
  synopsis, and seen toggle.
- Add persistent local state, backup export/import, and core filters.
- Use a small US+NL core fixture plus synopsis shards so UI work is fast and
  deterministic, including missing-poster and missing-synopsis cases.
- Add unit tests for filtering and state migrations plus an end-to-end seen flow.
- Lazy-load posters and synopsis shards; bound runtime image caching rather than
  pre-caching the complete poster corpus.

Exit gate: the app is already useful on one device and survives reloads, upgrades,
and backup round-trips.

### Phase 2 — US+NL catalog pipeline (medium)

Status: implemented on 2026-08-31. See [PHASE-2.md](PHASE-2.md) for the measured
artifact sizes, validation coverage, and remaining Phase 3 deployment boundary.

- Implement restartable two-region discovery, deduplication, TMDB metadata/score
  retention, core-catalog compaction, synopsis sharding, and validation.
- Keep response-level restartability; a progressive multi-run bootstrap is not
  needed because the measured cold crawl completes comfortably inside one job.
- Add the nightly rebuild and same-run raw-response caching/checkpointing.
- Produce coverage and freshness summaries in Action job output and the manifest.

The complete cached US+NL rebuild produced 171,436 titles, an 8.43 MB compressed
core, and 128 synopsis shards whose largest compressed file is 174.8 kB. The app
loads and validates this snapshot successfully in real-browser end-to-end tests.

Exit gate: every record returned by the defined US and Netherlands discovery
snapshot is accounted for, updates are repeatable, and a failed run cannot replace
good data.

### Phase 3 — GitHub Pages production deployment (small)

Status: completed on 2026-09-01. See [PHASE-3.md](PHASE-3.md) for the first deployed
snapshot measurements, live smoke-test results, and refresh/recovery instructions.

- Build and deploy with the official Pages Actions flow.
- Keep fast app deployments separate from nightly/manual catalog generation, using
  a validated short-retention workflow artifact as their handoff.
- Store the TMDB credential in Actions secrets.
- Add PWA caching, update notification, Credits/About, and error recovery.
- Verify explicit catalog/shard decompression and TMDB image CDN behavior on the
  deployed Pages site.
- Document one-time setup and how to run a manual refresh.
- Document GitHub's 60-day public-repository schedule disablement and how to
  re-enable the workflow.

Exit gate: normal use and active scheduled refresh require no server or database
maintenance and remain within free GitHub limits; recovery from GitHub's inactivity
disablement is documented and takes only a manual workflow re-enable/run.

### Phase 4 — refinement (medium; after the sync track)

Status: deferred until the promoted cross-device sync track has reached its go/no-go
gate and, if viable, its initial rollout.

- Add remaining filters, presets, accessibility, keyboard use, and responsive polish.
- Tune parse/query performance from real catalog measurements and shard only if
  necessary.
- Add snapshot-age and coverage indicators.

### Phase 5 — cross-device sync (promoted; execute next)

Status: in progress. S0 authorization feasibility and S1's deterministic state
layer are complete; S2 Drive-adapter work is next. See [SYNC-PLAN.md](SYNC-PLAN.md)
for the Google Drive `appDataFolder` design, merge model, account safety, delivery
steps, and acceptance criteria. This track is being taken before Phase 4 without
renumbering the existing roadmap.

- First prove Google browser authorization and private Drive app-data round trips on
  desktop Chrome, Android Chrome, and the installed PWA.
- If the authorization UX passes, add optional per-account synchronization using
  one conflict-resistant state document per device.
- Keep local state authoritative while offline, persist only the current
  short-lived OAuth access token with its exact expiry, and preserve JSON
  export/import permanently.
- Keep shared household state and any backend-based alternative out of the first
  sync release.

Exit gate: seen state converges across supported connected devices after explicit
authorization, local-only/offline use never regresses, and Flixate still requires no
server or database.

## Acceptance criteria for version 1

- A user can browse the defined US+NL streaming union and see the snapshot date.
- Each title shows its release/first-air year and a poster or intentional placeholder.
- Expanding a title shows its TMDB synopsis or an intentional unavailable state
  without loading the complete synopsis dataset up front.
- A title with votes shows its TMDB score and vote count and links to the matching
  TMDB movie or show page.
- Every browser receives automatically refreshed TMDB ratings without a second API,
  command line, passphrase, paid account, or manual import.
- Every show represents the series as a whole; no season or episode records or
  ratings enter the catalog.
- Seen/unseen is one action, persists locally, and can be hidden by default.
- Search and all documented filters compose correctly without a page reload.
- Personal state is absent from the repository, Pages deployment, logs, and URLs.
- API credentials are absent from all client assets and generated data.
- The last valid catalog and user state remain usable after a failed refresh.
- Offline use preserves the searchable/filterable core catalog and seen state;
  unavailable uncached posters or synopsis shards degrade to their normal fallback.
- The app includes all source attribution required by TMDB and JustWatch.
- The catalog artifact and traffic remain comfortably below GitHub Pages' 1 GB
  published-site and 100 GB/month soft bandwidth limits.

## Main risks and mitigations

| Risk | Mitigation |
| --- | --- |
| US+NL discovery misses titles available exclusively elsewhere | Describe coverage as US+NL, measure whether it is useful in practice, and add regions later only if the omissions matter |
| Initial TMDB crawl is too slow or unfriendly to the API | Throttle, back off, partition, cache responses, and checkpoint progress |
| Streamable/not-streamable membership becomes stale | Weekly clean US+NL rebuild and a visible snapshot date |
| Low-vote TMDB scores are noisy or diverge from IMDb | Show vote count, identify fewer than 50 votes as low-confidence, and support a minimum-votes filter |
| Poster CDN requests make scrolling slow or waste bandwidth | Virtualize results, request a modest image size, lazy-load images, and use a bounded runtime cache plus placeholders |
| Synopses make the initial catalog too large | Keep them in deterministic static shards loaded only when title details are expanded |
| Rotten Tomatoes looks like an easy fallback but has no self-service free feed | Use TMDB for version 1; use RT only through approved licensed access and never scrape it |
| Large catalog performs poorly on phones | Worker parsing, validated cache swaps, virtual grid, benchmark before production rollout |
| GitHub Pages is mistaken for a private site | Store no personal data there; document that the URL and assets are public |
| User clears browser storage or changes devices | Versioned JSON export/import first; optional sync later |
| Generated data bloats Git history | Deploy an artifact; do not commit snapshots on every run |
| A scheduled build publishes corrupt/incomplete data | Validate first and deploy atomically only on success |
| GitHub disables the public repository's schedule after 60 inactive days | Show catalog age, support manual dispatch, and document re-enabling the schedule |

## Sources checked

- [TMDB watch-provider endpoint and JustWatch attribution](https://developer.themoviedb.org/reference/movie-watch-providers)
- [TMDB discover TV filters](https://developer.themoviedb.org/reference/discover-tv)
- [TMDB available watch-provider regions](https://developer.themoviedb.org/reference/watch-providers-available-regions)
- [Netflix explanation of country-specific catalog differences](https://help.netflix.com/en/node/125345)
- [TMDB non-commercial use and attribution FAQ](https://developer.themoviedb.org/docs/faq)
- [TMDB API terms, including attribution and six-month cache limit](https://www.themoviedb.org/api-terms-of-use)
- [TMDB rate limiting guidance](https://developer.themoviedb.org/docs/rate-limiting)
- [TMDB image URL and size configuration](https://developer.themoviedb.org/docs/image-basics)
- [TMDB top-rated list and vote-count behavior](https://developer.themoviedb.org/reference/movie-top-rated-list)
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
- [GitHub scheduled-workflow 60-day inactivity behavior](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)
- [GitHub Contents API](https://docs.github.com/en/rest/repos/contents)
- [GitHub OAuth application best practices](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app)
