export const REGIONS = ["US", "NL"] as const;
export type Region = (typeof REGIONS)[number];

export const MEDIA_TYPES = ["movie", "tv"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export type DateRange = {
  start: string;
  end: string;
};

export type TmdbDiscoverItem = {
  id: number;
  title?: string;
  name?: string;
  genre_ids: number[];
  overview?: string;
  poster_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  adult?: boolean;
  vote_average?: number;
  vote_count?: number;
};

export type TmdbPage = {
  page: number;
  total_pages: number;
  total_results: number;
  results: TmdbDiscoverItem[];
};

export type DiscoveredTitle = {
  key: `${MediaType}:${number}`;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  genreIds: number[];
  releaseDate: string | null;
  posterPath: string | null;
  overview: string | null;
  regions: Set<Region>;
  displaySourceRegion: Region;
  rating?: number;
  voteCount?: number;
};

export type CatalogTitle = {
  key: `${MediaType}:${number}`;
  tmdbId: number;
  title: string;
  mediaType: "movie" | "show";
  genreIds: number[];
  releaseYear?: number;
  rating?: number;
  voteCount?: number;
  posterPath?: string;
};

export type RequestStats = {
  networkRequests: number;
  cacheHits: number;
  retries: number;
  rateLimits: number;
};

export type DiscoveryStats = {
  advertisedResults: number;
  advertisedPages: number;
  datedResultsFetched: number;
  topWindowResultsFetched: number;
  partitions: number;
  saturatedSingleDays: number;
};

export type PhaseZeroManifest = {
  schemaVersion: 1;
  snapshotId: string;
  createdAt: string;
  regions: readonly Region[];
  coverage: {
    mode: "sample" | "full";
    datedRange: DateRange;
    topWindowPages: number;
    caveat: string;
  };
  counts: {
    titles: number;
    movies: number;
    shows: number;
    tmdbRated: number;
    tmdbUnrated: number;
  };
  catalog: {
    file: string;
    sha256: string;
    compressedBytes: number;
    uncompressedBytes: number;
  };
  scores: {
    source: "tmdb";
    lowConfidenceBelowVotes: number;
  };
  sourceDates: {
    tmdb: string;
  };
};

export type CompressedArtifact = {
  file: string;
  sha256: string;
  compressedBytes: number;
  uncompressedBytes: number;
};

export type SynopsisShardArtifact = CompressedArtifact & {
  number: number;
  entries: number;
};

export type CatalogManifest = {
  schemaVersion: 1;
  snapshotId: string;
  createdAt: string;
  fixture: false;
  regions: readonly Region[];
  coverage: {
    mode: "sample" | "full";
    datedRange: DateRange;
    topWindowPages: number;
    caveat: string;
  };
  counts: {
    titles: number;
    movies: number;
    shows: number;
    tmdbRated: number;
    tmdbUnrated: number;
    withReleaseYear: number;
    withPoster: number;
    withSynopsis: number;
  };
  catalog: CompressedArtifact;
  synopsisShards: {
    scheme: "tmdb-id-modulo";
    count: number;
    shards: SynopsisShardArtifact[];
  };
  scores: {
    source: "tmdb";
    lowConfidenceBelowVotes: number;
  };
  image: {
    baseUrl: string;
    posterSize: string;
  };
  sourceDates: {
    tmdb: string;
  };
  attributionVersion: 1;
};
