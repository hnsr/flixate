import type { UserStateV1 } from "../domain/user-state.js";
import {
  createSyncEnvelope,
  mergeSyncStates,
  migrateUserStateToSync,
  parseSyncEnvelope,
  type SyncStateV1,
} from "./sync-state.js";

export const LEGACY_SYNC_STATE_KEY = "flixate:sync-state:v1";
export const LOCAL_SYNC_STATE_KEY = "flixate:sync-state:v2";

type LocalSyncStorage = Pick<Storage, "getItem" | "setItem">;

export function parseLocalSyncState(value: string, deviceId: string): SyncStateV1 {
  const envelope = parseSyncEnvelope(value);
  if (envelope.deviceId !== deviceId) {
    throw new Error("The saved sync state belongs to a different browser installation.");
  }
  return envelope.state;
}

export function loadOrMigrateLocalSyncState(
  storage: Pick<Storage, "getItem">,
  deviceId: string,
  legacyState: UserStateV1,
  now = new Date().toISOString(),
): SyncStateV1 {
  let migrated = migrateUserStateToSync(legacyState, deviceId, now);
  for (const key of [LEGACY_SYNC_STATE_KEY, LOCAL_SYNC_STATE_KEY]) {
    try {
      const raw = storage.getItem(key);
      if (raw) migrated = mergeSyncStates(migrated, parseLocalSyncState(raw, deviceId));
    } catch {
      // Keep valid state from the other format if one copy is malformed.
    }
  }
  return migrated;
}

export function saveLocalSyncState(
  storage: LocalSyncStorage,
  deviceId: string,
  state: SyncStateV1,
  now = new Date().toISOString(),
): void {
  storage.setItem(
    LOCAL_SYNC_STATE_KEY,
    JSON.stringify(createSyncEnvelope(deviceId, state, now)),
  );
}

export function syncStatesEqual(a: SyncStateV1, b: SyncStateV1): boolean {
  return JSON.stringify(mergeSyncStates(a)) === JSON.stringify(mergeSyncStates(b));
}
