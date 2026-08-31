# Flixate

Flixate is a local-first PWA for finding movies and series worth watching. Phase 1
implements the complete interaction model against a representative US+NL fixture;
Phase 2 will connect the full generated catalog.

## Run locally

```bash
npm install
npm run dev
```

Vite prints the local URL. No TMDB credential is needed for the fixture-backed app.
The ignored `.env` credentials are used only by the catalog-building scripts.

## Verify

```bash
npm run typecheck
npm test
npm run test:e2e
npm run build
```

## Project documents

- [Product and architecture plan](PLAN.md)
- [Plan review](PLAN-REVIEW.md)
- [Phase 0 feasibility report](PHASE-0.md)
- [Phase 1 implementation report](PHASE-1.md)
