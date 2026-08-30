# Flixate product and architecture plan

Status: revised proposal, researched 2026-08-30

Scope clarification: the user wants to discover titles that are streamable
somewhere, but does not need to know the qualifying service. Version 1 uses the US
streaming catalog as a deliberately simple, broad approximation rather than
crawling every country.
The only required display metadata is title, movie/show type, and genres, alongside
the previously requested quality score and source link. IMDb is the required
version-1 source; Rotten Tomatoes would be an acceptable licensed substitute.
Poster and synopsis are optional. Shows use one overall series record and score;
seasons and episodes are out of scope.

## Quick glossary

- **TMDB (The Movie Database):** an online movie/TV database with a developer API.
  Flixate uses it for titles, movie/show type, genres, optional artwork/synopses,
  IMDb ID matching, and determining whether something is streamable in the US.
- **JustWatch:** a service that tracks where movies and shows are available to
  stream. TMDB exposes availability data supplied by JustWatch, so Flixate can use
  it through TMDB without integrating every streaming service separately. Flixate
  only keeps the answer “streamable in the US,” not the service.
- **IMDb (Internet Movie Database):** the source of the familiar 0–10 user rating.
  Flixate joins IMDb's published rating data to the titles found through TMDB.
- **GitHub Pages:** GitHub's static website hosting. It serves the Flixate web app
  and generated catalog without requiring a conventional server.
- **GitHub Actions:** automated jobs run by GitHub. A scheduled Action periodically
  rebuilds the streaming catalog, imports current IMDb ratings, and publishes the
  new version to GitHub Pages.
- **PWA (Progressive Web App):** a website that can be installed and behave much
  like a normal app, including retaining its last downloaded catalog for offline
  use.

## Recommendation

Build Flixate as a local-first progressive web app (PWA) hosted on GitHub Pages.
Use GitHub Actions to periodically assemble and deploy a static catalog containing
titles that are streamable in the US. Do not retain or show which service caused a
title to qualify.
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
of friends, with these conditions, small frictions, and one explicitly accepted
IMDb licensing/republication risk:

| Component | Cost | Friction/condition |
| --- | --- | --- |
| GitHub Pages | $0 | The repository, deployed app, and generated catalog are public on GitHub Free; use the supplied `github.io` URL rather than buying a domain |
| GitHub Actions | $0 | Standard runners are free for public repositories, but GitHub disables scheduled workflows after 60 days without repository activity; provide a manual Refresh workflow and show catalog age |
| TMDB metadata/API | $0 | Register for a developer API key, remain non-commercial, show required attribution, refresh cached TMDB content within its six-month limit, and respect rate limits |
| JustWatch-derived eligibility | $0 through TMDB | JustWatch attribution is mandatory; no separate Watchmode/JustWatch subscription is planned |
| IMDb ratings | $0 | The scheduled Action downloads, filters, and publishes the relevant scores in the catalog; this is operationally simple but leaves a licensing/republication TODO because Pages files are public |
| Seen state | $0 | Browser-local storage plus manual JSON backup/import; no automatic cross-device sync |
| Rotten Tomatoes | Not used | Official data integration requires an approved licensing arrangement, so it cannot be assumed to fit the budget |

Occasional manual re-enabling/triggering of the catalog workflow is the only
expected operational friction. No IMDb download, import, passphrase, account, or
API key is required by an app user.

## Important reality check

"Every title available on streaming somewhere" cannot be guaranteed literally by
any free data source. Streaming availability changes constantly, catalogs differ
by country, and there is no free authoritative global registry. The US has a broad
catalog, but it does not contain every title streamable elsewhere and must not be
described as worldwide coverage.

For Flixate, define the promise as:

> Every top-level movie and series reported by TMDB/JustWatch as available through
> subscription, ad-supported, or free streaming in the US, as of the catalog
> timestamp.

The US region and service are ingestion details only. Once a title qualifies on one
US service, Flixate keeps the title but discards the availability details. Rent and
purchase offers do not count as streaming by default. Episodes should not be
separate catalog entries; their parent series should be.

TMDB is the practical free source. Its watch-provider data is supplied by
JustWatch and is country-specific. Version 1 queries only `watch_region=US`, which
removes the cost and complexity of a worldwide regional union but knowingly misses
titles available exclusively outside the US. The builder does not need to enumerate
providers, call the per-title watch-provider endpoint, preserve offers, or keep
provider data fresh. JustWatch attribution remains required because its data
decides catalog inclusion. Watchmode's provider and deep-link advantages are no
longer useful for this product.

