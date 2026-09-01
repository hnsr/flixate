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

GitHub Pages deployment is live. A successful push to `main`, the weekly schedule,
or a manual workflow run rebuilds the catalog and publishes the complete app. See
[the Phase 3 deployment report](PHASE-3.md) for setup and recovery instructions.

## Project documents

- [Product and architecture plan](PLAN.md)
- [Plan review](PLAN-REVIEW.md)
- [Phase 0 feasibility report](PHASE-0.md)
- [Phase 1 implementation report](PHASE-1.md)
- [Phase 2 implementation report](PHASE-2.md)
- [Phase 3 deployment report](PHASE-3.md)
