# Phase 3 deployment report

Prepared: 2026-09-01

## Outcome

**Implementation ready; first deployment pending.** Flixate now has an official
GitHub Pages build/deploy workflow and explicit PWA update notifications. The
remaining work is a one-time repository setup followed by a smoke test at the live
URL. No server, database, or paid service is needed.

## One-time GitHub setup

Do these two steps before pushing the Phase 3 changes:

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

The expected repository-site URL is <https://hnsr.github.io/flixate/>. A separate
14-day catalog artifact is retained on the workflow run for inspection.

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

After the first successful workflow run, verify the following before marking Phase
3 complete:

- the app opens at the expected Pages URL without broken `/flixate/` asset paths;
- the manifest and compressed core load, search/filtering work, and a synopsis shard
  opens;
- posters load from TMDB's image CDN and the Credits section is visible;
- installing/reloading the PWA keeps the service worker scoped to `/flixate/`;
- a second deployment produces the update prompt and reloads cleanly; and
- offline reload preserves the shell, previously loaded core, and seen state while
  uncached posters/synopses degrade normally.

Until this live smoke test is complete, Phase 3 is prepared rather than completed.
