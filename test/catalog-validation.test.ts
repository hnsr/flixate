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

  it("accepts the optional original language but rejects malformed language codes", () => {
    expect(parseCoreCatalog({ schemaVersion: 1, titles: [{ ...title, originalLanguage: "ko" }] }, 1)
      .titles[0]?.originalLanguage).toBe("ko");
    for (const originalLanguage of [null, 123, "", "xx", "Korean", "KO", "en-US"]) {
      expect(() => parseCoreCatalog({ schemaVersion: 1, titles: [{ ...title, originalLanguage }] }, 1))
        .toThrow("invalid title");
    }
  });

  it("rejects duplicate keys, unexpected counts, and unknown genres", () => {
    expect(() => parseCoreCatalog({ schemaVersion: 1, titles: [title, title] }, 2)).toThrow("duplicate");
    expect(() => parseCoreCatalog({ schemaVersion: 1, titles: [title] }, 2)).toThrow("expected 2");
    expect(() => parseCoreCatalog({ schemaVersion: 1, titles: [{ ...title, genreIds: [123_456] }] }, 1)).toThrow("invalid title");
  });
});
