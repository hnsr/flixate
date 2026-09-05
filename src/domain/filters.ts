import {
  genresForTitle,
  type CoreTitle,
  type FilterSettings,
  type SortMode,
  type TitleKey,
} from "./catalog.js";

export type CatalogFilterIndex = {
  titles: readonly CoreTitle[];
  normalizedTitles: readonly string[];
  sortOrders: Map<SortMode, readonly number[]>;
};

function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase("en-US");
}

function compareNullableDescending(left: number | undefined, right: number | undefined): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return right - left;
}

function compareTitles(left: CoreTitle, right: CoreTitle, sort: SortMode): number {
  let comparison = 0;
  if (sort === "rating") {
    comparison = compareNullableDescending(left.rating, right.rating);
  } else if (sort === "votes") {
    comparison = right.voteCount - left.voteCount;
  } else if (sort === "year") {
    comparison = compareNullableDescending(left.releaseYear, right.releaseYear);
  } else {
    comparison = left.title.localeCompare(right.title);
  }
  return comparison || left.title.localeCompare(right.title) || left.key.localeCompare(right.key);
}

export function createCatalogFilterIndex(titles: readonly CoreTitle[]): CatalogFilterIndex {
  return {
    titles,
    normalizedTitles: titles.map((title) => normalizeSearchText(title.title)),
    sortOrders: new Map(),
  };
}

export function sortedTitleIndexes(
  index: CatalogFilterIndex,
  sort: SortMode,
): readonly number[] {
  const cached = index.sortOrders.get(sort);
  if (cached) return cached;
  const order = Array.from({ length: index.titles.length }, (_, titleIndex) => titleIndex);
  order.sort((leftIndex, rightIndex) => {
    const left = index.titles[leftIndex];
    const right = index.titles[rightIndex];
    if (!left || !right) return left ? -1 : right ? 1 : 0;
    return compareTitles(left, right, sort);
  });
  index.sortOrders.set(sort, order);
  return order;
}

export function filterCatalogIndex(
  index: CatalogFilterIndex,
  settings: FilterSettings,
  seenKeys: ReadonlySet<TitleKey>,
): CoreTitle[] {
  const query = normalizeSearchText(settings.query.trim());
  const hasRatingFilter = settings.minimumRating !== null || settings.maximumRating !== null;
  const titles: CoreTitle[] = [];

  for (const titleIndex of sortedTitleIndexes(index, settings.sort)) {
    const title = index.titles[titleIndex];
    if (!title) continue;
    if (query && !index.normalizedTitles[titleIndex]?.includes(query)) continue;
    if (settings.mediaType !== "all" && title.mediaType !== settings.mediaType) continue;

    const isSeen = seenKeys.has(title.key);
    if (settings.seen === "hide" && isSeen) continue;
    if (settings.seen === "only" && !isSeen) continue;

    if (hasRatingFilter && title.rating === undefined) continue;
    if (settings.minimumRating !== null && (title.rating ?? -1) < settings.minimumRating) continue;
    if (settings.maximumRating !== null && (title.rating ?? 11) > settings.maximumRating) continue;
    if (title.voteCount < settings.minimumVotes) continue;
    if (settings.minimumYear != null && (title.releaseYear ?? -1) < settings.minimumYear) continue;
    if (settings.maximumYear != null && (title.releaseYear ?? Infinity) > settings.maximumYear) continue;

    if (settings.genres.length > 0) {
      const genres = genresForTitle(title);
      const matches = settings.genres.map((genre) => genres.includes(genre));
      if (settings.genreMode === "all" ? !matches.every(Boolean) : !matches.some(Boolean)) {
        continue;
      }
    }

    titles.push(title);
  }

  return titles;
}

export function filterAndSortTitles(
  titles: readonly CoreTitle[],
  settings: FilterSettings,
  seenKeys: ReadonlySet<TitleKey>,
): CoreTitle[] {
  return filterCatalogIndex(createCatalogFilterIndex(titles), settings, seenKeys);
}
