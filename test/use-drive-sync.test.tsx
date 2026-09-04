import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDriveSync } from "../src/hooks/use-drive-sync.js";
import { saveDriveGrant } from "../src/sync/drive-session.js";
import type { SyncStateStore } from "../src/sync/sync-engine.js";
import {
  DRIVE_APPDATA_SCOPE,
  type GoogleOAuth2,
} from "../src/sync/google-identity.js";
import type { SyncMetadataV1 } from "../src/sync/sync-metadata.js";
import {
  applyBooleanChange,
  emptySyncState,
  syncFileName,
  type SyncStateV1,
} from "../src/sync/sync-state.js";

const DEVICE_A = "00000000-0000-4000-8000-000000000001";

class HookStore implements SyncStateStore {
  state: SyncStateV1 = emptySyncState();

  constructor(public metadata: SyncMetadataV1) {}

  loadState(): SyncStateV1 { return this.state; }
  saveState(state: SyncStateV1): void { this.state = state; }
  loadMetadata(): SyncMetadataV1 { return this.metadata; }
  saveMetadata(metadata: SyncMetadataV1): void { this.metadata = metadata; }
}

function installGoogle(
  requests: Array<{ prompt?: string; login_hint?: string }>,
  includeScope = true,
): void {
  const oauth2: GoogleOAuth2 = {
    initTokenClient(config) {
      return {
        requestAccessToken(options) {
          requests.push(options ?? {});
          config.callback({
            access_token: "test-token",
            expires_in: 3_600,
            ...(includeScope ? { scope: DRIVE_APPDATA_SCOPE } : {}),
          });
        },
      };
    },
  };
  vi.stubGlobal("google", { accounts: { oauth2 } });
}