## Proposed architecture

```text
                    scheduled / manual
                   GitHub Actions run
                           |
          +----------------+----------------+
          |                                 |
   TMDB + JustWatch                  prior Pages snapshot
   US title catalog                    for incremental work
          |                                 |
          +--------------+------------------+
                         |
                 validate + compact
                         |
              GitHub Pages deployment
                         |
                 static Flixate PWA
                         |
          +--------------+----------------+
          |                               |
  catalog including IMDb scores   private user-state map
  cached by the PWA               in localStorage (`seen`)
                                          |
                                 JSON export / import

  The Action downloads IMDb's official ratings TSV, keeps only catalog IDs,
  and joins the score/vote count into the deployed catalog automatically.
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
- the boolean fact that a title is streamable in the US.

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
file is currently small enough for scheduled processing (about 8.6 MB compressed
when checked on 2026-08-30). Its response does not include an
`Access-Control-Allow-Origin` header, so the Pages app cannot fetch it directly;
GitHub Actions can download it during the catalog build.

Use this zero-cost automated flow:

1. The scheduled Action downloads IMDb's official `title.ratings.tsv.gz`.
2. It streams/decompresses the file and retains only IMDb IDs in the current
   Flixate catalog.
3. It joins `rating` and `voteCount` into the matching catalog records.
4. Every scheduled catalog build repeats the import automatically and displays the
   IMDb source date in the UI.

This makes IMDb scores inside the Pages catalog publicly fetchable even if the app
is only intended for one household. That may conflict with IMDb's restriction on
republishing a derived movie-information database. The project owner explicitly
accepts that risk for the personal version-1 prototype in exchange for simplicity.

TODO before promoting or sharing Flixate beyond the intended tiny personal circle:
review the IMDb terms and choose a compliant distribution design. Candidate fixes
include restoring local file import, encrypting the ratings subset, using private
hosting, or obtaining an appropriately licensed data source.

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

Phase 0 must verify streaming TSV processing in Actions, correct joins, output size,
and in-memory performance on desktop and a representative phone. The IMDb
republication concern must remain documented as an open TODO rather than being
mistaken for a resolved compliance question. OMDb's free 1,000-requests-per-day API
remains unsuitable for populating and filtering the catalog at this scale.

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

1. Run US movie and TV discovery with `watch_region=US`, a fixed `language=en-US`,
   and `with_watch_monetization_types=flatrate|free|ads`. The pipe is important:
   TMDB treats it as OR, while a comma means AND.
2. Partition large discovery queries by release/air-date ranges so no result set is
   silently truncated by API pagination limits.
3. Union and deduplicate results by `(mediaType, tmdbId)`.
4. Reuse the IMDb external ID from the previous snapshot for known TMDB IDs. Look
   it up only for new or previously unmatched titles. This lookup remains necessary
   for IMDb scores and links; do not hydrate any other detail fields and do not call
   the per-title watch-provider response. Throttle requests, back off on `429`, and
   make the job restartable.
5. Remove adult titles, seasons, episodes, and other non-top-level types. Retain
   unrated or IMDb-unmatched titles, but label them as unrated rather than dropping
   them.
6. Dictionary-encode genres and generate the compact catalog.
7. Download IMDb's ratings TSV, stream-join the current IMDb IDs, and add each
   matching score/vote count plus the dataset source date.
8. Validate counts, referential integrity, duplicate IDs, catalog size, rating joins,
   and a sample of US discovery membership before deployment.
9. Deploy through the official Pages artifact flow. Do not commit generated catalog
   files to normal Git history.

The bootstrap can be progressive if it is too large for one responsible API run:
publish a manifest with coverage/progress, map IMDb IDs for a bounded batch per
workflow run, and let subsequent runs fetch and extend the current Pages snapshot.

### Ongoing refresh

Use one simple weekly schedule:

- rebuild the US catalog from discovery, adding newly streamable titles and removing
  titles no longer reported in the US;
- carry forward existing IMDb ID mappings and query only new/missing mappings;
- download and join the current IMDb ratings file;
- after every successful run: publish only if validation passes, retaining the last
  good snapshot otherwise.

Also expose the same updater through `workflow_dispatch`. GitHub automatically
disables scheduled workflows in public repositories after 60 days without
repository activity. The app should treat this as expected zero-cost maintenance:
show a stale-catalog warning and link the owner to the manual workflow instructions.
Do not create fake keep-alive commits merely to evade that policy.

The UI must show the catalog timestamp. It does not need availability details or a
provider-specific staleness model; the only relevant age is the US catalog snapshot
date.

Action secrets should contain the TMDB read token. It may not appear in built
JavaScript, Pages files, logs, pull-request workflows, or generated output.
Workflows triggered from untrusted pull requests must never receive it. IMDb's
official dataset download requires no secret.

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
- title, movie, and series counts plus the source region (`US`);
- coverage/bootstrap status;
- catalog URL, hash, and byte size;
- IMDb source date;
- attribution version.

Suggested title record:

- stable key: `movie:{tmdbId}` or `tv:{tmdbId}`;
- TMDB and IMDb IDs;
- display title;
- media type (`movie` or `show`);
- genre IDs;
- IMDb rating and vote count when matched;
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
- catalog eligibility means subscription, free, or ad-supported availability in the
  US;
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
- optional additional watch regions or a worldwide union if US-only coverage proves
  too limiting;
- a licensed Rotten Tomatoes score adapter, only if official access becomes
  available and replacing IMDb remains desirable.

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

- Initialize the repository and basic TypeScript workspace.
- Fetch a representative US TMDB sample and then exercise a complete US discovery
  pass.
- Measure title counts, request count, runtime, and payload size.
- Prove date partitioning for discovery result sets.
- Test Action-side IMDb TSV streaming, filtering, joins, and source-date recording.
- Test the resulting scored catalog and local caching in desktop and mobile-class
  browsers.
- Verify that sampled shows map to their overall IMDb series entries and that no
  season/episode IDs or ratings enter the output.
- Confirm required TMDB, JustWatch, and IMDb attribution; preserve the acknowledged
  IMDb republication question as a visible TODO.
- Test a representative Pages artifact, Cache API update, and in-memory parse.

Exit gate: data comes only from the documented official sources, score filtering
works, the acknowledged IMDb republication risk is recorded, the complete US size
fits comfortably inside Pages/browser limits, and no runtime key leaks.

### Phase 1 — local-first vertical slice (medium)

- Build the compact result view, IMDb link, and seen toggle.
- Add persistent local state, backup export/import, and core filters.
- Use a small US fixture so UI work is fast and deterministic.
- Add unit tests for filtering and state migrations plus an end-to-end seen flow.

Exit gate: the app is already useful on one device and survives reloads, upgrades,
and backup round-trips.

### Phase 2 — US catalog pipeline (medium)

- Implement restartable US discovery, deduplication, IMDb-ID mapping,
  ratings join, compaction, and validation.
- Add progressive bootstrap if one run is too large.
- Add the weekly rebuild and previous-snapshot IMDb-ID reuse.
- Produce coverage and freshness summaries in Action job output and the manifest.

Exit gate: every record returned by the defined US discovery snapshot is
accounted for, updates are repeatable, and a failed run cannot replace good data.

### Phase 3 — GitHub Pages production deployment (small)

- Build and deploy with the official Pages Actions flow.
- Store the TMDB credential in Actions secrets.
- Add PWA caching, update notification, Credits/About, and error recovery.
- Document one-time setup and how to run a manual refresh.
- Document GitHub's 60-day public-repository schedule disablement and how to
  re-enable the workflow.

Exit gate: normal use and active scheduled refresh require no server or database
maintenance and remain within free GitHub limits; recovery from GitHub's inactivity
disablement is documented and takes only a manual workflow re-enable/run.

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

- A user can browse the defined US streaming catalog and see the snapshot date.
- A title shows an IMDb score/vote count when IMDb has one and always links correctly
  when an IMDb ID is known.
- Every browser receives automatically refreshed IMDb ratings without an IMDb API
  key, command line, passphrase, paid account, or manual import.
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
| US-only discovery misses titles available exclusively elsewhere | Describe coverage as US-only, measure whether it is useful in practice, and add regions later only if the omissions matter |
| Initial TMDB crawl is too slow or unfriendly to the API | Throttle, back off, partition, checkpoint, and progressively map IMDb IDs |
| Streamable/not-streamable membership becomes stale | Weekly clean US rebuild and a visible snapshot date |
| The readable IMDb-derived subset on Pages is public and may conflict with IMDb's terms | Accept for the personal prototype, label it as an unresolved TODO, and revisit local import/encryption/private hosting/licensing before wider sharing |
| Rotten Tomatoes looks like an easy fallback but has no self-service free feed | Use IMDb for version 1; use RT only through approved licensed access and never scrape it |
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
