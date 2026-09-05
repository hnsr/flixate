import { describe, expect, it } from "vitest";
import type { UserStateV1 } from "../src/domain/user-state.js";
import {
  SYNC_METADATA_KEY,
  SyncAccountMismatchError,
  bindSyncAccount,
  clearSyncAccount,
  loadOrCreateSyncMetadata,
  saveSyncMetadata,
  type SyncMetadataV1,
} from "../src/sync/sync-metadata.js";
import {
  MAX_FUTURE_SKEW_MS,
  applyBooleanChange,
  createSyncEnvelope,
  emptySyncState,
  mergeSyncStates,
  migrateUserStateToSync,
  parseSyncEnvelope,
  syncFileName,
  syncStateToUserState,
  type HybridTimestampV1,
  type SyncBooleanFieldV1,
  type SyncStateV1,
} from "../src/sync/sync-state.js";

const DEVICE_A = "00000000-0000-4000-8000-000000000001";
const DEVICE_B = "00000000-0000-4000-8000-000000000002";
const DEVICE_C = "00000000-0000-4000-8000-000000000003";
const NOON = "2026-09-02T12:00:00.000Z";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function stamp(
  deviceId: string,
  wallTime = NOON,
  counter = 0,
): HybridTimestampV1 {
  return { wallTime, counter, deviceId };
}

function field(value: boolean, changedAt: HybridTimestampV1): SyncBooleanFieldV1 {
  return { value, changedAt };
}

describe("sync metadata", () => {
  it("creates one device ID and restores it on later loads", () => {
    const storage = new MemoryStorage();
    const first = loadOrCreateSyncMetadata(storage, () => DEVICE_A);
    const second = loadOrCreateSyncMetadata(storage, () => DEVICE_B);

    expect(first).toEqual({ version: 1, deviceId: DEVICE_A, account: null });
    expect(second).toEqual(first);
    expect(JSON.parse(storage.values.get(SYNC_METADATA_KEY) ?? "")).toEqual(first);
  });

  it("replaces malformed metadata with a fresh identity", () => {
    const storage = new MemoryStorage();
    storage.values.set(SYNC_METADATA_KEY, "{not-json");

    expect(loadOrCreateSyncMetadata(storage, () => DEVICE_B).deviceId).toBe(DEVICE_B);
  });

  it("binds the same account safely and blocks an unconfirmed replacement", () => {
    const initial: SyncMetadataV1 = { version: 1, deviceId: DEVICE_A, account: null };
    const accountA = {
      permissionId: "permission-a",
      emailAddress: "one@example.test",
      displayName: "One",
    };
    const connected = bindSyncAccount(initial, accountA, NOON);
    const refreshed = bindSyncAccount(
      connected,
      { ...accountA, displayName: "One Updated" },
      "2026-09-03T12:00:00.000Z",
    );

    expect(refreshed.account?.connectedAt).toBe(NOON);
    expect(refreshed.account?.displayName).toBe("One Updated");
    expect(() =>
      bindSyncAccount(
        connected,
        { ...accountA, permissionId: "permission-b" },
        "2026-09-03T12:00:00.000Z",
      ),
    ).toThrow(SyncAccountMismatchError);

    const replaced = bindSyncAccount(
      connected,
      { ...accountA, permissionId: "permission-b" },
      "2026-09-03T12:00:00.000Z",
      { allowReplacement: true },
    );
    expect(replaced.account?.permissionId).toBe("permission-b");
    expect(replaced.account?.connectedAt).toBe("2026-09-03T12:00:00.000Z");
  });

  it("disconnects without changing the stable device identity", () => {
    const storage = new MemoryStorage();
    const connected = bindSyncAccount(
      { version: 1, deviceId: DEVICE_A, account: null },
      { permissionId: "permission-a", emailAddress: null, displayName: null },
      NOON,
    );
    const disconnected = clearSyncAccount(connected);
    saveSyncMetadata(storage, disconnected);

    expect(disconnected).toEqual({ version: 1, deviceId: DEVICE_A, account: null });
    expect(loadOrCreateSyncMetadata(storage, () => DEVICE_B)).toEqual(disconnected);
  });
});

