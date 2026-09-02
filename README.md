# Flixate

Flixate is a local-first PWA for finding movies and series worth watching. The app
has a representative fixture for everyday development and a production pipeline
for the complete generated US+NL streaming catalog.

Open the live app at <https://hnsr.github.io/flixate/>.

## Run locally

```bash
npm install
npm run dev
```

Vite prints the local URL. No TMDB credential is needed for the fixture-backed app.
The ignored `.env` credentials are used only by the catalog-building scripts.

## Build and open the complete catalog

```bash
npm run catalog
VITE_CATALOG_MANIFEST_URL=data/live/manifest.json npm run dev
```

The first catalog build reads TMDB and can take around 10–15 minutes. Raw responses
are cached under ignored `.cache/phase0/`; generated files are written to ignored
`public/data/live/`. A same-snapshot retry is restartable from that cache. Use
`npm run catalog:sample` for a small pipeline smoke test that writes to
`artifacts/catalog-sample/` without replacing a complete local snapshot.

## Verify

```bash
npm run typecheck
npm test
npm run test:e2e
npm run build
```

## Deploy

GitHub Pages deployment is live through two workflows:

- a push to `main` downloads and validates the latest catalog artifact, then builds
  and deploys only the app;
- a nightly or manually requested catalog refresh crawls TMDB, validates and retains
  a new seven-day catalog artifact, then deploys it with the current app.

Run `npm run catalog:validate` to verify a downloaded or locally generated live
snapshot. See [the Phase 3 deployment report](PHASE-3.md) for setup, format-change,
and recovery instructions.

## Project documents

- [Product and architecture plan](PLAN.md)
- [Plan review](PLAN-REVIEW.md)
- [Phase 0 feasibility report](PHASE-0.md)
- [Phase 1 implementation report](PHASE-1.md)
- [Phase 2 implementation report](PHASE-2.md)
- [Phase 3 deployment report](PHASE-3.md)
- [Cross-device sync plan](SYNC-PLAN.md)
- [Google Drive OAuth feasibility spike](SYNC-SPIKE.md)
- [Sync S1 implementation report](SYNC-S1.md)
- [Sync S2 implementation report](SYNC-S2.md)
- [Sync S3 implementation and rollout report](SYNC-S3.md)
