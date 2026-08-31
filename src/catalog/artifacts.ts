import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CatalogTitle,
  DateRange,
  DiscoveredTitle,
  PhaseZeroManifest,
  Region,
} from "./types.js";

export function toCatalogTitles(titles: Iterable<DiscoveredTitle>): CatalogTitle[] {
  return [...titles]
    .map((title): CatalogTitle => ({
      key: title.key,
      tmdbId: title.tmdbId,
      title: title.title,
      mediaType: title.mediaType === "tv" ? "show" : "movie",
      genreIds: title.genreIds,
      ...(title.rating !== undefined ? { rating: title.rating } : {}),
      ...(title.voteCount !== undefined ? { voteCount: title.voteCount } : {}),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export async function writeArtifacts(options: {
  outputDir: string;
  titles: Iterable<DiscoveredTitle>;
  regions: readonly Region[];
  mode: "sample" | "full";
  range: DateRange;
  topWindowPages: number;
}): Promise<PhaseZeroManifest> {
  const titles = toCatalogTitles(options.titles);
  const json = JSON.stringify({ schemaVersion: 1, titles });
  const compressed = gzipSync(json, { level: 9 });
  const hash = createHash("sha256").update(compressed).digest("hex");
  const createdAt = new Date().toISOString();
  const snapshotId = createdAt.replaceAll(/[-:.TZ]/g, "").slice(0, 14);

  const manifest: PhaseZeroManifest = {
    schemaVersion: 1,
    snapshotId,
    createdAt,
    regions: options.regions,
    coverage: {
      mode: options.mode,
      datedRange: options.range,
      topWindowPages: options.topWindowPages,
      caveat:
        "Date-partitioned discovery covers dated records. Records without release/first-air dates are represented only when present in the popularity window.",
    },
    counts: {
      titles: titles.length,
      movies: titles.filter((title) => title.mediaType === "movie").length,
      shows: titles.filter((title) => title.mediaType === "show").length,
      tmdbRated: titles.filter((title) => title.rating !== undefined).length,
      tmdbUnrated: titles.filter((title) => title.rating === undefined).length,
    },
    catalog: {
      file: "catalog.json.gz",
      sha256: hash,
      compressedBytes: compressed.byteLength,
      uncompressedBytes: Buffer.byteLength(json),
    },
    scores: {
      source: "tmdb",
      lowConfidenceBelowVotes: 50,
    },
    sourceDates: {
      tmdb: createdAt,
    },
  };

  await mkdir(options.outputDir, { recursive: true });
  await writeFile(path.join(options.outputDir, "catalog.json.gz"), compressed);
  await writeFile(
    path.join(options.outputDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

export function validateCatalog(titles: readonly CatalogTitle[]): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const title of titles) {
    if (keys.has(title.key)) errors.push(`Duplicate key: ${title.key}`);
    keys.add(title.key);
    if (!title.title.trim()) errors.push(`Blank title: ${title.key}`);
    if (!title.key.startsWith(title.mediaType === "show" ? "tv:" : "movie:")) {
      errors.push(`Media type/key mismatch: ${title.key}`);
    }
    if (title.rating !== undefined && (title.rating < 0 || title.rating > 10)) {
      errors.push(`Invalid rating: ${title.key}`);
    }
    if (
      title.voteCount !== undefined &&
      (!Number.isInteger(title.voteCount) || title.voteCount < 0)
    ) {
      errors.push(`Invalid vote count: ${title.key}`);
    }
    if (title.rating !== undefined && !(title.voteCount !== undefined && title.voteCount > 0)) {
      errors.push(`Rating without votes: ${title.key}`);
    }
  }
  return errors;
}
