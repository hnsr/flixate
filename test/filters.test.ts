import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, type CoreTitle, type TitleKey } from "../src/domain/catalog.js";
import { filterAndSortTitles } from "../src/domain/filters.js";

const titles: CoreTitle[] = [
  { key: "movie:1", tmdbId: 1, title: "Documented", releaseYear: 2020, mediaType: "movie", genreIds: [99], rating: 8.1, voteCount: 500 },
  { key: "tv:2", tmdbId: 2, title: "Action Show", releaseYear: 2024, mediaType: "show", genreIds: [10759, 18], rating: 7.5, voteCount: 25 },
  { key: "movie:3", tmdbId: 3, title: "Unrated", releaseYear: 2023, mediaType: "movie", genreIds: [18], voteCount: 0 },
  { key: "movie:4", tmdbId: 4, title: "Action Drama", releaseYear: 2019, mediaType: "movie", genreIds: [28, 18], rating: 6.8, voteCount: 2_000 },
];

describe("catalog filters", () => {
  it("hides seen titles by default and sorts unrated records last", () => {
    const result = filterAndSortTitles(titles, DEFAULT_FILTERS, new Set<TitleKey>(["movie:1"]));
    expect(result.map((title) => title.key)).toEqual(["tv:2", "movie:4", "movie:3"]);
  });

  it("excludes unrated records when a numeric score threshold is active", () => {
    const result = filterAndSortTitles(
      titles,
      { ...DEFAULT_FILTERS, minimumRating: 7 },
      new Set(),
    );
    expect(result.map((title) => title.key)).toEqual(["movie:1", "tv:2"]);
  });

  it("maps movie and TV action genres into one canonical filter", () => {
    const result = filterAndSortTitles(
      titles,
      { ...DEFAULT_FILTERS, genres: ["Action"], sort: "title" },
      new Set(),
    );
    expect(result.map((title) => title.title)).toEqual(["Action Drama", "Action Show"]);
  });

  it("composes all-genre, type, vote, and seen filters", () => {
    const result = filterAndSortTitles(
      titles,
      {
        ...DEFAULT_FILTERS,
        mediaType: "movie",
        seen: "all",
        minimumVotes: 100,
        genres: ["Action", "Drama"],
        genreMode: "all",
      },
      new Set<TitleKey>(["movie:4"]),
    );
    expect(result.map((title) => title.key)).toEqual(["movie:4"]);
  });
});
