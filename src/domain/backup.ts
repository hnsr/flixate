import { DEFAULT_FILTERS, type FilterSettings } from "./catalog.js";
import { migrateUserState, type UserStateV1 } from "./user-state.js";

export type FlixateBackup = {
  format: "flixate-backup";
  version: 1;
  exportedAt: string;
  state: UserStateV1;
  settings: FilterSettings;
};

export type ImportPreview = {
  newer: number;
  unchangedOrOlder: number;
  seenAfterMerge: number;
};

export function createBackup(
  state: UserStateV1,
  settings: FilterSettings,
  now = new Date().toISOString(),
): FlixateBackup {
  return { format: "flixate-backup", version: 1, exportedAt: now, state, settings };
}

export function normalizeFilterSettings(value: unknown): FilterSettings {
  if (!value || typeof value !== "object") return DEFAULT_FILTERS;
  const candidate = value as Partial<FilterSettings>;
  const mediaType = ["all", "movie", "show"].includes(candidate.mediaType ?? "")
    ? candidate.mediaType as FilterSettings["mediaType"]
    : DEFAULT_FILTERS.mediaType;
  const seen = ["hide", "all", "only"].includes(candidate.seen ?? "")
    ? candidate.seen as FilterSettings["seen"]
    : DEFAULT_FILTERS.seen;
  const genreMode = ["any", "all"].includes(candidate.genreMode ?? "")
    ? candidate.genreMode as FilterSettings["genreMode"]
    : DEFAULT_FILTERS.genreMode;
  const sort = ["rating", "votes", "year", "title"].includes(candidate.sort ?? "")
    ? candidate.sort as FilterSettings["sort"]
    : DEFAULT_FILTERS.sort;

  return {
    query: typeof candidate.query === "string" ? candidate.query : "",
    mediaType,
    seen,
    minimumRating: typeof candidate.minimumRating === "number" ? candidate.minimumRating : null,
    maximumRating: typeof candidate.maximumRating === "number" ? candidate.maximumRating : null,
    minimumVotes: typeof candidate.minimumVotes === "number" ? candidate.minimumVotes : 0,
    genres: Array.isArray(candidate.genres)
      ? candidate.genres.filter((genre): genre is string => typeof genre === "string")
      : [],
    genreMode,
    sort,
  };
}

export function parseBackup(text: string): FlixateBackup {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (!value || typeof value !== "object") throw new Error("That is not a Flixate backup.");
  const candidate = value as Partial<FlixateBackup>;
  if (candidate.format !== "flixate-backup" || candidate.version !== 1 || !candidate.state) {
    throw new Error("That is not a supported Flixate backup.");
  }
  return {
    format: "flixate-backup",
    version: 1,
    exportedAt: typeof candidate.exportedAt === "string" ? candidate.exportedAt : "unknown",
    state: migrateUserState(candidate.state),
    settings: normalizeFilterSettings(candidate.settings),
  };
}

export function previewImport(local: UserStateV1, incoming: UserStateV1): ImportPreview {
  let newer = 0;
  let unchangedOrOlder = 0;
  const merged = { ...local.titles };
  for (const [key, state] of Object.entries(incoming.titles)) {
    if (!state) continue;
    const localState = local.titles[key as keyof typeof local.titles];
    if (!localState || state.updatedAt > localState.updatedAt) {
      newer++;
      merged[key as keyof typeof merged] = state;
    } else {
      unchangedOrOlder++;
    }
  }
  return {
    newer,
    unchangedOrOlder,
    seenAfterMerge: Object.values(merged).filter((state) => state?.seen).length,
  };
}
