import { readdirSync } from "node:fs";
import { appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { formatDate } from "../src/catalog/date-ranges.js";
import { discoverRegionMedia, mergeDiscoveredItems } from "../src/catalog/discovery.js";
import { writeProductionSnapshot } from "../src/catalog/production-artifacts.js";
import { credentialsFromEnvironment, TmdbClient } from "../src/catalog/tmdb-client.js";
import { MEDIA_TYPES, REGIONS, type DateRange, type DiscoveredTitle } from "../src/catalog/types.js";

type CliOptions = {
  sample: boolean;
  snapshotDate: string;
  outputDir: string;
  topWindowPages: number;
  requestsPerSecond: number;
  synopsisShards: number;
};

function stringOption(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1]?.trim();
  if (!value) throw new Error(`Missing ${name} value`);
  return value;
}

function numberOption(args: string[], name: string, fallback: number): number {
  const value = Number(stringOption(args, name, String(fallback)));
  if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid ${name} value`);
  return value;
}

function isoDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`Invalid snapshot date: ${value}`);
  }
  return value;
}

function parseOptions(args: string[]): CliOptions {
  const sample = args.includes("--sample");
  const today = new Date().toISOString().slice(0, 10);
  let defaultSnapshotDate = today;
  if (args.includes("--resume-cache")) {
    try {
      defaultSnapshotDate = readdirSync(path.resolve(".cache", "phase0"))
        .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry))
        .sort()
        .at(-1) ?? today;
    } catch {
      // A fresh runner has no response cache yet and should use today's date.
    }
  }
  return {
    sample,
    snapshotDate: isoDate(stringOption(args, "--snapshot-date", defaultSnapshotDate)),
    outputDir: path.resolve(stringOption(args, "--output-dir", "public/data/live")),
    topWindowPages: numberOption(args, "--top-window-pages", sample ? 2 : 25),
    requestsPerSecond: numberOption(args, "--requests-per-second", 18),
    synopsisShards: numberOption(args, "--synopsis-shards", sample ? 4 : 128),
  };
}

function discoveryRange(snapshotDate: string, sample: boolean): DateRange {
  const anchor = new Date(`${snapshotDate}T00:00:00Z`);
  const end = new Date(anchor);
  end.setUTCFullYear(end.getUTCFullYear() + 2);
  if (!sample) return { start: "1800-01-01", end: formatDate(end) };
  const start = new Date(anchor);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  return { start: formatDate(start), end: formatDate(end) };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const started = performance.now();
  const range = discoveryRange(options.snapshotDate, options.sample);
  const client = new TmdbClient(
    credentialsFromEnvironment(),
    path.resolve(".cache", "phase0", options.snapshotDate),
    options.requestsPerSecond,
  );
  const titles = new Map<string, DiscoveredTitle>();
  const discovery: Record<string, unknown> = {};

  console.log(`Catalog ${options.sample ? "sample" : "full"} discovery: US + NL`);
  console.log(`Snapshot date: ${options.snapshotDate}; dated range: ${range.start} through ${range.end}`);

  for (const region of REGIONS) {
    for (const mediaType of MEDIA_TYPES) {
      const key = `${region}/${mediaType}`;
      const result = await discoverRegionMedia({
        client,
        mediaType,
        region,
        range,
        topWindowPages: options.topWindowPages,
        pageConcurrency: 8,
        samplePageLimit: options.sample ? 2 : undefined,
        onProgress: options.sample ? undefined : (message) => console.log(message),
      });
      if (result.stats.saturatedSingleDays > 0) {
        throw new Error(`${key} contains ${result.stats.saturatedSingleDays} saturated single-day partitions`);
      }
      mergeDiscoveredItems(titles, result.items, mediaType, region);
      discovery[key] = result.stats;
      console.log(`${key}: advertised=${result.stats.advertisedResults}, fetched=${result.items.length}`);
    }
  }

  const titleList = [...titles.values()];
  const createdAt = `${options.snapshotDate}T00:00:00.000Z`;
  const manifest = await writeProductionSnapshot({
    outputDir: options.outputDir,
    titles: titleList,
    regions: REGIONS,
    mode: options.sample ? "sample" : "full",
    range,
    topWindowPages: options.topWindowPages,
    synopsisShardCount: options.synopsisShards,
    createdAt,
  });
  const report = {
    snapshotId: manifest.snapshotId,
    generatedAt: new Date().toISOString(),
    elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(2)),
    discovery,
    counts: manifest.counts,
    requests: client.stats,
    catalog: manifest.catalog,
    synopsis: {
      shards: manifest.synopsisShards.count,
      totalCompressedBytes: manifest.synopsisShards.shards.reduce(
        (total, shard) => total + shard.compressedBytes,
        0,
      ),
      largestCompressedBytes: Math.max(
        ...manifest.synopsisShards.shards.map((shard) => shard.compressedBytes),
      ),
    },
  };
  await writeFile(path.join(options.outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, [
      "## Flixate catalog snapshot",
      "",
      `- Snapshot: \`${manifest.snapshotId}\``,
      `- Titles: ${manifest.counts.titles.toLocaleString("en-US")} (${manifest.counts.movies.toLocaleString("en-US")} movies, ${manifest.counts.shows.toLocaleString("en-US")} shows)`,
      `- TMDB-rated: ${manifest.counts.tmdbRated.toLocaleString("en-US")}`,
      `- Core: ${(manifest.catalog.compressedBytes / 1_000_000).toFixed(2)} MB compressed`,
      `- Synopses: ${(report.synopsis.totalCompressedBytes / 1_000_000).toFixed(2)} MB across ${report.synopsis.shards} shards; largest ${(report.synopsis.largestCompressedBytes / 1_000).toFixed(1)} kB`,
      `- TMDB requests: ${client.stats.networkRequests.toLocaleString("en-US")} network, ${client.stats.cacheHits.toLocaleString("en-US")} cached`,
      "",
    ].join("\n"));
  }

  console.log(`Union: ${manifest.counts.titles} titles`);
  console.log(`Core: ${manifest.catalog.compressedBytes} bytes`);
  console.log(
    `Synopsis: ${report.synopsis.totalCompressedBytes} bytes across ${report.synopsis.shards} shards (largest ${report.synopsis.largestCompressedBytes})`,
  );
  console.log(`Manifest: ${path.join(options.outputDir, "manifest.json")}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
