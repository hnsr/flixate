# Phase 3 deployment report

Completed: 2026-09-01

## Outcome

**Complete.** Flixate is live at <https://hnsr.github.io/flixate/> using the official
GitHub Pages build/deploy workflow and explicit PWA update notifications. The first
cold GitHub-hosted catalog build, deployment, and real-browser smoke test all
passed. No server, database, or paid service is needed.

## One-time GitHub setup

The repository has these required settings. They only need to be repeated if the
site is moved to another repository:

1. Open the repository's **Settings → Secrets and variables → Actions**, choose
   **New repository secret**, name it `TMDB_API_TOKEN`, and copy only the token value
   from the local `.env` file. The workflow does not use `TMDB_API_KEY`.
2. Open **Settings → Pages** and set **Build and deployment → Source** to
   **GitHub Actions**.

The token is available only to the server-side catalog build. Vite does not receive
it, and it is not written to the Pages artifact. The local `.env`, raw TMDB cache,
and generated live catalog remain ignored by Git.

## Deployment and refresh behavior

Since 2026-09-02, deployment is split into two workflows:

- **Deploy Flixate app** runs after a non-documentation push to `main` or on manual
  request. It downloads the catalog artifact from the latest successful refresh,
  validates every declared file, runs tests and type checking, and deploys the PWA.
  It does not contact TMDB or regenerate the catalog.
- **Refresh Flixate catalog** runs nightly at 04:23 UTC or on manual request. It
  rebuilds the US+NL catalog, validates it, retains the snapshot as a seven-day
  artifact, runs the app checks, and deploys the fresh catalog with the current app.

The app workflow receives `actions:read` only so the official artifact downloader
can read a specific prior run. It finds the latest successful `catalog.yml` run and
requests the matching immutable `flixate-catalog-{run_id}` artifact. The validator
checks the manifest schema, file paths, compressed and uncompressed sizes, SHA-256
digests, core record counts, and every synopsis shard before Pages is built. GitHub
documents that cross-run artifact downloads require a run ID and a token with
Actions read permission.

The repository-site URL is <https://hnsr.github.io/flixate/>. Markdown-only pushes
remain ignored. If a code change introduces an incompatible catalog format, the
fast deployment fails without replacing the live site; manually run **Refresh
Flixate catalog** to generate and deploy the new format. The same recovery applies
if nightly refreshes have been disabled long enough for every seven-day catalog
artifact to expire.

GitHub can automatically disable scheduled workflows in a public repository after
60 days without repository activity. If the catalog date stops advancing, open the
repository's **Actions** tab, enable **Refresh Flixate catalog** if necessary, and
run it once manually. Normal app pushes remain independent from that schedule.

Reference: [Downloading workflow artifacts](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts)

### Split-workflow verification

The first fast deployment passed on 2026-09-02 in
[workflow run 33678297769](https://github.com/hnsr/flixate/actions/runs/33678297769).
It found, downloaded, and validated the prior 171,685-title catalog artifact; ran
the full unit suite, type checker, and production build; and uploaded the Pages
artifact in 26 seconds. Pages deployment took another 9 seconds. No catalog refresh
workflow was triggered by the push.

## PWA behavior

The service worker now uses prompt-based updates. It checks hourly while Flixate is
open and offers a deliberate reload when a newer app shell is ready, avoiding an
unexpected mid-session refresh. A one-time message confirms when the app shell and
previously accessed catalog data are available offline.

The searchable core is cached, while synopsis shards and posters remain bounded,
on-demand caches. A failed catalog refresh can still fall back to the prior locally
validated, content-addressed snapshot. The warning includes a link to the manual
workflow for recovery.

## First-deployment verification

The first production run completed successfully in 11 minutes 19 seconds:

- 171,374 titles in the 1 September 2026 US+NL snapshot;
- 8,429,036-byte compressed core;
- 128 synopsis shards totaling 20,877,239 compressed bytes, with a 174,745-byte
  largest shard;
- 27 unit/component tests plus type checking passed in GitHub Actions; and
- the 29,464,115-byte Pages artifact deployed successfully.

The live Chrome smoke test confirmed:

- the app opens at the expected Pages URL without broken `/flixate/` asset paths;
- the manifest and compressed core load, search/filtering work, and a synopsis shard
  opens;
- posters load from TMDB's image CDN and the Credits section is visible;
- installing/reloading the PWA keeps the service worker scoped to `/flixate/`;
- offline reload preserves the shell, previously loaded core, and seen state while
  uncached posters/synopses degrade normally.

The update prompt's refresh and dismissal paths are covered by the component suite;
the deployed worker uses the verified prompt registration mode and hourly update
check.
