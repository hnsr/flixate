import { describe, expect, it, vi } from "vitest";
import {
  DriveRequestError,
  GoogleDriveStateTransport,
  type DriveStateFile,
  type DriveStateTransport,
} from "../src/sync/drive-transport.js";
import {
  DriveAuthorizationCoordinator,
  DRIVE_SESSION_KEY,
  loadDriveGrant,
  saveDriveGrant,
} from "../src/sync/drive-session.js";
import {
  DriveAuthorizationRequiredError,
  DriveSyncService,
} from "../src/sync/drive-sync-service.js";
import {
  DriveSyncEngine,
  SyncAccountNotBoundError,
  type SyncStateStore,
} from "../src/sync/sync-engine.js";
import { DRIVE_APPDATA_SCOPE, type DriveAccessGrant } from "../src/sync/google-identity.js";
import { SyncAccountMismatchError, type SyncMetadataV1 } from "../src/sync/sync-metadata.js";
import { SyncCoordinator } from "../src/sync/sync-coordinator.js";
import {
  applyBooleanChange,
  createSyncEnvelope,
  emptySyncState,
  syncFileName,
  type SyncEnvelopeV1,
  type SyncStateV1,
} from "../src/sync/sync-state.js";

const DEVICE_A = "00000000-0000-4000-8000-000000000001";
const DEVICE_B = "00000000-0000-4000-8000-000000000002";
const DEVICE_C = "00000000-0000-4000-8000-000000000003";
const NOW = "2024-09-02T12:00:00.000Z";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function file(deviceId: string, id = deviceId): DriveStateFile {
  return {
    id,
    name: syncFileName(deviceId),
    modifiedTime: NOW,
    size: 100,
  };
}

function envelope(deviceId: string, state: SyncStateV1): SyncEnvelopeV1 {
  return createSyncEnvelope(deviceId, state, NOW);
}

class MemoryStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class MemorySyncStore implements SyncStateStore {
  readonly events: string[] = [];

  constructor(
    public state: SyncStateV1,
    public metadata: SyncMetadataV1,
  ) {}

  loadState(): SyncStateV1 {
    this.events.push("load-state");
    return this.state;
  }

  saveState(state: SyncStateV1): void {
    this.events.push("save-state");
    this.state = state;
  }

  loadMetadata(): SyncMetadataV1 {
    this.events.push("load-metadata");
    return this.metadata;
  }

  saveMetadata(metadata: SyncMetadataV1): void {
    this.events.push("save-metadata");
    this.metadata = metadata;
  }
}

function boundMetadata(deviceId = DEVICE_A): SyncMetadataV1 {
  return {
    version: 1,
    deviceId,
    account: {
      permissionId: "account-a",
      emailAddress: "viewer@example.test",
      displayName: "Viewer",
      connectedAt: NOW,
    },
  };
}

