import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { GENRE_LABELS } from "../domain/catalog.js";
import { toCatalogTitles, validateCatalog } from "./artifacts.js";
import type {
  CatalogManifest,
  CompressedArtifact,
  DateRange,
  DiscoveredTitle,
  Region,
  SynopsisShardArtifact,
} from "./types.js";

const COVERAGE_CAVEAT =
  "Date-partitioned discovery covers dated records. Records without release/first-air dates are represented only when present in the popularity window.";

type SnapshotOptions = {
  outputDir: string;
  titles: Iterable<DiscoveredTitle>;
  regions: readonly Region[];
  mode: "sample" | "full";
  range: DateRange;
  topWindowPages: number;
  synopsisShardCount: number;
  createdAt?: string;
  maximumCompressedShardBytes?: number;
};

type EncodedArtifact = {
  compressed: Buffer;
  descriptor: Omit<CompressedArtifact, "file">;
};

function encodeJson(value: unknown): EncodedArtifact {
  const json = JSON.stringify(value);
  const compressed = gzipSync(json, { level: 9 });
  return {
    compressed,
    descriptor: {
      sha256: createHash("sha256").update(compressed).digest("hex"),
      compressedBytes: compressed.byteLength,
      uncompressedBytes: Buffer.byteLength(json),
    },
  };
}

function snapshotId(createdAt: string): string {
  return createdAt.replaceAll(/[-:.TZ]/g, "").slice(0, 14);
}

function synopsisShardNumber(key: string, count: number): number {
  return Number(key.slice(key.indexOf(":") + 1)) % count;
}

function validateSourceTitles(titles: readonly DiscoveredTitle[]): string[] {
  const errors: string[] = [];
  for (const title of titles) {
    for (const genreId of title.genreIds) {
      if (!GENRE_LABELS[genreId]) errors.push(`Unknown TMDB genre ${genreId}: ${title.key}`);
    }
  }
  return errors;
}

async function previousArtifactFiles(outputDir: string): Promise<string[]> {
  try {
    const value = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8")) as {
      catalog?: { file?: unknown };
      synopsisShards?: { shards?: Array<{ file?: unknown }> };
    };
    const files = [value.catalog?.file, ...(value.synopsisShards?.shards ?? []).map((shard) => shard.file)];
    return files.filter(
      (file): file is string => typeof file === "string"
        && !path.isAbsolute(file)
        && !file.split(/[\\/]/).includes(".."),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    return [];
  }
}

export async function writeProductionSnapshot(options: SnapshotOptions): Promise<CatalogManifest> {
  if (!Number.isInteger(options.synopsisShardCount) || options.synopsisShardCount < 1) {
    throw new Error("Synopsis shard count must be a positive integer");
  }

  const supersededFiles = await previousArtifactFiles(options.outputDir);
  const sourceTitles = [...options.titles].sort((a, b) => a.key.localeCompare(b.key));
  const titles = toCatalogTitles(sourceTitles);
  const validationErrors = [...validateCatalog(titles), ...validateSourceTitles(sourceTitles)];
  if (validationErrors.length > 0) {
    throw new Error(`Catalog validation failed:\n${validationErrors.slice(0, 20).join("\n")}`);
  }

  const createdAt = options.createdAt ?? new Date().toISOString();
  const id = snapshotId(createdAt);
  const core = encodeJson({ schemaVersion: 1, titles });
  const catalogFile = `catalog-${core.descriptor.sha256}.json.gz.bin`;
  const synopsisMaps = Array.from(
    { length: options.synopsisShardCount },
    () => ({} as Record<string, string>),
  );
  for (const title of sourceTitles) {
    if (!title.overview) continue;
    const shard = synopsisMaps[synopsisShardNumber(title.key, options.synopsisShardCount)];
    if (!shard) throw new Error(`Could not assign synopsis shard for ${title.key}`);
    shard[title.key] = title.overview;
  }

  await mkdir(path.join(options.outputDir, "synopsis"), { recursive: true });
  await writeFile(path.join(options.outputDir, catalogFile), core.compressed);

  const shardDescriptors: SynopsisShardArtifact[] = [];
  for (let number = 0; number < synopsisMaps.length; number++) {
    const synopses = synopsisMaps[number] ?? {};
    const encoded = encodeJson({ schemaVersion: 1, synopses });
    const maximum = options.maximumCompressedShardBytes ?? 400 * 1024;
    if (encoded.compressed.byteLength > maximum) {
      throw new Error(
        `Synopsis shard ${number} is ${encoded.compressed.byteLength} bytes; increase the shard count`,
      );
    }
    const paddedNumber = String(number).padStart(String(options.synopsisShardCount - 1).length, "0");
    const filename = `${paddedNumber}-${encoded.descriptor.sha256}.json.gz.bin`;
    const file = path.posix.join("synopsis", filename);
    await writeFile(path.join(options.outputDir, file), encoded.compressed);
    shardDescriptors.push({
      number,
      file,
      entries: Object.keys(synopses).length,
      ...encoded.descriptor,
    });
  }

  const manifest: CatalogManifest = {
    schemaVersion: 1,
    snapshotId: id,
    createdAt,
    fixture: false,
    regions: options.regions,
    coverage: {
      mode: options.mode,
      datedRange: options.range,
      topWindowPages: options.topWindowPages,
      caveat: COVERAGE_CAVEAT,
    },
    counts: {
      titles: titles.length,
      movies: titles.filter((title) => title.mediaType === "movie").length,
      shows: titles.filter((title) => title.mediaType === "show").length,
      tmdbRated: titles.filter((title) => title.rating !== undefined).length,
      tmdbUnrated: titles.filter((title) => title.rating === undefined).length,
      withReleaseYear: titles.filter((title) => title.releaseYear !== undefined).length,
      withPoster: titles.filter((title) => title.posterPath !== undefined).length,
      withSynopsis: sourceTitles.filter((title) => title.overview !== null).length,
    },
    catalog: { file: catalogFile, ...core.descriptor },
    synopsisShards: {
      scheme: "tmdb-id-modulo",
      count: options.synopsisShardCount,
      shards: shardDescriptors,
    },
    scores: { source: "tmdb", lowConfidenceBelowVotes: 50 },
    image: { baseUrl: "https://image.tmdb.org/t/p", posterSize: "w342" },
    sourceDates: { tmdb: createdAt },
    attributionVersion: 1,
  };

  const manifestPath = path.join(options.outputDir, "manifest.json");
  const pendingManifestPath = `${manifestPath}.pending`;
  await writeFile(pendingManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(pendingManifestPath, manifestPath);
  const currentFiles = new Set([
    manifest.catalog.file,
    ...manifest.synopsisShards.shards.map((shard) => shard.file),
  ]);
  await Promise.all(supersededFiles.filter((file) => !currentFiles.has(file)).map(async (file) => {
    try {
      await unlink(path.join(options.outputDir, file));
    } catch {
      // Old content is harmless; a cleanup problem must not invalidate the new snapshot.
    }
  }));
  return manifest;
}
