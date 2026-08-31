import {
  genresForTitle,
  type CoreTitle,
  type FilterSettings,
  type TitleKey,
} from "./catalog.js";

function compareNullableDescending(left: number | undefined, right: number | undefined): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return right - left;
}

export function filterAndSortTitles(
  titles: readonly CoreTitle[],
  settings: FilterSettings,
  seenKeys: ReadonlySet<TitleKey>,
): CoreTitle[] {
  const query = settings.query.trim().toLocaleLowerCase("en-US");
  const hasRatingFilter = settings.minimumRating !== null || settings.maximumRating !== null;

  const filtered = titles.filter((title) => {
    if (query && !title.title.toLocaleLowerCase("en-US").includes(query)) return false;
    if (settings.mediaType !== "all" && title.mediaType !== settings.mediaType) return false;

    const isSeen = seenKeys.has(title.key);
    if (settings.seen === "hide" && isSeen) return false;
    if (settings.seen === "only" && !isSeen) return false;

    if (hasRatingFilter && title.rating === undefined) return false;
    if (settings.minimumRating !== null && (title.rating ?? -1) < settings.minimumRating) {
      return false;
    }
    if (settings.maximumRating !== null && (title.rating ?? 11) > settings.maximumRating) {
      return false;
    }
    if (title.voteCount < settings.minimumVotes) return false;

    if (settings.genres.length > 0) {
      const genres = new Set(genresForTitle(title));
      const matches = settings.genres.map((genre) => genres.has(genre));
      if (settings.genreMode === "all" ? !matches.every(Boolean) : !matches.some(Boolean)) {
        return false;
      }
    }

    return true;
  });

  return filtered.sort((left, right) => {
    let comparison = 0;
    if (settings.sort === "rating") {
      comparison = compareNullableDescending(left.rating, right.rating);
    } else if (settings.sort === "votes") {
      comparison = right.voteCount - left.voteCount;
    } else if (settings.sort === "year") {
      comparison = right.releaseYear - left.releaseYear;
    } else {
      comparison = left.title.localeCompare(right.title);
    }
    return comparison || left.title.localeCompare(right.title) || left.key.localeCompare(right.key);
  });
}