describe("sync-state migration", () => {
  it("preserves all visible seen decisions, including false tombstones", () => {
    const legacy: UserStateV1 = {
      version: 1,
      titles: {
        "movie:1": { seen: true, updatedAt: "2026-08-01T12:00:00.000Z" },
        "tv:2": { seen: false, updatedAt: "2026-08-02T12:00:00.000Z" },
      },
    };

    const synchronized = migrateUserStateToSync(legacy, DEVICE_A, NOON);
    expect(syncStateToUserState(synchronized)).toEqual(legacy);
    expect(synchronized.titles["tv:2"]?.seen?.value).toBe(false);
  });

  it("clamps invalid and implausibly future legacy timestamps", () => {
    const legacy: UserStateV1 = {
      version: 1,
      titles: {
        "movie:1": { seen: true, updatedAt: "not-a-date" },
        "tv:2": { seen: true, updatedAt: "2099-01-01T00:00:00.000Z" },
      },
    };

    const synchronized = migrateUserStateToSync(legacy, DEVICE_A, NOON);
    expect(synchronized.titles["movie:1"]?.seen?.changedAt.wallTime).toBe(NOON);
    expect(synchronized.titles["tv:2"]?.seen?.changedAt.wallTime).toBe(NOON);
  });
});

describe("deterministic sync merge", () => {
  it("retains concurrent edits to different titles", () => {
    const deviceA = applyBooleanChange(emptySyncState(), DEVICE_A, "movie:1", "seen", true, NOON);
    const deviceB = applyBooleanChange(emptySyncState(), DEVICE_B, "tv:2", "seen", true, NOON);

    const merged = mergeSyncStates(deviceA, deviceB);
    expect(merged.titles["movie:1"]?.seen?.value).toBe(true);
    expect(merged.titles["tv:2"]?.seen?.value).toBe(true);
  });

  it("merges independently edited seen and watchlist fields on one title", () => {
    const deviceA = applyBooleanChange(emptySyncState(), DEVICE_A, "movie:1", "seen", true, NOON);
    const deviceB = applyBooleanChange(
      emptySyncState(),
      DEVICE_B,
      "movie:1",
      "watchlisted",
      true,
      NOON,
    );

    expect(mergeSyncStates(deviceA, deviceB).titles["movie:1"]).toEqual({
      seen: field(true, stamp(DEVICE_A)),
      watchlisted: field(true, stamp(DEVICE_B)),
    });
  });

  it("uses device ID to resolve equal wall times and counters in every order", () => {
    const deviceA = applyBooleanChange(emptySyncState(), DEVICE_A, "movie:1", "seen", true, NOON);
    const deviceB = applyBooleanChange(emptySyncState(), DEVICE_B, "movie:1", "seen", false, NOON);

    expect(mergeSyncStates(deviceA, deviceB)).toEqual(mergeSyncStates(deviceB, deviceA));
    expect(mergeSyncStates(deviceA, deviceB).titles["movie:1"]?.seen?.value).toBe(false);
  });

  it("keeps a newer false tombstone over an older true value", () => {
    const earlier = applyBooleanChange(emptySyncState(), DEVICE_A, "movie:1", "seen", true, NOON);
    const later = applyBooleanChange(
      earlier,
      DEVICE_B,
      "movie:1",
      "seen",
      false,
      "2026-09-02T13:00:00.000Z",
    );

    expect(mergeSyncStates(later, earlier).titles["movie:1"]?.seen?.value).toBe(false);
  });

  it("is commutative, idempotent, and independent of three-way input order", () => {
    const a = applyBooleanChange(emptySyncState(), DEVICE_A, "movie:1", "seen", true, NOON);
    const b = applyBooleanChange(emptySyncState(), DEVICE_B, "tv:2", "watchlisted", true, NOON);
    const c = applyBooleanChange(
      emptySyncState(),
      DEVICE_C,
      "movie:1",
      "seen",
      false,
      "2026-09-02T13:00:00.000Z",
    );
    const expected = mergeSyncStates(a, b, c);
    const permutations = [
      [a, c, b],
      [b, a, c],
      [b, c, a],
      [c, a, b],
      [c, b, a],
    ];

    for (const inputs of permutations) expect(mergeSyncStates(...inputs)).toEqual(expected);
    expect(mergeSyncStates(expected, expected, a, b, c)).toEqual(expected);
  });

  it("resolves an impossible exact-stamp conflict without depending on merge order", () => {
    const trueState: SyncStateV1 = {
      version: 1,
      titles: { "movie:1": { seen: field(true, stamp(DEVICE_A)) } },
    };
    const falseState: SyncStateV1 = {
      version: 1,
      titles: { "movie:1": { seen: field(false, stamp(DEVICE_A)) } },
    };

    expect(mergeSyncStates(trueState, falseState)).toEqual(mergeSyncStates(falseState, trueState));
    expect(mergeSyncStates(trueState, falseState).titles["movie:1"]?.seen?.value).toBe(false);
  });
});

