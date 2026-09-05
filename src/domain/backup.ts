import { DEFAULT_FILTERS, type FilterSettings } from "./catalog.js";
import { migrateUserState, type UserStateV1 } from "./user-state.js";
import { createSyncEnvelope, parseSyncEnvelope, syncStateToUserState, type SyncStateV1 } from "../sync/sync-state.js";

export type FlixateBackup = {
  format: "flixate-backup";
  version: 1 | 2;
  exportedAt: string;
  state: UserStateV1;
  settings: FilterSettings;
  personalState?: SyncStateV1;
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

// Export only validated personal state, never account bindings, grants, or device session metadata.
export function createPersonalBackup(
  state: SyncStateV1, settings: FilterSettings, now = new Date().toISOString(),
): FlixateBackup {
  const envelope = createSyncEnvelope("00000000-0000-4000-8000-000000000000", state, now);
  const personalState = parseSyncEnvelope(envelope).state;
  return {
    format: "flixate-backup", version: 2, exportedAt: envelope.writtenAt,
    state: syncStateToUserState(personalState), personalState, settings,
  };
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
    minimumYear: validYear(candidate.minimumYear),
    maximumYear: validYear(candidate.maximumYear),
    genres: Array.isArray(candidate.genres)
      ? candidate.genres.filter((genre): genre is string => typeof genre === "string")
      : [],
    genreMode,
    sort,
  };
}

function validYear(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1800 && value <= 9999
    ? value : null;
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
  if (candidate.format !== "flixate-backup" || (candidate.version !== 1 && candidate.version !== 2) || !candidate.state) {
    throw new Error("That is not a supported Flixate backup.");
  }
  let personalState: SyncStateV1 | undefined;
  if (candidate.version === 2) {
    if (!candidate.personalState) throw new Error("The backup is missing its personal state.");
    personalState = parseSyncEnvelope({
      format: "flixate-state", version: 2,
      deviceId: "00000000-0000-4000-8000-000000000000",
      writtenAt: candidate.exportedAt, state: candidate.personalState,
    }).state;
  }
  return {
    format: "flixate-backup",
    version: candidate.version,
    exportedAt: typeof candidate.exportedAt === "string" ? candidate.exportedAt : "unknown",
    state: personalState ? syncStateToUserState(personalState) : migrateUserState(candidate.state),
    ...(personalState ? { personalState } : {}),
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
