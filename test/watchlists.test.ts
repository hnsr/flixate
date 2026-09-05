import { describe, expect, it } from "vitest";
import {
  activeWatchlists, applyBooleanChange, changeWatchlist, createSyncEnvelope,
  emptySyncState, mergeSyncStates, parseSyncEnvelope,
} from "../src/sync/sync-state.js";
import { createPersonalBackup, parseBackup } from "../src/domain/backup.js";
import { DEFAULT_FILTERS } from "../src/domain/catalog.js";
import { loadOrMigrateLocalSyncState, saveLocalSyncState, LEGACY_SYNC_STATE_KEY } from "../src/sync/sync-local-state.js";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const L1 = "00000000-0000-4000-8000-000000000003";
const L2 = "00000000-0000-4000-8000-000000000004";
const NOW = "2026-09-05T12:00:00.000Z";

function twoLists() {
  return changeWatchlist(changeWatchlist(emptySyncState(), A, L1, { name: "Friday" }, NOW),
    A, L2, { name: "Together" }, NOW);
}

describe("multiple watchlists", () => {
  it("merges independent memberships and seen edits in every order", () => {
    const initial = twoLists();
    const a = changeWatchlist(initial, A, L1, { key: "movie:1", member: true }, NOW);
    const b = changeWatchlist(initial, B, L2, { key: "movie:1", member: true }, NOW);
    const c = applyBooleanChange(initial, A, "movie:1", "seen", true, NOW);
    const merged = mergeSyncStates(a, b, c);
    expect(mergeSyncStates(c, b, a)).toEqual(merged);
    expect(mergeSyncStates(merged, a)).toEqual(merged);
    expect(merged.lists?.[L1]?.members["movie:1"]?.value).toBe(true);
    expect(merged.lists?.[L2]?.members["movie:1"]?.value).toBe(true);
    expect(merged.titles["movie:1"]?.seen?.value).toBe(true);
    expect(parseSyncEnvelope(createSyncEnvelope(A, merged, NOW)).state).toEqual(merged);
  });

  it("keeps removals and deleted lists despite stale edits, without affecting other lists", () => {
    let initial = twoLists();
    initial = changeWatchlist(initial, A, L1, { key: "movie:1", member: true }, NOW);
    initial = changeWatchlist(initial, A, L2, { key: "movie:1", member: true }, NOW);
    const removed = changeWatchlist(initial, A, L1, { key: "movie:1", member: false }, NOW);
    expect(mergeSyncStates(initial, removed).lists?.[L1]?.members["movie:1"]?.value).toBe(false);
    const deleted = changeWatchlist(removed, A, L1, { delete: true }, NOW);
    const staleRename = changeWatchlist(initial, B, L1, { name: "Old device" }, "2026-09-05T13:00:00.000Z");
    const merged = mergeSyncStates(deleted, staleRename);
    expect(activeWatchlists(merged).map(item => item.id)).toEqual([L2]);
    expect(merged.lists?.[L2]?.members["movie:1"]?.value).toBe(true);
    expect(() => changeWatchlist(merged, A, L1, { name: "Recreate" }, NOW)).toThrow("deleted");
    expect(mergeSyncStates(staleRename, deleted)).toEqual(merged);
  });

  it("orders a rename after a near-future membership change even with a backward clock", () => {
    const added = changeWatchlist(twoLists(), A, L1, { key: "movie:1", member: true }, "2026-09-05T13:00:00.000Z");
    const renamed = changeWatchlist(added, B, L1, { name: "Later decision" }, NOW);
    expect(renamed.lists?.[L1]?.name.changedAt.counter).toBe(1);
    expect(renamed.lists?.[L1]?.name.changedAt.wallTime).toBe("2026-09-05T13:00:00.000Z");
  });

  it("migrates v1 storage and cannot lose v2 lists when an old tab updates seen state", () => {
    const old = createSyncEnvelope(A, applyBooleanChange(emptySyncState(), A, "movie:1", "seen", true, NOW), NOW);
    old.version = 1;
    localStorage.setItem(LEGACY_SYNC_STATE_KEY, JSON.stringify(old));
    let state = loadOrMigrateLocalSyncState(localStorage, A, { version: 1, titles: {} }, NOW);
    state = changeWatchlist(state, A, L1, { name: "Migrated" }, NOW);
    saveLocalSyncState(localStorage, A, state, NOW);
    old.state = applyBooleanChange(old.state, A, "movie:2", "seen", true, NOW);
    localStorage.setItem(LEGACY_SYNC_STATE_KEY, JSON.stringify(old));
    const reloaded = loadOrMigrateLocalSyncState(localStorage, A, { version: 1, titles: {} }, NOW);
    expect(activeWatchlists(reloaded)[0]?.list.name.value).toBe("Migrated");
    expect(reloaded.titles["movie:2"]?.seen?.value).toBe(true);
  });

  it("exports and restores lists, tombstones and seen history without account credentials", () => {
    const state = changeWatchlist(twoLists(), A, L1, { delete: true }, NOW);
    const backup = createPersonalBackup(state, { ...DEFAULT_FILTERS, minimumYear: 2000 }, NOW);
    expect(backup.version).toBe(2);
    const restored = parseBackup(JSON.stringify(backup));
    expect(restored.personalState).toEqual(state);
    expect(restored.settings.minimumYear).toBe(2000);
    expect(activeWatchlists(mergeSyncStates(twoLists(), restored.personalState!)).map(item => item.id)).toEqual([L2]);
    expect(JSON.stringify(backup)).not.toMatch(/accessToken|emailAddress|permissionId/);
  });

  it("rejects malformed list data and unsupported backups without silently discarding lists", () => {
    const envelope = createSyncEnvelope(A, twoLists(), NOW);
    const malformed = structuredClone(envelope);
    malformed.state.lists![L1]!.name.value = "";
    expect(() => parseSyncEnvelope(malformed)).toThrow("malformed");
    expect(() => parseBackup(JSON.stringify({ format: "flixate-backup", version: 2, state: {} }))).toThrow("missing");
    expect(() => parseSyncEnvelope({ ...envelope, version: 1 })).toThrow("version 2");
  });
});
