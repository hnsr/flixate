import { describe, expect, it, vi } from "vitest";
import { discoverRegionMedia, mergeDiscoveredItems } from "../src/catalog/discovery.js";
import { TmdbClient } from "../src/catalog/tmdb-client.js";
import type { DiscoveredTitle, TmdbPage } from "../src/catalog/types.js";

function result(id: number, title: string): TmdbPage {
  return {
    page: 1,
    total_pages: 1,
    total_results: 1,
    results: [{ id, title, genre_ids: [99], release_date: "2024-01-01" }],
  };
}

describe("TMDB discovery", () => {
  it("recursively splits result sets outside TMDB's page window", async () => {
    const client = new TmdbClient({ token: "test" }, "/unused");
    vi.spyOn(client, "get").mockImplementation(async (_endpoint, params) => {
      if (params["primary_release_date.gte"] === undefined) {
        return {
          page: 1,
          total_pages: 600,
          total_results: 12_000,
          results: [],
        } as never;
      }
      if (
        params["primary_release_date.gte"] === "2024-01-01" &&
        params["primary_release_date.lte"] === "2024-01-02"
      ) {
        return {
          page: 1,
          total_pages: 600,
          total_results: 12_000,
          results: [],
        } as never;
      }
      return result(
        params["primary_release_date.gte"] === "2024-01-01" ? 1 : 2,
        "Partitioned",
      ) as never;
    });

    const discovered = await discoverRegionMedia({
      client,
      mediaType: "movie",
      region: "US",
      range: { start: "2024-01-01", end: "2024-01-02" },
      topWindowPages: 1,
      pageConcurrency: 2,
    });

    expect(discovered.items.map((item) => item.id)).toEqual([1, 2]);
    expect(discovered.stats.partitions).toBe(2);
    expect(discovered.stats.saturatedSingleDays).toBe(0);
  });

  it("uses a deterministic US display preference while retaining both regions", () => {
    const titles = new Map<string, DiscoveredTitle>();
    mergeDiscoveredItems(
      titles,
      [{ id: 10, name: "Nederlandse titel", genre_ids: [18], vote_average: 7.2, vote_count: 80 }],
      "tv",
      "NL",
    );
    mergeDiscoveredItems(
      titles,
      [{ id: 10, name: "English title", genre_ids: [18, 99], vote_average: 7.3, vote_count: 81 }],
      "tv",
      "US",
    );

    const title = titles.get("tv:10");
    expect(title?.title).toBe("English title");
    expect(title?.genreIds).toEqual([18, 99]);
    expect(title?.regions).toEqual(new Set(["NL", "US"]));
    expect(title?.mediaType).toBe("tv");
    expect(title?.rating).toBe(7.3);
    expect(title?.voteCount).toBe(81);
  });

  it("keeps a zero-vote title unrated", () => {
    const titles = new Map<string, DiscoveredTitle>();
    mergeDiscoveredItems(
      titles,
      [{ id: 11, title: "No votes", genre_ids: [], vote_average: 0, vote_count: 0 }],
      "movie",
      "US",
    );

    expect(titles.get("movie:11")?.rating).toBeUndefined();
    expect(titles.get("movie:11")?.voteCount).toBe(0);
  });
});
