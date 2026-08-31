import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { gunzipSync } from "node:zlib";
import { toCatalogTitles, validateCatalog, writeArtifacts } from "../src/catalog/artifacts.js";
import { formatDate } from "../src/catalog/date-ranges.js";
import { discoverRegionMedia, mergeDiscoveredItems } from "../src/catalog/discovery.js";
import { credentialsFromEnvironment, TmdbClient } from "../src/catalog/tmdb-client.js";
import { MEDIA_TYPES, REGIONS, type DateRange, type DiscoveredTitle } from "../src/catalog/types.js";

type CliOptions = {
  sample: boolean;
  topWindowPages: number;
  requestsPerSecond: number;
};

function numberOption(args: string[], name: string, fallback: number): number {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name} value`);
  return value;
}

function parseOptions(args: string[]): CliOptions {
  const sample = args.includes("--sample");
  return {
    sample,
    topWindowPages: numberOption(args, "--top-window-pages", sample ? 2 : 25),
    requestsPerSecond: numberOption(args, "--requests-per-second", 18),
  };
}

function discoveryRange(sample: boolean): DateRange {
  const end = new Date();
  end.setUTCFullYear(end.getUTCFullYear() + 2);
  if (sample) {
    const start = new Date();
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    return { start: formatDate(start), end: formatDate(end) };
  }
  return { start: "1800-01-01", end: formatDate(end) };
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const started = performance.now();
  const range = discoveryRange(options.sample);
  const cacheScope = new Date().toISOString().slice(0, 10);
  const client = new TmdbClient(
    credentialsFromEnvironment(),
    path.resolve(".cache", "phase0", cacheScope),
    options.requestsPerSecond,
  );
  const titles = new Map<string, DiscoveredTitle>();
  const discoveryReport: Record<string, unknown> = {};

  console.log(`Phase 0 ${options.sample ? "sample" : "full"} discovery: US + NL`);
  console.log(`Dated range: ${range.start} through ${range.end}`);

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
      mergeDiscoveredItems(titles, result.items, mediaType, region);
      discoveryReport[key] = result.stats;
      console.log(`${key}: advertised=${result.stats.advertisedResults}, fetched=${result.items.length}`);
    }
  }

  const titleList = [...titles.values()];
  const bothRegions = titleList.filter((title) => title.regions.size === 2).length;
  console.log(`Union: ${titleList.length} titles (${bothRegions} present in both regions)`);

  const outputDir = path.resolve("artifacts", "phase0");
  const manifest = await writeArtifacts({
    outputDir,
    titles: titleList,
    regions: REGIONS,
    mode: options.sample ? "sample" : "full",
    range,
    topWindowPages: options.topWindowPages,
  });
  const compactTitles = toCatalogTitles(titleList);
  const errors = validateCatalog(compactTitles);
  if (errors.length > 0) throw new Error(`Catalog validation failed:\n${errors.slice(0, 20).join("\n")}`);

  const queryDurations: number[] = [];
  const parseDurations: number[] = [];
  const queries = [
    () => compactTitles.filter((title) => title.mediaType === "movie" && (title.rating ?? -1) >= 7),
    () => compactTitles.filter((title) => title.mediaType === "show" && title.genreIds.length > 0),
    () => compactTitles.filter((title) => title.title.toLocaleLowerCase("en-US").includes("the")),
  ];
  for (let iteration = 0; iteration < 30; iteration++) {
    for (const query of queries) {
      const before = performance.now();
      query();
      queryDurations.push(performance.now() - before);
    }
  }
  const compressedCatalog = await readFile(path.join(outputDir, manifest.catalog.file));
  for (let iteration = 0; iteration < 5; iteration++) {
    const before = performance.now();
    JSON.parse(gunzipSync(compressedCatalog).toString("utf8"));
    parseDurations.push(performance.now() - before);
  }

  const report = {
    mode: options.sample ? "sample" : "full",
    generatedAt: new Date().toISOString(),
    elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(2)),
    range,
    discovery: discoveryReport,
    union: {
      titles: titleList.length,
      bothRegions,
      onlyUS: titleList.filter((title) => title.regions.has("US") && !title.regions.has("NL")).length,
      onlyNL: titleList.filter((title) => title.regions.has("NL") && !title.regions.has("US")).length,
      withoutDateCaptured: titleList.filter((title) => title.releaseDate === null).length,
    },
    ratings: {
      source: "tmdb",
      rated: titleList.filter((title) => title.rating !== undefined).length,
      unrated: titleList.filter((title) => title.rating === undefined).length,
      atLeast50Votes: titleList.filter((title) => (title.voteCount ?? 0) >= 50).length,
    },
    requests: client.stats,
    artifact: manifest.catalog,
    inMemoryQueryMs: {
      median: Number(percentile(queryDurations, 0.5).toFixed(3)),
      p95: Number(percentile(queryDurations, 0.95).toFixed(3)),
    },
    decompressAndParseMs: {
      median: Number(percentile(parseDurations, 0.5).toFixed(3)),
      maximum: Number(Math.max(...parseDurations).toFixed(3)),
    },
    processMemoryBytes: process.memoryUsage(),
    validationErrors: errors,
  };
  await writeFile(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Compressed catalog: ${manifest.catalog.compressedBytes} bytes`);
  console.log(`Query p95: ${report.inMemoryQueryMs.p95} ms`);
  console.log(`Decompress + parse median: ${report.decompressAndParseMs.median} ms`);
  console.log(`Report: ${path.join(outputDir, "report.json")}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
