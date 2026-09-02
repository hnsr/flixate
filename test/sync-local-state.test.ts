import { describe, expect, it } from "vitest";
import type { UserStateV1 } from "../src/domain/user-state.js";
import {
  LOCAL_SYNC_STATE_KEY,
  loadOrMigrateLocalSyncState,
  parseLocalSyncState,
  saveLocalSyncState,
} from "../src/sync/sync-local-state.js";
import { applyBooleanChange, emptySyncState } from "../src/sync/sync-state.js";

const DEVICE_A = "00000000-0000-4000-8000-000000000001";
const DEVICE_B = "00000000-0000-4000-8000-000000000002";
const NOW = "2024-09-02T12:00:00.000Z";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe("local synchronized state", () => {
  it("migrates the existing visible user state when no sync document exists", () => {
    const storage = new MemoryStorage();
    const legacy: UserStateV1 = {
      version: 1,
      titles: { "movie:1": { seen: true, updatedAt: NOW } },
    };

    const state = loadOrMigrateLocalSyncState(storage, DEVICE_A, legacy, NOW);
    expect(state.titles["movie:1"]?.seen?.value).toBe(true);
    expect(state.titles["movie:1"]?.seen?.changedAt.deviceId).toBe(DEVICE_A);
  });

  it("retains the richer hybrid stamp while merging a legacy compatibility record", () => {
    const storage = new MemoryStorage();
    const seen = applyBooleanChange(emptySyncState(), DEVICE_A, "movie:1", "seen", true, NOW);
    const unseen = applyBooleanChange(
      seen,
      DEVICE_A,
      "movie:1",
      "seen",
      false,
      "2024-09-02T11:00:00.000Z",
    );
    saveLocalSyncState(storage, DEVICE_A, unseen, NOW);
    const legacy: UserStateV1 = {
      version: 1,
      titles: { "movie:1": { seen: true, updatedAt: NOW } },
    };

    const loaded = loadOrMigrateLocalSyncState(storage, DEVICE_A, legacy, NOW);
    expect(loaded.titles["movie:1"]?.seen?.value).toBe(false);
    expect(loaded.titles["movie:1"]?.seen?.changedAt.counter).toBe(1);
  });

  it("validates that local state belongs to this browser installation", () => {
    const storage = new MemoryStorage();
    saveLocalSyncState(storage, DEVICE_A, emptySyncState(), NOW);
    const raw = storage.values.get(LOCAL_SYNC_STATE_KEY)!;

    expect(parseLocalSyncState(raw, DEVICE_A)).toEqual(emptySyncState());
    expect(() => parseLocalSyncState(raw, DEVICE_B)).toThrow("different browser");
  });
});
