import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { writeProductionSnapshot } from "../src/catalog/production-artifacts.js";
import type { CatalogManifest, DiscoveredTitle } from "../src/catalog/types.js";
import { validateCatalogSnapshot } from "../src/catalog/validate-snapshot.js";
import { parseCatalogManifest } from "../src/data/manifest.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "flixate-catalog-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function records(): DiscoveredTitle[] {
  return [
    {
      key: "tv:2",
      tmdbId: 2,
      mediaType: "tv",
      title: "Future Series",
      genreIds: [18, 10765],
      releaseDate: null,
      posterPath: null,
      overview: null,
      regions: new Set(["NL"]),
      displaySourceRegion: "NL",
      voteCount: 0,
    },
    {
      key: "movie:1",
      tmdbId: 1,
      mediaType: "movie",
      title: "A Film",
      genreIds: [12, 99],
      releaseDate: "2020-03-04",
      posterPath: "/poster.jpg",
      overview: "A concise overview.",
      regions: new Set(["US", "NL"]),
      displaySourceRegion: "US",
      rating: 7.5,
      voteCount: 100,
    },
  ];
}

describe("production catalog artifacts", () => {
  it("writes a content-addressed core, deterministic shards, and a valid manifest", async () => {
    const outputDir = await temporaryDirectory();
    const manifest = await writeProductionSnapshot({
      outputDir,
      titles: records(),
      regions: ["US", "NL"],
      mode: "full",
      range: { start: "1800-01-01", end: "2028-01-01" },
      topWindowPages: 25,
      synopsisShardCount: 2,
      createdAt: "2026-01-02T00:00:00.000Z",
    });

    const savedManifest = parseCatalogManifest(
      JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8")),
    );
    expect(savedManifest).toEqual(manifest);
    await expect(validateCatalogSnapshot(outputDir)).resolves.toEqual(manifest);
    expect(manifest.counts).toMatchObject({
      titles: 2,
      movies: 1,
      shows: 1,
      withReleaseYear: 1,
      withPoster: 1,
      withSynopsis: 1,
    });
    expect(manifest.catalog.file).toMatch(/^catalog-[a-f0-9]{64}\.json\.gz\.bin$/);

    const coreBytes = await readFile(path.join(outputDir, manifest.catalog.file));
    expect(createHash("sha256").update(coreBytes).digest("hex")).toBe(manifest.catalog.sha256);
    const core = JSON.parse(gunzipSync(coreBytes).toString("utf8")) as { titles: unknown[] };
    expect(core.titles).toEqual([
      expect.objectContaining({ key: "movie:1", releaseYear: 2020, posterPath: "/poster.jpg" }),
      expect.objectContaining({ key: "tv:2", voteCount: 0 }),
    ]);

    const movieShard = manifest.synopsisShards.shards[1]!;
    const shard = JSON.parse(
      gunzipSync(await readFile(path.join(outputDir, movieShard.file))).toString("utf8"),
    ) as { synopses: Record<string, string> };
    expect(shard.synopses).toEqual({ "movie:1": "A concise overview." });
    expect(movieShard.entries).toBe(1);

    await writeFile(
      path.join(outputDir, manifest.catalog.file),
      Buffer.concat([coreBytes, Buffer.from([0])]),
    );
    await expect(validateCatalogSnapshot(outputDir)).rejects.toThrow("wrong compressed size");
  });

  it("refuses to publish a newly introduced TMDB genre without an explicit mapping", async () => {
    const outputDir = await temporaryDirectory();
    const invalid = records();
    invalid[0]!.genreIds = [999_999];
    await expect(writeProductionSnapshot({
      outputDir,
      titles: invalid,
      regions: ["US", "NL"],
      mode: "sample",
      range: { start: "2025-01-01", end: "2028-01-01" },
      topWindowPages: 2,
      synopsisShardCount: 2,
    })).rejects.toThrow("Unknown TMDB genre 999999");
  });

  it("rejects a manifest whose shard counts do not add up", () => {
    const manifest = {
      schemaVersion: 1,
      fixture: false,
      snapshotId: "20260102000000",
      createdAt: "2026-01-02T00:00:00.000Z",
      regions: ["US", "NL"],
      coverage: { mode: "full", datedRange: { start: "1800-01-01", end: "2028-01-01" }, topWindowPages: 25, caveat: "Caveat" },
      counts: { titles: 2, movies: 2, shows: 0, tmdbRated: 2, tmdbUnrated: 0, withReleaseYear: 2, withPoster: 2, withSynopsis: 2 },
      catalog: { file: "catalog-a.json.gz.bin", sha256: "a".repeat(64), compressedBytes: 1, uncompressedBytes: 1 },
      synopsisShards: { scheme: "tmdb-id-modulo", count: 1, shards: [{ number: 0, entries: 1, file: "synopsis/0.json.gz.bin", sha256: "b".repeat(64), compressedBytes: 1, uncompressedBytes: 1 }] },
      scores: { source: "tmdb", lowConfidenceBelowVotes: 50 },
      image: { baseUrl: "https://image.tmdb.org/t/p", posterSize: "w342" },
      sourceDates: { tmdb: "2026-01-02T00:00:00.000Z" },
      attributionVersion: 1,
    } satisfies CatalogManifest;
    expect(() => parseCatalogManifest(manifest)).toThrow("synopsis counts do not add up");
  });
});
