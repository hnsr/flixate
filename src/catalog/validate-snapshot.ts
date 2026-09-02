import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { parseCoreCatalog } from "../data/catalog-validation.js";
import { parseCatalogManifest } from "../data/manifest.js";
import type { CatalogManifest, CompressedArtifact } from "./types.js";

type SynopsisPayload = {
  schemaVersion: 1;
  synopses: Record<string, string>;
};

function artifactPath(root: string, file: string): string {
  const resolved = path.resolve(root, file);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Catalog artifact escapes the snapshot directory: ${file}`);
  }
  return resolved;
}

async function decodeArtifact(
  root: string,
  artifact: CompressedArtifact,
): Promise<unknown> {
  const compressed = await readFile(artifactPath(root, artifact.file));
  if (compressed.byteLength !== artifact.compressedBytes) {
    throw new Error(`Catalog artifact has the wrong compressed size: ${artifact.file}`);
  }
  const hash = createHash("sha256").update(compressed).digest("hex");
  if (hash !== artifact.sha256) {
    throw new Error(`Catalog artifact failed its SHA-256 check: ${artifact.file}`);
  }
  const uncompressed = gunzipSync(compressed);
  if (uncompressed.byteLength !== artifact.uncompressedBytes) {
    throw new Error(`Catalog artifact has the wrong uncompressed size: ${artifact.file}`);
  }
  return JSON.parse(uncompressed.toString("utf8")) as unknown;
}

function parseSynopsisPayload(
  value: unknown,
  shardNumber: number,
  shardCount: number,
  expectedEntries: number,
): SynopsisPayload {
  if (
    !value
    || typeof value !== "object"
    || (value as Partial<SynopsisPayload>).schemaVersion !== 1
    || !(value as Partial<SynopsisPayload>).synopses
    || typeof (value as Partial<SynopsisPayload>).synopses !== "object"
  ) {
    throw new Error(`Synopsis shard ${shardNumber} has an unsupported schema`);
  }
  const payload = value as SynopsisPayload;
  const entries = Object.entries(payload.synopses);
  if (entries.length !== expectedEntries) {
    throw new Error(`Synopsis shard ${shardNumber} has the wrong entry count`);
  }
  for (const [key, synopsis] of entries) {
    const match = /^(movie|tv):(\d+)$/.exec(key);
    if (!match || typeof synopsis !== "string" || Number(match[2]) % shardCount !== shardNumber) {
      throw new Error(`Synopsis shard ${shardNumber} contains an invalid record`);
    }
  }
  return payload;
}

export async function validateCatalogSnapshot(directory: string): Promise<CatalogManifest> {
  const root = path.resolve(directory);
  const manifest = parseCatalogManifest(
    JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")),
  );
  const core = parseCoreCatalog(
    await decodeArtifact(root, manifest.catalog),
    manifest.counts.titles,
  );
  const measuredCounts = {
    movies: core.titles.filter((title) => title.mediaType === "movie").length,
    shows: core.titles.filter((title) => title.mediaType === "show").length,
    tmdbRated: core.titles.filter((title) => title.rating !== undefined).length,
    tmdbUnrated: core.titles.filter((title) => title.rating === undefined).length,
    withReleaseYear: core.titles.filter((title) => title.releaseYear !== undefined).length,
    withPoster: core.titles.filter((title) => title.posterPath !== undefined).length,
  };
  for (const [name, measured] of Object.entries(measuredCounts)) {
    if (measured !== manifest.counts[name as keyof typeof measuredCounts]) {
      throw new Error(`Catalog core does not match manifest count: ${name}`);
    }
  }

  for (const shard of manifest.synopsisShards.shards) {
    parseSynopsisPayload(
      await decodeArtifact(root, shard),
      shard.number,
      manifest.synopsisShards.count,
      shard.entries,
    );
  }
  return manifest;
}
