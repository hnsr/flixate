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

The `Deploy Flixate` workflow runs:

- after a push to `main`;
- every Monday at 04:23 UTC; and
- on demand from **Actions → Deploy Flixate → Run workflow**.

It installs from the lockfile, builds and validates a fresh US+NL catalog, runs the
unit suite and type checker, builds the app with the `/flixate/` Pages base, and
uploads one immutable Pages artifact. The deploy job depends on the entire build,
so a failed crawl, validation, test, or app build does not replace the currently
published site.

The repository-site URL is <https://hnsr.github.io/flixate/>. A separate 14-day
catalog artifact is retained on the workflow run for inspection. Markdown-only
pushes are ignored so documentation edits do not trigger an unnecessary full
catalog crawl.

GitHub can automatically disable scheduled workflows in a public repository after
60 days without repository activity. If the catalog date stops advancing, open the
repository's **Actions** tab, enable `Deploy Flixate` if necessary, and run it once
manually. Normal pushes and manual runs are unaffected by the weekly cadence.

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
