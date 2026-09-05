export type TitleKey = `movie:${number}` | `tv:${number}`;
export type MediaFilter = "all" | "movie" | "show";
export type SeenFilter = "hide" | "all" | "only";
export type GenreMode = "any" | "all";
export type SortMode = "rating" | "votes" | "year" | "title";

export type CoreTitle = {
  key: TitleKey;
  tmdbId: number;
  title: string;
  releaseYear?: number;
  mediaType: "movie" | "show";
  genreIds: number[];
  rating?: number;
  voteCount: number;
  posterPath?: string;
};

export type CatalogDocument = {
  schemaVersion: 1;
  fixture: boolean;
  createdAt: string;
  regions: ["US", "NL"];
  image: {
    baseUrl: string;
    posterSize: string;
  };
  synopsisShards: {
    count: number;
    format?: "json" | "gzip-json";
    pattern?: string;
    files?: Array<{
      number: number;
      file: string;
      sha256: string;
    }>;
  };
  snapshotId?: string;
  loadWarning?: string;
  titles: CoreTitle[];
};

export type FilterSettings = {
  query: string;
  mediaType: MediaFilter;
  seen: SeenFilter;
  minimumRating: number | null;
  maximumRating: number | null;
  minimumVotes: number;
  minimumYear: number | null;
  maximumYear: number | null;
  genres: string[];
  genreMode: GenreMode;
  sort: SortMode;
};

export const DEFAULT_FILTERS: FilterSettings = {
  query: "",
  mediaType: "all",
  seen: "hide",
  minimumRating: null,
  maximumRating: null,
  minimumVotes: 0,
  minimumYear: null,
  maximumYear: null,
  genres: [],
  genreMode: "any",
  sort: "rating",
};

export const GENRE_LABELS: Readonly<Record<number, readonly string[]>> = {
  12: ["Adventure"],
  14: ["Fantasy"],
  16: ["Animation"],
  18: ["Drama"],
  27: ["Horror"],
  28: ["Action"],
  35: ["Comedy"],
  36: ["History"],
  37: ["Western"],
  53: ["Thriller"],
  80: ["Crime"],
  99: ["Documentary"],
  878: ["Science fiction"],
  9648: ["Mystery"],
  10402: ["Music"],
  10749: ["Romance"],
  10751: ["Family"],
  10752: ["War"],
  10759: ["Action", "Adventure"],
  10762: ["Kids"],
  10763: ["News"],
  10764: ["Reality"],
  10765: ["Science fiction", "Fantasy"],
  10766: ["Soap"],
  10767: ["Talk"],
  10768: ["War", "Politics"],
  10770: ["TV movie"],
};

export function genresForTitle(title: CoreTitle): string[] {
  return [...new Set(title.genreIds.flatMap((id) => GENRE_LABELS[id] ?? []))];
}

export function availableGenres(titles: readonly CoreTitle[]): string[] {
  return [...new Set(titles.flatMap(genresForTitle))].sort((a, b) => a.localeCompare(b));
}

export function tmdbUrl(title: CoreTitle): string {
  const type = title.mediaType === "show" ? "tv" : "movie";
  return `https://www.themoviedb.org/${type}/${title.tmdbId}`;
}

export function posterUrl(catalog: CatalogDocument, title: CoreTitle): string | null {
  if (!title.posterPath) return null;
  return `${catalog.image.baseUrl}/${catalog.image.posterSize}${title.posterPath}`;
}

export function synopsisShardNumber(key: TitleKey, count: number): number {
  const id = Number(key.slice(key.indexOf(":") + 1));
  return id % count;
}
