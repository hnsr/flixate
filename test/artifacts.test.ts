import { describe, expect, it } from "vitest";
import { toCatalogTitles, validateCatalog } from "../src/catalog/artifacts.js";
import type { DiscoveredTitle } from "../src/catalog/types.js";

describe("catalog artifacts", () => {
  it("sorts records deterministically and does not publish qualifying regions", () => {
    const records: DiscoveredTitle[] = [
      {
        key: "tv:2",
        tmdbId: 2,
        mediaType: "tv",
        title: "Series",
        genreIds: [99],
        releaseDate: null,
        posterPath: null,
        overview: null,
        regions: new Set(["NL"]),
        displaySourceRegion: "NL",
      },
      {
        key: "movie:1",
        tmdbId: 1,
        mediaType: "movie",
        title: "Movie",
        genreIds: [18],
        releaseDate: "2020-01-01",
        posterPath: null,
        overview: null,
        regions: new Set(["US", "NL"]),
        displaySourceRegion: "US",
        rating: 7.1,
        voteCount: 500,
      },
    ];

    const compact = toCatalogTitles(records);
    expect(compact.map((record) => record.key)).toEqual(["movie:1", "tv:2"]);
    expect(compact[1]?.mediaType).toBe("show");
    expect(compact[0]).not.toHaveProperty("regions");
    expect(compact[0]).not.toHaveProperty("imdbId");
    expect(compact[0]?.rating).toBe(7.1);
    expect(compact[0]?.voteCount).toBe(500);
    expect(validateCatalog(compact)).toEqual([]);
  });

  it("rejects episode-like key/type mismatches", () => {
    expect(
      validateCatalog([
        {
          key: "tv:5",
          tmdbId: 5,
          title: "Wrong type",
          mediaType: "movie",
          genreIds: [],
        },
      ]),
    ).toContain("Media type/key mismatch: tv:5");
  });

  it("rejects a score without a positive vote count", () => {
    expect(
      validateCatalog([
        {
          key: "movie:5",
          tmdbId: 5,
          title: "Invalid score",
          mediaType: "movie",
          genreIds: [],
          rating: 8,
          voteCount: 0,
        },
      ]),
    ).toContain("Rating without votes: movie:5");
  });
});
