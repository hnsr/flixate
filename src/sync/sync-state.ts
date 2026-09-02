import type { TitleKey } from "../domain/catalog.js";
import type { UserStateV1 } from "../domain/user-state.js";
import { isDeviceId } from "./sync-metadata.js";

export const SYNC_DOCUMENT_FORMAT = "flixate-state";
export const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1_000;

export type HybridTimestampV1 = {
  wallTime: string;
  counter: number;
  deviceId: string;
};

export type SyncBooleanFieldV1 = {
  value: boolean;
  changedAt: HybridTimestampV1;
};

export type SyncTitleStateV1 = {
  seen?: SyncBooleanFieldV1;
  watchlisted?: SyncBooleanFieldV1;
};

export type SyncStateV1 = {
  version: 1;
  titles: Partial<Record<TitleKey, SyncTitleStateV1>>;
};

export type SyncEnvelopeV1 = {
  format: typeof SYNC_DOCUMENT_FORMAT;
  version: 1;
  deviceId: string;
  writtenAt: string;
  state: SyncStateV1;
};

export type SyncBooleanFieldName = keyof SyncTitleStateV1;

export type ParseSyncEnvelopeOptions = {
  nowMs?: number;
  maxFutureSkewMs?: number;
};

export function emptySyncState(): SyncStateV1 {
  return { version: 1, titles: {} };
}

function isTitleKey(value: unknown): value is TitleKey {
  return typeof value === "string" && /^(movie|tv):\d+$/.test(value);
}

function canonicalIsoMilliseconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) return null;
  return milliseconds;
}

function requireCanonicalIso(value: string, label: string): number {
  const milliseconds = canonicalIsoMilliseconds(value);
  if (milliseconds === null) throw new Error(`${label} is not a canonical ISO timestamp.`);
  return milliseconds;
}

function validateHybridTimestamp(
  value: unknown,
  nowMs: number,
  maxFutureSkewMs: number,
): HybridTimestampV1 {
  if (!value || typeof value !== "object") throw new Error("A sync change stamp is malformed.");
  const candidate = value as Partial<HybridTimestampV1>;
  const wallTimeMs = canonicalIsoMilliseconds(candidate.wallTime);
  if (
    wallTimeMs === null ||
    wallTimeMs > nowMs + maxFutureSkewMs ||
    !Number.isSafeInteger(candidate.counter) ||
    (candidate.counter ?? -1) < 0 ||
    !isDeviceId(candidate.deviceId)
  ) {
    throw new Error("A sync change stamp is malformed or implausibly far in the future.");
  }
  return {
    wallTime: candidate.wallTime as string,
    counter: candidate.counter as number,
    deviceId: candidate.deviceId,
  };
}

function validateBooleanField(
  value: unknown,
  nowMs: number,
  maxFutureSkewMs: number,
): SyncBooleanFieldV1 {
  if (!value || typeof value !== "object") throw new Error("A synchronized field is malformed.");
  const candidate = value as Partial<SyncBooleanFieldV1>;
  if (typeof candidate.value !== "boolean") throw new Error("A synchronized field is malformed.");
  return {
    value: candidate.value,
    changedAt: validateHybridTimestamp(candidate.changedAt, nowMs, maxFutureSkewMs),
  };
}

function validateSyncState(
  value: unknown,
  nowMs: number,
  maxFutureSkewMs: number,
): SyncStateV1 {
  if (!value || typeof value !== "object") throw new Error("The synchronized state is malformed.");
  const candidate = value as Partial<SyncStateV1>;
  if (candidate.version !== 1 || !candidate.titles || typeof candidate.titles !== "object") {
    throw new Error("The synchronized state is malformed or unsupported.");
  }

  const titles: SyncStateV1["titles"] = {};
  for (const [key, valueForTitle] of Object.entries(candidate.titles)) {
    if (!isTitleKey(key) || !valueForTitle || typeof valueForTitle !== "object") {
      throw new Error("The synchronized state contains an invalid title record.");
    }
    const title = valueForTitle as Partial<SyncTitleStateV1>;
    if (title.seen === undefined && title.watchlisted === undefined) {
      throw new Error("A synchronized title record has no supported fields.");
    }
    titles[key] = {
      ...(title.seen === undefined
        ? {}
        : { seen: validateBooleanField(title.seen, nowMs, maxFutureSkewMs) }),
      ...(title.watchlisted === undefined
        ? {}
        : { watchlisted: validateBooleanField(title.watchlisted, nowMs, maxFutureSkewMs) }),
    };
  }
  return { version: 1, titles };
}