describe("hybrid clock and sync envelopes", () => {
  it("advances a logical counter when the local clock moves backward", () => {
    const first = applyBooleanChange(emptySyncState(), DEVICE_A, "movie:1", "seen", true, NOON);
    const second = applyBooleanChange(
      first,
      DEVICE_A,
      "movie:1",
      "seen",
      false,
      "2026-09-02T11:00:00.000Z",
    );

    expect(second.titles["movie:1"]?.seen?.changedAt).toEqual(stamp(DEVICE_A, NOON, 1));
  });

  it("orders a local edit after an accepted near-future remote change", () => {
    const remote: SyncStateV1 = {
      version: 1,
      titles: {
        "movie:1": {
          seen: field(true, stamp(DEVICE_B, "2026-09-02T13:00:00.000Z", 2)),
        },
      },
    };
    const local = applyBooleanChange(remote, DEVICE_A, "tv:2", "seen", true, NOON);

    expect(local.titles["tv:2"]?.seen?.changedAt).toEqual(
      stamp(DEVICE_A, "2026-09-02T13:00:00.000Z", 3),
    );
  });

  it("round-trips a valid envelope and derives the owned Drive filename", () => {
    const state = applyBooleanChange(emptySyncState(), DEVICE_A, "movie:1", "seen", true, NOON);
    const envelope = createSyncEnvelope(DEVICE_A, state, "2026-09-02T12:01:00.000Z");

    expect(
      parseSyncEnvelope(JSON.stringify(envelope), { nowMs: Date.parse("2026-09-02T12:02:00.000Z") }),
    ).toEqual(envelope);
    expect(syncFileName(DEVICE_A)).toBe(`flixate-state-v2-${DEVICE_A}.json`);
  });

  it("rejects corrupt, future-version, and far-future documents", () => {
    expect(() => parseSyncEnvelope("{not-json", { nowMs: Date.parse(NOON) })).toThrow(
      "not valid JSON",
    );
    expect(() =>
      parseSyncEnvelope(
        { format: "flixate-state", version: 3, deviceId: DEVICE_A },
        { nowMs: Date.parse(NOON) },
      ),
    ).toThrow("unsupported");

    const state = applyBooleanChange(emptySyncState(), DEVICE_A, "movie:1", "seen", true, NOON);
    const envelope = createSyncEnvelope(DEVICE_A, state, NOON);
    envelope.writtenAt = new Date(Date.parse(NOON) + MAX_FUTURE_SKEW_MS + 1).toISOString();
    expect(() => parseSyncEnvelope(envelope, { nowMs: Date.parse(NOON) })).toThrow(
      "future",
    );
  });

  it("rejects a far-future field even when the envelope write time matches it", () => {
    const farFuture = new Date(Date.parse(NOON) + MAX_FUTURE_SKEW_MS + 1).toISOString();
    const state: SyncStateV1 = {
      version: 1,
      titles: { "movie:1": { seen: field(true, stamp(DEVICE_A, farFuture)) } },
    };
    const envelope = createSyncEnvelope(DEVICE_A, state, farFuture);

    expect(() => parseSyncEnvelope(envelope, { nowMs: Date.parse(NOON) })).toThrow("future");
  });
});