function installDriveFetch() {
  const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/about?")) {
      return Response.json({
        user: {
          permissionId: "account-a",
          emailAddress: "viewer@example.test",
          displayName: "Viewer",
        },
      });
    }
    if (url.includes("uploadType=multipart")) {
      return Response.json({ id: "own-file", name: syncFileName(DEVICE_A) });
    }
    if (url.includes("/drive/v3/files?")) return Response.json({ files: [] });
    return Response.json({ error: "unexpected" }, { status: 500 });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Drive sync React integration", () => {
  it("inspects an account, waits for an explicit merge choice, then synchronizes", async () => {
    const requests: Array<{ prompt?: string; login_hint?: string }> = [];
    installGoogle(requests, false);
    installDriveFetch();
    const store = new HookStore({ version: 1, deviceId: DEVICE_A, account: null });
    const { result } = renderHook(() => useDriveSync({
      clientId: "public-client-id",
      store,
      metadata: store.metadata,
    }));
    await waitFor(() => expect(result.current.googleReady).toBe(true));

    await act(async () => { await result.current.connect(); });
    expect(requests).toEqual([{ prompt: "select_account", login_hint: undefined }]);
    expect(result.current.pendingAccount?.permissionId).toBe("account-a");
    expect(store.metadata.account).toBeNull();

    await act(async () => { await result.current.confirmConnection("merge"); });
    expect(store.metadata.account?.permissionId).toBe("account-a");
    expect(result.current.status.kind).toBe("synced");
  });

  it("retries account inspection with the saved token instead of reopening Google", async () => {
    const requests: Array<{ prompt?: string; login_hint?: string }> = [];
    installGoogle(requests);
    let accountChecks = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/about?")) {
        accountChecks++;
        if (accountChecks === 1) return new Response("not-json");
        return Response.json({
          user: { permissionId: "account-a", emailAddress: "viewer@example.test" },
        });
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    }));
    const store = new HookStore({ version: 1, deviceId: DEVICE_A, account: null });
    const { result } = renderHook(() => useDriveSync({
      clientId: "public-client-id",
      store,
      metadata: store.metadata,
    }));
    await waitFor(() => expect(result.current.googleReady).toBe(true));

    await act(async () => { await result.current.connect(); });
    expect(result.current.pendingAccount).toBeNull();
    expect(result.current.status.detail).toContain("malformed JSON");
    await act(async () => { await result.current.connect(); });

    expect(result.current.pendingAccount?.permissionId).toBe("account-a");
    expect(requests).toHaveLength(1);
    expect(accountChecks).toBe(2);
  });

  it("uses the next local interaction to reconnect with the remembered account hint", async () => {
    const requests: Array<{ prompt?: string; login_hint?: string }> = [];
    installGoogle(requests);
    installDriveFetch();
    const store = new HookStore({
      version: 1,
      deviceId: DEVICE_A,
      account: {
        permissionId: "account-a",
        emailAddress: "viewer@example.test",
        displayName: "Viewer",
        connectedAt: "2024-09-02T12:00:00.000Z",
      },
    });
    const { result } = renderHook(() => useDriveSync({
      clientId: "public-client-id",
      store,
      metadata: store.metadata,
    }));
    await waitFor(() => expect(result.current.googleReady).toBe(true));
    await waitFor(() => expect(result.current.status.kind).toBe("attention"));
    expect(requests).toEqual([]);

    act(() => { result.current.afterLocalChange(); });
    await waitFor(() => expect(result.current.status.kind).toBe("synced"));
    expect(requests).toEqual([{ prompt: "", login_hint: "viewer@example.test" }]);
  });

  it("automatically flushes locally persisted changes after a reload with a valid saved token", async () => {
    const requests: Array<{ prompt?: string; login_hint?: string }> = [];
    installGoogle(requests);
    const fetcher = installDriveFetch();
    saveDriveGrant({
      accessToken: "saved-token",
      expiresAt: Date.now() + 3_600_000,
      scope: DRIVE_APPDATA_SCOPE,
    });
    const store = new HookStore({
      version: 1,
      deviceId: DEVICE_A,
      account: {
        permissionId: "account-a",
        emailAddress: "viewer@example.test",
        displayName: "Viewer",
        connectedAt: "2024-09-02T12:00:00.000Z",
      },
    });
    store.state = applyBooleanChange(
      emptySyncState(),
      DEVICE_A,
      "movie:1",
      "seen",
      true,
      "2026-09-04T12:00:00.000Z",
    );

    const { result } = renderHook(() => useDriveSync({
      clientId: "public-client-id",
      store,
      metadata: store.metadata,
    }));

    await waitFor(() => expect(result.current.status.kind).toBe("synced"));
    expect(requests).toEqual([]);
    const upload = fetcher.mock.calls.find(([input]) => String(input).includes("uploadType=multipart"));
    expect(upload?.[1]?.body).toContain('"movie:1"');
    expect(upload?.[1]?.body).toContain('"value":true');
  });

  it("restores the previous binding when Drive replacement cannot be read safely", async () => {
    const requests: Array<{ prompt?: string; login_hint?: string }> = [];
    installGoogle(requests);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/about?")) {
        return Response.json({
          user: { permissionId: "account-b", emailAddress: "other@example.test" },
        });
      }
      if (url.includes("/drive/v3/files?")) {
        return Response.json({ files: [{ id: "bad-file", name: syncFileName(DEVICE_A) }] });
      }
      if (url.includes("/files/bad-file?alt=media")) return new Response("{broken");
      return Response.json({ error: "unexpected" }, { status: 500 });
    }));
    const originalMetadata: SyncMetadataV1 = {
      version: 1,
      deviceId: DEVICE_A,
      account: {
        permissionId: "account-a",
        emailAddress: "viewer@example.test",
        displayName: "Viewer",
        connectedAt: "2024-09-02T12:00:00.000Z",
      },
    };
    const store = new HookStore(originalMetadata);
    const { result } = renderHook(() => useDriveSync({
      clientId: "public-client-id",
      store,
      metadata: store.metadata,
    }));
    await waitFor(() => expect(result.current.googleReady).toBe(true));
    await act(async () => { await result.current.connect(); });
    expect(result.current.pendingAccount?.permissionId).toBe("account-b");

    await act(async () => { await result.current.confirmConnection("remote"); });
    expect(store.metadata).toEqual(originalMetadata);
    expect(result.current.status.kind).toBe("attention");
  });
});