describe("production Drive transport", () => {
  it("paginates appDataFolder and returns only exact Flixate state filenames", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token-a");
      if (!url.searchParams.has("pageToken")) {
        expect(url.searchParams.get("spaces")).toBe("appDataFolder");
        expect(url.searchParams.get("q")).toContain("trashed = false");
        return jsonResponse({
          nextPageToken: "page-2",
          files: [
            { id: "a", name: syncFileName(DEVICE_A), size: "12" },
            { id: "junk", name: "flixate-state-not-a-uuid.json" },
          ],
        });
      }
      expect(url.searchParams.get("pageToken")).toBe("page-2");
      return jsonResponse({ files: [{ id: "b", name: syncFileName(DEVICE_B) }] });
    }) as unknown as typeof fetch;
    const transport = new GoogleDriveStateTransport("token-a", { fetcher });

    await expect(transport.listStateFiles()).resolves.toEqual([
      { id: "a", name: syncFileName(DEVICE_A), modifiedTime: null, size: 12 },
      { id: "b", name: syncFileName(DEVICE_B), modifiedTime: null, size: null },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries bounded transient reads but never retries an authorization failure", async () => {
    const sleeps: number[] = [];
    let transientCalls = 0;
    const transientFetch = vi.fn(async () => {
      transientCalls++;
      return transientCalls === 1
        ? jsonResponse({ error: "busy" }, 503)
        : jsonResponse({ user: { permissionId: "account-a" } });
    }) as unknown as typeof fetch;
    const recovering = new GoogleDriveStateTransport("token-a", {
      fetcher: transientFetch,
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
      random: () => 0,
      retryBaseMs: 10,
      maxAttempts: 3,
    });

    await expect(recovering.getAccount()).resolves.toMatchObject({ permissionId: "account-a" });
    expect(sleeps).toEqual([10]);

    const deniedFetch = vi.fn(async () => jsonResponse({ error: "expired" }, 401)) as unknown as typeof fetch;
    const denied = new GoogleDriveStateTransport("bad-token", {
      fetcher: deniedFetch,
      sleep: async () => undefined,
    });
    await expect(denied.getAccount()).rejects.toMatchObject({
      status: 401,
      authorizationFailed: true,
    });
    expect(deniedFetch).toHaveBeenCalledTimes(1);
  });

  it("refuses to update another device's Drive document", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const transport = new GoogleDriveStateTransport("token-a", { fetcher });
    const state = applyBooleanChange(emptySyncState(), DEVICE_A, "movie:1", "seen", true, NOW);

    await expect(
      transport.writeOwnedStateFile(DEVICE_A, file(DEVICE_B), envelope(DEVICE_A, state)),
    ).rejects.toThrow("another device");
    await expect(
      transport.writeOwnedStateFile(DEVICE_A, null, envelope(DEVICE_B, state)),
    ).rejects.toThrow("another device");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("re-lists after an ambiguous create before retrying the write", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("uploadType=multipart")) {
        calls.push("create");
        throw new TypeError("response lost");
      }
      if (url.includes("/drive/v3/files?")) {
        calls.push("list");
        return jsonResponse({ files: [{ id: "recovered", name: syncFileName(DEVICE_A) }] });
      }
      if (url.includes("/files/recovered?uploadType=media")) {
        calls.push("update");
        expect(init?.method).toBe("PATCH");
        return jsonResponse({ id: "recovered", name: syncFileName(DEVICE_A) });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    }) as unknown as typeof fetch;
    const transport = new GoogleDriveStateTransport("token-a", {
      fetcher,
      sleep: async () => undefined,
      maxAttempts: 1,
    });

    await transport.writeOwnedStateFile(DEVICE_A, null, envelope(DEVICE_A, emptySyncState()));
    expect(calls).toEqual(["create", "list", "update"]);
  });
});

describe("Drive token session and authorization", () => {
  const grant: DriveAccessGrant = {
    accessToken: "token-a",
    expiresAt: 2_000_000,
    scope: DRIVE_APPDATA_SCOPE,
  };

  it("restores only a scoped, unexpired grant and purges everything else", () => {
    const storage = new MemoryStorage();
    saveDriveGrant(grant, storage, 1_000_000);
    expect(loadDriveGrant(storage, 1_000_000)).toEqual(grant);

    expect(loadDriveGrant(storage, grant.expiresAt)).toBeNull();
    expect(storage.values.has(DRIVE_SESSION_KEY)).toBe(false);

    storage.values.set(DRIVE_SESSION_KEY, JSON.stringify({
      version: 1,
      grant: { ...grant, scope: "some-other-scope" },
    }));
    expect(loadDriveGrant(storage, 1_000_000)).toBeNull();
    expect(storage.values.has(DRIVE_SESSION_KEY)).toBe(false);
  });

  it("coalesces simultaneous authorization requests", async () => {
    const storage = new MemoryStorage();
    let resolveGrant!: (value: DriveAccessGrant) => void;
    const requester = vi.fn(() => new Promise<DriveAccessGrant>((resolve) => {
      resolveGrant = resolve;
    }));
    const authorization = new DriveAuthorizationCoordinator(requester, storage, () => 1_000_000);

    const first = authorization.requestNew({ prompt: "" });
    const second = authorization.requestNew({ prompt: "select_account" });
    expect(first).toBe(second);
    expect(requester).toHaveBeenCalledTimes(1);
    resolveGrant(grant);

    await expect(first).resolves.toEqual(grant);
    expect(authorization.currentGrant()).toEqual(grant);
  });
});