export function compareHybridTimestamps(a: HybridTimestampV1, b: HybridTimestampV1): number {
  const wallComparison = a.wallTime.localeCompare(b.wallTime);
  if (wallComparison !== 0) return wallComparison;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  return a.deviceId.localeCompare(b.deviceId);
}

function winningField(
  current: SyncBooleanFieldV1 | undefined,
  candidate: SyncBooleanFieldV1 | undefined,
): SyncBooleanFieldV1 | undefined {
  if (!current) return candidate;
  if (!candidate) return current;
  const comparison = compareHybridTimestamps(current.changedAt, candidate.changedAt);
  if (comparison < 0) return candidate;
  if (comparison > 0) return current;

  // Equal stamps should represent the same event. If a malformed producer emitted
  // conflicting values anyway, a false tombstone wins independently of merge order.
  return current.value && !candidate.value ? candidate : current;
}

export function mergeSyncStates(...states: readonly SyncStateV1[]): SyncStateV1 {
  const keys = [...new Set(states.flatMap((state) => Object.keys(state.titles)))].sort();
  const titles: SyncStateV1["titles"] = {};

  for (const key of keys) {
    if (!isTitleKey(key)) continue;
    let seen: SyncBooleanFieldV1 | undefined;
    let watchlisted: SyncBooleanFieldV1 | undefined;
    for (const state of states) {
      const title = state.titles[key];
      seen = winningField(seen, title?.seen);
      watchlisted = winningField(watchlisted, title?.watchlisted);
    }
    if (seen || watchlisted) {
      titles[key] = {
        ...(seen ? { seen } : {}),
        ...(watchlisted ? { watchlisted } : {}),
      };
    }
  }
  return { version: 1, titles };
}

function latestObservedStamp(state: SyncStateV1): HybridTimestampV1 | null {
  let latest: HybridTimestampV1 | null = null;
  for (const title of Object.values(state.titles)) {
    for (const field of [title?.seen, title?.watchlisted]) {
      if (field && (!latest || compareHybridTimestamps(field.changedAt, latest) > 0)) {
        latest = field.changedAt;
      }
    }
  }
  return latest;
}

export function applyBooleanChange(
  state: SyncStateV1,
  deviceId: string,
  key: TitleKey,
  fieldName: SyncBooleanFieldName,
  value: boolean,
  now = new Date().toISOString(),
): SyncStateV1 {
  if (!isDeviceId(deviceId)) throw new Error("The sync device ID is not a valid UUID.");
  const nowMs = requireCanonicalIso(now, "The local change time");
  const current = state.titles[key]?.[fieldName];
  if (current?.value === value) return state;

  const latest = latestObservedStamp(state);
  const latestMs = latest ? requireCanonicalIso(latest.wallTime, "The observed change time") : null;
  if (latestMs !== null && latestMs > nowMs + MAX_FUTURE_SKEW_MS) {
    throw new Error("The current state contains a change implausibly far in the future.");
  }

  let wallTimeMs = Math.max(nowMs, latestMs ?? nowMs);
  let counter = latestMs !== null && latestMs >= nowMs ? latest!.counter + 1 : 0;
  if (!Number.isSafeInteger(counter)) {
    wallTimeMs += 1;
    counter = 0;
  }
  const changed: SyncBooleanFieldV1 = {
    value,
    changedAt: {
      wallTime: new Date(wallTimeMs).toISOString(),
      counter,
      deviceId,
    },
  };

  return {
    version: 1,
    titles: {
      ...state.titles,
      [key]: { ...state.titles[key], [fieldName]: changed },
    },
  };
}

