import { describe, expect, it, vi } from "vitest";
import { runDriveProbe } from "../src/sync/drive-spike.js";
import {
  forgetDriveSpikeToken,
  loadDriveSpikeSession,
  saveDriveSpikeSession,
} from "../src/sync/drive-spike-session.js";
import {
  DRIVE_APPDATA_SCOPE,
  requestDriveAccess,
  type GoogleOAuth2,
} from "../src/sync/google-identity.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Google Drive feasibility probe", () => {
  it("requests only private app-data access and keeps the returned token in its result", async () => {
    let requestedScope = "";
    let requestedClientId = "";
    const oauth2: GoogleOAuth2 = {
      initTokenClient(config) {
        requestedScope = config.scope;
        requestedClientId = config.client_id;
        return {
          requestAccessToken(options) {
            expect(options).toEqual({ prompt: "select_account", login_hint: undefined });
            config.callback({
              access_token: "memory-only-token",
              expires_in: 3_600,
              scope: DRIVE_APPDATA_SCOPE,
            });
          },
        };
      },
    };

    const grant = await requestDriveAccess(oauth2, "public-client-id", { prompt: "select_account" });

    expect(requestedClientId).toBe("public-client-id");
    expect(requestedScope).toBe(DRIVE_APPDATA_SCOPE);
    expect(grant.accessToken).toBe("memory-only-token");
    expect(grant.scope).toBe(DRIVE_APPDATA_SCOPE);
    expect(grant.expiresAt).toBeGreaterThan(Date.now());
  });

  it("can skip repeat account selection with a remembered login hint", async () => {
    let requestOptions: { prompt?: string; login_hint?: string } | undefined;
    const oauth2: GoogleOAuth2 = {
      initTokenClient(config) {
        return {
          requestAccessToken(options) {
            requestOptions = options;
            config.callback({ access_token: "fresh-token", expires_in: 3_600 });
          },
        };
      },
    };

    await requestDriveAccess(oauth2, "public-client-id", {
      prompt: "",
      loginHint: "viewer@example.com",
    });

    expect(requestOptions).toEqual({ prompt: "", login_hint: "viewer@example.com" });
  });

  it("restores only an unexpired saved token while retaining the account after expiry", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const account = { permissionId: "account-1", displayName: "Viewer", emailAddress: "viewer@example.com" };
    const now = 1_000_000;

    saveDriveSpikeSession({
      account,
      grant: { accessToken: "saved-token", expiresAt: now + 60_000, scope: DRIVE_APPDATA_SCOPE },
    }, storage);
    expect(loadDriveSpikeSession(storage, now).grant?.accessToken).toBe("saved-token");

    expect(loadDriveSpikeSession(storage, now + 60_000)).toEqual({ account, grant: null });
    forgetDriveSpikeToken(account, storage);
    expect(loadDriveSpikeSession(storage, now)).toEqual({ account, grant: null });
  });

  it("creates and validates an isolated appDataFolder probe file", async () => {
    let writtenPayload: unknown;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/about?")) {
        return jsonResponse({ user: { permissionId: "account-1", displayName: "Test User" } });
      }
      if (url.includes("uploadType=multipart")) {
        const body = String(init?.body);
        expect(body).toContain('"parents":["appDataFolder"]');
        const match = body.match(/\{"format":"flixate-oauth-spike"[^\r]+/);
        expect(match).not.toBeNull();
        writtenPayload = JSON.parse(match![0]!);
        return jsonResponse({ id: "probe-file", name: "flixate-oauth-spike.json" });
      }
      if (url.includes("/drive/v3/files?")) return jsonResponse({ files: [] });
      if (url.endsWith("/files/probe-file?alt=media")) return jsonResponse(writtenPayload);
      return jsonResponse({ error: "unexpected request" }, 500);
    });
    const fetcher = fetchMock as unknown as typeof fetch;

    const result = await runDriveProbe("temporary-token", fetcher);

    expect(result.account.permissionId).toBe("account-1");
    expect(result.fileAction).toBe("created");
    expect(result.fileId).toBe("probe-file");
    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const call of fetchMock.mock.calls) {
      expect(new Headers(call[1]?.headers).get("Authorization")).toBe("Bearer temporary-token");
    }
  });

  it("updates an existing probe and rejects a mismatched download", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/about?")) {
        return jsonResponse({ user: { permissionId: "account-1" } });
      }
      if (url.includes("/drive/v3/files?")) {
        return jsonResponse({ files: [{ id: "existing-probe", name: "flixate-oauth-spike.json" }] });
      }
      if (url.includes("uploadType=media")) {
        expect(init?.method).toBe("PATCH");
        return jsonResponse({ id: "existing-probe", name: "flixate-oauth-spike.json" });
      }
      if (url.endsWith("/files/existing-probe?alt=media")) {
        return jsonResponse({ format: "flixate-oauth-spike", version: 1, nonce: "wrong" });
      }
      return jsonResponse({ error: "unexpected request" }, 500);
    }) as unknown as typeof fetch;

    await expect(runDriveProbe("temporary-token", fetcher)).rejects.toThrow(
      "returned different probe data",
    );
  });
});
