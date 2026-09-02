import {
  DRIVE_APPDATA_SCOPE,
  loadGoogleIdentity,
  requestDriveAccess,
  type DriveAccessGrant,
  type DriveAccessRequest,
} from "./google-identity.js";

export const DRIVE_SESSION_KEY = "flixate:drive-session:v1";
export const DRIVE_TOKEN_EXPIRY_SKEW_MS = 30_000;

type DriveSessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StoredDriveSessionV1 = {
  version: 1;
  grant: DriveAccessGrant;
};

export type DriveGrantRequester = (request: DriveAccessRequest) => Promise<DriveAccessGrant>;

function hasAppDataScope(scope: string): boolean {
  return scope.split(/\s+/).includes(DRIVE_APPDATA_SCOPE);
}

export function isUsableDriveGrant(
  value: unknown,
  now = Date.now(),
): value is DriveAccessGrant {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DriveAccessGrant>;
  return typeof candidate.accessToken === "string"
    && candidate.accessToken.length > 0
    && typeof candidate.expiresAt === "number"
    && Number.isFinite(candidate.expiresAt)
    && candidate.expiresAt > now + DRIVE_TOKEN_EXPIRY_SKEW_MS
    && typeof candidate.scope === "string"
    && hasAppDataScope(candidate.scope);
}

export function loadDriveGrant(
  storage: DriveSessionStorage = localStorage,
  now = Date.now(),
): DriveAccessGrant | null {
  try {
    const raw = storage.getItem(DRIVE_SESSION_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredDriveSessionV1>;
    if (stored.version === 1 && isUsableDriveGrant(stored.grant, now)) return stored.grant;
    storage.removeItem(DRIVE_SESSION_KEY);
  } catch {
    try {
      storage.removeItem(DRIVE_SESSION_KEY);
    } catch {
      // Continue in memory when browser storage is unavailable.
    }
  }
  return null;
}

export function saveDriveGrant(
  grant: DriveAccessGrant,
  storage: DriveSessionStorage = localStorage,
  now = Date.now(),
): void {
  if (!isUsableDriveGrant(grant, now)) {
    throw new Error("Google returned an expired token or omitted the Drive app-data scope.");
  }
  try {
    storage.setItem(DRIVE_SESSION_KEY, JSON.stringify({ version: 1, grant }));
  } catch {
    // The active page can still use the in-memory token.
  }
}

export function clearDriveGrant(storage: Pick<Storage, "removeItem"> = localStorage): void {
  try {
    storage.removeItem(DRIVE_SESSION_KEY);
  } catch {
    // There is no persisted token to clear when storage is unavailable.
  }
}

export class DriveAuthorizationCoordinator {
  private inFlight: Promise<DriveAccessGrant> | null = null;
  private memoryGrant: DriveAccessGrant | null;

  constructor(
    private readonly requestGrant: DriveGrantRequester,
    private readonly storage: DriveSessionStorage = localStorage,
    private readonly now: () => number = Date.now,
  ) {
    this.memoryGrant = loadDriveGrant(storage, now());
  }

  currentGrant(): DriveAccessGrant | null {
    if (this.memoryGrant && isUsableDriveGrant(this.memoryGrant, this.now())) {
      return this.memoryGrant;
    }
    this.memoryGrant = loadDriveGrant(this.storage, this.now());
    return this.memoryGrant;
  }

  getOrRequest(request: DriveAccessRequest = {}): Promise<DriveAccessGrant> {
    const saved = this.currentGrant();
    return saved ? Promise.resolve(saved) : this.requestNew(request);
  }

  requestNew(request: DriveAccessRequest = {}): Promise<DriveAccessGrant> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.requestGrant(request)
      .then((grant) => {
        saveDriveGrant(grant, this.storage, this.now());
        this.memoryGrant = grant;
        return grant;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  invalidate(accessToken?: string): void {
    if (accessToken) {
      const persisted = loadDriveGrant(this.storage, this.now());
      if (persisted && persisted.accessToken !== accessToken) {
        this.memoryGrant = persisted;
        return;
      }
      if (!persisted && this.memoryGrant && this.memoryGrant.accessToken !== accessToken) return;
    }
    this.memoryGrant = null;
    clearDriveGrant(this.storage);
  }
}

export function createBrowserDriveAuthorization(
  clientId: string,
  storage: DriveSessionStorage = localStorage,
): DriveAuthorizationCoordinator {
  if (!clientId) throw new Error("The public Google OAuth client ID is missing.");
  return new DriveAuthorizationCoordinator(async (request) => {
    const oauth2 = await loadGoogleIdentity();
    return requestDriveAccess(oauth2, clientId, request);
  }, storage);
}
