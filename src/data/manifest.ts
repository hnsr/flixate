import type {
  CatalogManifest,
  CompressedArtifact,
  SynopsisShardArtifact,
} from "../catalog/types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArtifact(value: unknown): value is CompressedArtifact {
  return isRecord(value)
    && typeof value.file === "string"
    && !value.file.startsWith("/")
    && !value.file.includes("..")
    && /^[a-f0-9]{64}$/.test(String(value.sha256))
    && Number.isInteger(value.compressedBytes)
    && (value.compressedBytes as number) > 0
    && Number.isInteger(value.uncompressedBytes)
    && (value.uncompressedBytes as number) > 0;
}

function isSynopsisArtifact(value: unknown): value is SynopsisShardArtifact {
  if (!isRecord(value)) return false;
  const number = value.number;
  const entries = value.entries;
  return isArtifact(value)
    && Number.isInteger(number)
    && Number.isInteger(entries)
    && (entries as number) >= 0;
}

export function parseCatalogManifest(value: unknown): CatalogManifest {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.fixture !== false) {
    throw new Error("Catalog manifest has an unsupported schema");
  }
  if (
    typeof value.snapshotId !== "string"
    || !/^\d{14}$/.test(value.snapshotId)
    || typeof value.createdAt !== "string"
    || Number.isNaN(Date.parse(value.createdAt))
  ) {
    throw new Error("Catalog manifest is missing snapshot metadata");
  }
  if (!Array.isArray(value.regions) || value.regions.join(",") !== "US,NL") {
    throw new Error("Catalog manifest does not describe the US+NL union");
  }
  const counts = value.counts;
  const countNames = [
    "titles",
    "movies",
    "shows",
    "tmdbRated",
    "tmdbUnrated",
    "withReleaseYear",
    "withPoster",
    "withSynopsis",
  ];
  if (
    !isRecord(counts)
    || !countNames.every((name) => Number.isInteger(counts[name]) && (counts[name] as number) >= 0)
    || counts.titles !== (counts.movies as number) + (counts.shows as number)
    || counts.titles !== (counts.tmdbRated as number) + (counts.tmdbUnrated as number)
    || [counts.withReleaseYear, counts.withPoster, counts.withSynopsis]
      .some((count) => (count as number) > (counts.titles as number))
  ) {
    throw new Error("Catalog manifest has invalid counts");
  }
  if (!isArtifact(value.catalog)) throw new Error("Catalog manifest has an invalid core artifact");
  if (!isRecord(value.image) || typeof value.image.baseUrl !== "string" || typeof value.image.posterSize !== "string") {
    throw new Error("Catalog manifest has invalid image configuration");
  }
  const synopsis = value.synopsisShards;
  if (
    !isRecord(synopsis)
    || synopsis.scheme !== "tmdb-id-modulo"
    || !Number.isInteger(synopsis.count)
    || (synopsis.count as number) < 1
    || !Array.isArray(synopsis.shards)
    || synopsis.shards.length !== synopsis.count
  ) {
    throw new Error("Catalog manifest has invalid synopsis sharding");
  }
  synopsis.shards.forEach((shard, number) => {
    if (
      !isSynopsisArtifact(shard)
      || shard.number !== number
    ) {
      throw new Error(`Catalog manifest has an invalid synopsis shard at ${number}`);
    }
  });
  const synopsisEntries = synopsis.shards.reduce(
    (total, shard) => total + Number((shard as Record<string, unknown>).entries),
    0,
  );
  if (synopsisEntries !== counts.withSynopsis) {
    throw new Error("Catalog manifest synopsis counts do not add up");
  }
  if (
    !isRecord(value.coverage)
    || (value.coverage.mode !== "sample" && value.coverage.mode !== "full")
    || !isRecord(value.coverage.datedRange)
    || typeof value.coverage.datedRange.start !== "string"
    || typeof value.coverage.datedRange.end !== "string"
    || !Number.isInteger(value.coverage.topWindowPages)
    || typeof value.coverage.caveat !== "string"
    || !isRecord(value.scores)
    || value.scores.source !== "tmdb"
    || !Number.isInteger(value.scores.lowConfidenceBelowVotes)
    || !isRecord(value.sourceDates)
    || typeof value.sourceDates.tmdb !== "string"
    || value.attributionVersion !== 1
  ) {
    throw new Error("Catalog manifest has invalid source metadata");
  }
  return value as unknown as CatalogManifest;
}

export function resolveManifestFiles(manifest: CatalogManifest, manifestUrl: string): CatalogManifest {
  const resolve = (file: string) => new URL(file, manifestUrl).href;
  return {
    ...manifest,
    catalog: { ...manifest.catalog, file: resolve(manifest.catalog.file) },
    synopsisShards: {
      ...manifest.synopsisShards,
      shards: manifest.synopsisShards.shards.map((shard) => ({
        ...shard,
        file: resolve(shard.file),
      })),
    },
  };
}
