import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { CatalogManifest } from "../../src/catalog/types.js";
import type { CatalogDocument } from "../../src/domain/catalog.js";

export function synopsisSnapshot(label: string, count = 1) {
  const bodies = Array.from({ length: count }, (_, number) => gzipSync(JSON.stringify({
    schemaVersion: 1,
    synopses: number === 1 % count ? { "movie:1": `${label} synopsis` } : {},
  })));
  const files = bodies.map((body, number) => ({ number, entries: number === 1 % count ? 1 : 0,
    file: `synopsis/${label}-${number}.json.gz.bin`, sha256: createHash("sha256").update(body).digest("hex"),
    compressedBytes: body.length, uncompressedBytes: 100 }));
  const manifest: CatalogManifest = {
    schemaVersion: 1, fixture: false, snapshotId: "20260912000000", createdAt: "2026-09-12T00:00:00.000Z",
    regions: ["US", "NL"], image: { baseUrl: "https://image.tmdb.org/t/p", posterSize: "w342" },
    counts: { titles: 1, movies: 1, shows: 0, tmdbRated: 1, tmdbUnrated: 0,
      withReleaseYear: 1, withPoster: 0, withSynopsis: 1 },
    catalog: { file: "core.json.gz.bin", sha256: "a".repeat(64), compressedBytes: 1, uncompressedBytes: 1 },
    synopsisShards: { scheme: "tmdb-id-modulo", count, shards: files },
    scores: { source: "tmdb", lowConfidenceBelowVotes: 50 }, sourceDates: { tmdb: "2026-09-12" },
    coverage: { mode: "sample", datedRange: { start: "1800-01-01", end: "2027-01-01" },
      topWindowPages: 1, caveat: "Test" }, attributionVersion: 1,
  };
  const catalog: CatalogDocument = {
    schemaVersion: 1, fixture: false, createdAt: manifest.createdAt, regions: ["US", "NL"],
    manifestUrl: "http://localhost/data/live/manifest.json", image: manifest.image,
    synopsisShards: { format: "gzip-json", count,
      files: files.map(file => ({ ...file, file: `http://localhost/data/live/${file.file}` })) },
    titles: [{ key: "movie:1", tmdbId: 1, title: "Recovery Film", mediaType: "movie",
      genreIds: [18], rating: 8, voteCount: 100, releaseYear: 2020 }],
  };
  return { manifest, catalog, bodies };
}
