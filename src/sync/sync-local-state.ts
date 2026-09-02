import type { UserStateV1 } from "../domain/user-state.js";
import {
  createSyncEnvelope,
  mergeSyncStates,
  migrateUserStateToSync,
  parseSyncEnvelope,
  type SyncStateV1,
} from "./sync-state.js";

export const LOCAL_SYNC_STATE_KEY = "flixate:sync-state:v1";

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
  const migrated = migrateUserStateToSync(legacyState, deviceId, now);
  try {
    const raw = storage.getItem(LOCAL_SYNC_STATE_KEY);
    if (!raw) return migrated;
    return mergeSyncStates(parseLocalSyncState(raw, deviceId), migrated);
  } catch {
    return migrated;
  }
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