describe("Drive sync engine", () => {
  it("merges valid documents, ignores corrupt ones, saves locally, then updates only its own file", async () => {
    const local = applyBooleanChange(emptySyncState(), DEVICE_A, "movie:1", "seen", true, NOW);
    const ownEnvelope = envelope(DEVICE_A, local);
    const remote = applyBooleanChange(
      emptySyncState(),
      DEVICE_B,
      "tv:2",
      "seen",
      true,
      "2024-09-02T13:00:00.000Z",
    );
    const ownFile = file(DEVICE_A, "own-file");
    const remoteFile = file(DEVICE_B, "remote-file");
    const corruptFile = file(DEVICE_C, "corrupt-file");
    const events: string[] = [];
    const transport: DriveStateTransport = {
      async getAccount() {
        return { permissionId: "account-a", emailAddress: "new@example.test", displayName: "New" };
      },
      async listStateFiles() {
        return [remoteFile, ownFile, corruptFile];
      },
      async downloadStateFile(candidate) {
        if (candidate.id === "own-file") return JSON.stringify(ownEnvelope);
        if (candidate.id === "remote-file") return JSON.stringify(envelope(DEVICE_B, remote));
        return "{broken";
      },
      async writeOwnedStateFile(deviceId, existing, written) {
        events.push("write-drive");
        expect(deviceId).toBe(DEVICE_A);
        expect(existing?.id).toBe("own-file");
        expect(written.state.titles["tv:2"]?.seen?.value).toBe(true);
        return ownFile;
      },
    };
    const store = new MemorySyncStore(local, boundMetadata());
    const originalSave = store.saveState.bind(store);
    store.saveState = (state) => {
      events.push("save-local");
      originalSave(state);
    };

    const result = await new DriveSyncEngine(transport, store, () => "2024-09-02T14:00:00.000Z")
      .synchronize();

    expect(result.write).toBe("updated");
    expect(result.remoteFileCount).toBe(3);
    expect(result.validDocumentCount).toBe(2);
    expect(result.warnings).toHaveLength(1);
    expect(store.state.titles["movie:1"]?.seen?.value).toBe(true);
    expect(store.state.titles["tv:2"]?.seen?.value).toBe(true);
    expect(store.metadata.account?.emailAddress).toBe("new@example.test");
    expect(events).toEqual(["save-local", "write-drive"]);
  });

  it("skips an upload when this device already contains the merged state", async () => {
    const state = applyBooleanChange(emptySyncState(), DEVICE_A, "movie:1", "seen", true, NOW);
    const ownFile = file(DEVICE_A);
    const write = vi.fn();
    const transport: DriveStateTransport = {
      getAccount: async () => ({ permissionId: "account-a", emailAddress: null, displayName: null }),
      listStateFiles: async () => [ownFile],
      downloadStateFile: async () => JSON.stringify(envelope(DEVICE_A, state)),
      writeOwnedStateFile: write,
    };
    const store = new MemorySyncStore(state, boundMetadata());

    await expect(new DriveSyncEngine(transport, store, () => NOW).synchronize())
      .resolves.toMatchObject({ write: "unchanged" });
    expect(write).not.toHaveBeenCalled();
  });

  it("stops before remote state access for missing or mismatched account bindings", async () => {
    const list = vi.fn();
    const transport: DriveStateTransport = {
      getAccount: async () => ({ permissionId: "account-b", emailAddress: null, displayName: null }),
      listStateFiles: list,
      downloadStateFile: vi.fn(),
      writeOwnedStateFile: vi.fn(),
    };
    const unbound = new MemorySyncStore(emptySyncState(), {
      version: 1,
      deviceId: DEVICE_A,
      account: null,
    });
    await expect(new DriveSyncEngine(transport, unbound).synchronize())
      .rejects.toBeInstanceOf(SyncAccountNotBoundError);

    const mismatched = new MemorySyncStore(emptySyncState(), boundMetadata());
    await expect(new DriveSyncEngine(transport, mismatched).synchronize())
      .rejects.toBeInstanceOf(SyncAccountMismatchError);
    expect(list).not.toHaveBeenCalled();
  });

  it("includes a local edit made while remote files were downloading", async () => {
    const before = applyBooleanChange(emptySyncState(), DEVICE_A, "movie:1", "seen", true, NOW);
    const during = applyBooleanChange(
      before,
      DEVICE_A,
      "tv:2",
      "seen",
      true,
      "2024-09-02T13:00:00.000Z",
    );
    const store = new MemorySyncStore(before, boundMetadata());
    let loadCount = 0;
    store.loadState = () => ++loadCount === 1 ? before : during;
    const written: SyncEnvelopeV1[] = [];
    const transport: DriveStateTransport = {
      getAccount: async () => ({ permissionId: "account-a", emailAddress: null, displayName: null }),
      listStateFiles: async () => [],
      downloadStateFile: vi.fn(),
      writeOwnedStateFile: async (_deviceId, _existing, value) => {
        written.push(value);
        return file(DEVICE_A);
      },
    };

    await new DriveSyncEngine(transport, store, () => "2024-09-02T14:00:00.000Z").synchronize();
    expect(store.state.titles["tv:2"]?.seen?.value).toBe(true);
    expect(written[0]?.state.titles["tv:2"]?.seen?.value).toBe(true);
  });

  it("can explicitly replace local state from Drive without merging local-only titles", async () => {
    const local = applyBooleanChange(emptySyncState(), DEVICE_A, "movie:1", "seen", true, NOW);
    const remote = applyBooleanChange(emptySyncState(), DEVICE_B, "tv:2", "seen", true, NOW);
    const remoteFile = file(DEVICE_B);
    const writes: SyncEnvelopeV1[] = [];
    const transport: DriveStateTransport = {
      getAccount: async () => ({ permissionId: "account-a", emailAddress: null, displayName: null }),
      listStateFiles: async () => [remoteFile],
      downloadStateFile: async () => JSON.stringify(envelope(DEVICE_B, remote)),
      writeOwnedStateFile: async (_deviceId, _existing, value) => {
        writes.push(value);
        return file(DEVICE_A);
      },
    };
    const store = new MemorySyncStore(local, boundMetadata());

    await new DriveSyncEngine(transport, store, () => NOW)
      .synchronize({ localState: "remote" });

    expect(store.state.titles["movie:1"]).toBeUndefined();
    expect(store.state.titles["tv:2"]?.seen?.value).toBe(true);
    expect(writes[0]?.state).toEqual(store.state);
  });
});

