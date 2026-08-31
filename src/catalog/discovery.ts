import { mapLimit } from "./concurrency.js";
import { splitDateRange } from "./date-ranges.js";
import { TmdbClient } from "./tmdb-client.js";
import type {
  DateRange,
  DiscoveredTitle,
  DiscoveryStats,
  MediaType,
  Region,
  TmdbDiscoverItem,
  TmdbPage,
} from "./types.js";

const TMDB_PAGE_WINDOW = 500;
const REGION_PRIORITY: Record<Region, number> = { US: 0, NL: 1 };

type DiscoverOptions = {
  client: TmdbClient;
  mediaType: MediaType;
  region: Region;
  range: DateRange;
  topWindowPages: number;
  pageConcurrency: number;
  samplePageLimit?: number;
  onProgress?: (message: string) => void;
};

type DiscoverResult = {
  items: TmdbDiscoverItem[];
  stats: DiscoveryStats;
};

function discoverParams(
  mediaType: MediaType,
  region: Region,
  page: number,
  range?: DateRange,
): Record<string, string | number | boolean | undefined> {
  const datePrefix = mediaType === "movie" ? "primary_release_date" : "first_air_date";
  return {
    watch_region: region,
    with_watch_monetization_types: "flatrate|free|ads",
    language: "en-US",
    include_adult: false,
    sort_by: "popularity.desc",
    page,
    [`${datePrefix}.gte`]: range?.start,
    [`${datePrefix}.lte`]: range?.end,
    include_null_first_air_dates: mediaType === "tv" && range === undefined ? true : undefined,
  };
}

async function page(
  client: TmdbClient,
  mediaType: MediaType,
  region: Region,
  pageNumber: number,
  range?: DateRange,
): Promise<TmdbPage> {
  return client.get<TmdbPage>(
    `/discover/${mediaType}`,
    discoverParams(mediaType, region, pageNumber, range),
  );
}

export async function discoverRegionMedia(options: DiscoverOptions): Promise<DiscoverResult> {
  const stats: DiscoveryStats = {
    advertisedResults: 0,
    advertisedPages: 0,
    datedResultsFetched: 0,
    topWindowResultsFetched: 0,
    partitions: 0,
    saturatedSingleDays: 0,
  };
  const items: TmdbDiscoverItem[] = [];

  const topProbe = await page(options.client, options.mediaType, options.region, 1);
  stats.advertisedResults = topProbe.total_results;
  stats.advertisedPages = topProbe.total_pages;
  const topPages = Math.min(
    topProbe.total_pages,
    TMDB_PAGE_WINDOW,
    options.topWindowPages,
    options.samplePageLimit ?? Number.POSITIVE_INFINITY,
  );
  items.push(...topProbe.results);
  if (topPages > 1) {
    const remaining = Array.from({ length: topPages - 1 }, (_, index) => index + 2);
    const pages = await mapLimit(remaining, options.pageConcurrency, (pageNumber) =>
      page(options.client, options.mediaType, options.region, pageNumber),
    );
    for (const result of pages) items.push(...result.results);
  }
  stats.topWindowResultsFetched = items.length;

  const queue: DateRange[] = [options.range];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const probe = await page(options.client, options.mediaType, options.region, 1, current);
    const split = splitDateRange(current);
    if (probe.total_pages > TMDB_PAGE_WINDOW && split) {
      queue.unshift(split[0], split[1]);
      continue;
    }

    stats.partitions++;
    if (probe.total_pages > TMDB_PAGE_WINDOW) stats.saturatedSingleDays++;
    items.push(...probe.results);
    const fetchablePages = Math.min(
      probe.total_pages,
      TMDB_PAGE_WINDOW,
      options.samplePageLimit ?? Number.POSITIVE_INFINITY,
    );
    if (fetchablePages > 1) {
      const remaining = Array.from({ length: fetchablePages - 1 }, (_, index) => index + 2);
      const pages = await mapLimit(remaining, options.pageConcurrency, (pageNumber) =>
        page(options.client, options.mediaType, options.region, pageNumber, current),
      );
      for (const result of pages) items.push(...result.results);
    }
    stats.datedResultsFetched += Math.min(probe.total_results, fetchablePages * 20);
    options.onProgress?.(
      `${options.region}/${options.mediaType}: ${current.start}..${current.end}, ${probe.total_results} results`,
    );
  }

  return { items, stats };
}

function displayTitle(item: TmdbDiscoverItem, mediaType: MediaType): string {
  return (mediaType === "movie" ? item.title : item.name)?.trim() || `Untitled #${item.id}`;
}

export function mergeDiscoveredItems(
  target: Map<string, DiscoveredTitle>,
  items: readonly TmdbDiscoverItem[],
  mediaType: MediaType,
  region: Region,
): void {
  for (const item of items) {
    if (item.adult) continue;
    const key = `${mediaType}:${item.id}` as const;
    const existing = target.get(key);
    const candidate = {
      title: displayTitle(item, mediaType),
      genreIds: [...item.genre_ids].sort((a, b) => a - b),
      releaseDate:
        (mediaType === "movie" ? item.release_date : item.first_air_date) || null,
      posterPath: item.poster_path || null,
      overview: item.overview?.trim() || null,
      ...(typeof item.vote_count === "number" ? { voteCount: item.vote_count } : {}),
      ...(typeof item.vote_average === "number" && (item.vote_count ?? 0) > 0
        ? { rating: item.vote_average }
        : {}),
    };

    if (!existing) {
      target.set(key, {
        key,
        tmdbId: item.id,
        mediaType,
        ...candidate,
        regions: new Set([region]),
        displaySourceRegion: region,
      });
      continue;
    }

    existing.regions.add(region);
    if (REGION_PRIORITY[region] < REGION_PRIORITY[existing.displaySourceRegion]) {
      Object.assign(existing, candidate, { displaySourceRegion: region });
    } else {
      if (candidate.rating !== undefined) existing.rating = candidate.rating;
      if (candidate.voteCount !== undefined) existing.voteCount = candidate.voteCount;
    }
  }
}
