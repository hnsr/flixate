import { describe, expect, it } from "vitest";
import { parseCoreCatalog } from "../src/data/catalog-validation.js";

describe("catalog payload validation", () => {
  const title = {
    key: "movie:1",
    tmdbId: 1,
    title: "Movie",
    mediaType: "movie",
    genreIds: [18],
    releaseYear: 2020,
    rating: 7,
    voteCount: 10,
  };

  it("accepts a valid core catalog", () => {
    expect(parseCoreCatalog({ schemaVersion: 1, titles: [title] }, 1).titles).toEqual([title]);
  });

  it("rejects duplicate keys, unexpected counts, and unknown genres", () => {
    expect(() => parseCoreCatalog({ schemaVersion: 1, titles: [title, title] }, 2)).toThrow("duplicate");
    expect(() => parseCoreCatalog({ schemaVersion: 1, titles: [title] }, 2)).toThrow("expected 2");
    expect(() => parseCoreCatalog({ schemaVersion: 1, titles: [{ ...title, genreIds: [123_456] }] }, 1)).toThrow("invalid title");
  });
});