describe("sync request coordination", () => {
  it("coalesces overlapping runs and performs one follow-up pass for intervening changes", async () => {
    const resolvers: Array<(value: number) => void> = [];
    const task = vi.fn(() => new Promise<number>((resolve) => resolvers.push(resolve)));
    const coordinator = new SyncCoordinator(task);

    const first = coordinator.flush();
    const overlapping = coordinator.flush();
    expect(overlapping).toBe(first);
    expect(task).toHaveBeenCalledTimes(1);

    resolvers[0]?.(1);
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(2));
    resolvers[1]?.(2);
    await expect(first).resolves.toBe(2);
  });

  it("debounces idle changes and folds a scheduled active-run change into one follow-up", async () => {
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    const resolvers: Array<(value: number) => void> = [];
    const task = vi.fn(() => new Promise<number>((resolve) => resolvers.push(resolve)));
    const coordinator = new SyncCoordinator(task, {
      debounceMs: 100,
      setTimer(callback) {
        const id = ++nextTimer;
        timers.set(id, () => {
          timers.delete(id);
          callback();
        });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer(timer) {
        timers.delete(timer as unknown as number);
      },
    });

    coordinator.schedule();
    coordinator.schedule();
    expect(timers.size).toBe(1);
    const callback = [...timers.values()][0];
    callback?.();
    expect(task).toHaveBeenCalledTimes(1);

    coordinator.schedule();
    expect(timers.size).toBe(0);
    resolvers[0]?.(1);
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(2));
    resolvers[1]?.(2);
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(2));
  });

  it("invalidates a rejected token and requires a later authorized interaction", async () => {
    const storage = new MemoryStorage();
    const now = 1_000_000;
    const grant: DriveAccessGrant = {
      accessToken: "expired-remotely",
      expiresAt: now + 60_000,
      scope: DRIVE_APPDATA_SCOPE,
    };
    saveDriveGrant(grant, storage, now);
    const authorization = new DriveAuthorizationCoordinator(
      vi.fn(async () => grant),
      storage,
      () => now,
    );
    const store = new MemorySyncStore(emptySyncState(), boundMetadata());
    const service = new DriveSyncService(
      authorization,
      store,
      () => ({
        getAccount: async () => { throw new DriveRequestError("expired", 401, false); },
        listStateFiles: vi.fn(),
        downloadStateFile: vi.fn(),
        writeOwnedStateFile: vi.fn(),
      }),
    );

    await expect(service.synchronize()).rejects.toBeInstanceOf(DriveAuthorizationRequiredError);
    expect(loadDriveGrant(storage, now)).toBeNull();
    await expect(service.synchronize()).rejects.toBeInstanceOf(DriveAuthorizationRequiredError);
  });

  it("authorizes and inspects an account without silently binding it", async () => {
    const storage = new MemoryStorage();
    const now = 1_000_000;
    const grant: DriveAccessGrant = {
      accessToken: "new-token",
      expiresAt: now + 60_000,
      scope: DRIVE_APPDATA_SCOPE,
    };
    const authorization = new DriveAuthorizationCoordinator(
      vi.fn(async () => grant),
      storage,
      () => now,
    );
    const store = new MemorySyncStore(emptySyncState(), {
      version: 1,
      deviceId: DEVICE_A,
      account: null,
    });
    const service = new DriveSyncService(authorization, store, () => ({
      getAccount: async () => ({
        permissionId: "account-a",
        emailAddress: "viewer@example.test",
        displayName: "Viewer",
      }),
      listStateFiles: vi.fn(),
      downloadStateFile: vi.fn(),
      writeOwnedStateFile: vi.fn(),
    }));

    await expect(service.authorizeAndInspectAccount({ prompt: "select_account" })).resolves
      .toMatchObject({ permissionId: "account-a" });
    expect(store.metadata.account).toBeNull();
  });
});