export function migrateUserStateToSync(
  state: UserStateV1,
  deviceId: string,
  fallbackNow = new Date().toISOString(),
): SyncStateV1 {
  if (!isDeviceId(deviceId)) throw new Error("The sync device ID is not a valid UUID.");
  const fallbackMs = requireCanonicalIso(fallbackNow, "The migration time");
  const titles: SyncStateV1["titles"] = {};

  for (const [key, title] of Object.entries(state.titles)) {
    if (!isTitleKey(key) || !title) continue;
    const sourceMs = canonicalIsoMilliseconds(title.updatedAt);
    const wallTime =
      sourceMs !== null && sourceMs <= fallbackMs + MAX_FUTURE_SKEW_MS
        ? title.updatedAt
        : fallbackNow;
    titles[key] = {
      seen: { value: title.seen, changedAt: { wallTime, counter: 0, deviceId } },
    };
  }
  return { version: 1, titles };
}

export function syncStateToUserState(state: SyncStateV1): UserStateV1 {
  const titles: UserStateV1["titles"] = {};
  for (const [key, title] of Object.entries(state.titles)) {
    if (!isTitleKey(key) || !title?.seen) continue;
    titles[key] = { seen: title.seen.value, updatedAt: title.seen.changedAt.wallTime };
  }
  return { version: 1, titles };
}

export function createSyncEnvelope(
  deviceId: string,
  state: SyncStateV1,
  now = new Date().toISOString(),
): SyncEnvelopeV1 {
  if (!isDeviceId(deviceId)) throw new Error("The sync device ID is not a valid UUID.");
  const nowMs = requireCanonicalIso(now, "The sync write time");
  const latest = latestObservedStamp(state);
  const latestMs = latest ? requireCanonicalIso(latest.wallTime, "The observed change time") : nowMs;
  return {
    format: SYNC_DOCUMENT_FORMAT,
    version: 1,
    deviceId,
    writtenAt: new Date(Math.max(nowMs, latestMs)).toISOString(),
    state,
  };
}

export function parseSyncEnvelope(
  input: unknown,
  options: ParseSyncEnvelopeOptions = {},
): SyncEnvelopeV1 {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      throw new Error("The sync document is not valid JSON.");
    }
  }
  if (!value || typeof value !== "object") throw new Error("The sync document is malformed.");

  const candidate = value as Partial<SyncEnvelopeV1>;
  if (
    candidate.format !== SYNC_DOCUMENT_FORMAT ||
    candidate.version !== 1 ||
    !isDeviceId(candidate.deviceId)
  ) {
    throw new Error("The sync document format or version is unsupported.");
  }

  const nowMs = options.nowMs ?? Date.now();
  const maxFutureSkewMs = options.maxFutureSkewMs ?? MAX_FUTURE_SKEW_MS;
  const writtenAtMs = canonicalIsoMilliseconds(candidate.writtenAt);
  if (
    writtenAtMs === null ||
    writtenAtMs > nowMs + maxFutureSkewMs ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(maxFutureSkewMs) ||
    maxFutureSkewMs < 0
  ) {
    throw new Error("The sync document write time is malformed or implausibly far in the future.");
  }

  const state = validateSyncState(candidate.state, nowMs, maxFutureSkewMs);
  const latest = latestObservedStamp(state);
  if (latest && Date.parse(latest.wallTime) > writtenAtMs) {
    throw new Error("The sync document was written before one of its contained changes.");
  }
  return {
    format: SYNC_DOCUMENT_FORMAT,
    version: 1,
    deviceId: candidate.deviceId,
    writtenAt: candidate.writtenAt as string,
    state,
  };
}

export function syncFileName(deviceId: string): string {
  if (!isDeviceId(deviceId)) throw new Error("The sync device ID is not a valid UUID.");
  return `flixate-state-${deviceId}.json`;
}
