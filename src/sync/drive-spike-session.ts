import type { DriveProbeResult } from "./drive-spike.js";
import type { DriveAccessGrant } from "./google-identity.js";

const STORAGE_KEY = "flixate:drive-oauth-spike-session:v1";
const EXPIRY_SKEW_MS = 30_000;

export type RememberedDriveAccount = DriveProbeResult["account"];

type StoredDriveSpikeSession = {
  version: 1;
  account: RememberedDriveAccount | null;
  grant: DriveAccessGrant | null;
};

export type DriveSpikeSession = {
  account: RememberedDriveAccount | null;
  grant: DriveAccessGrant | null;
};

function emptySession(): DriveSpikeSession {
  return { account: null, grant: null };
}

function isAccount(value: unknown): value is RememberedDriveAccount {
  if (!value || typeof value !== "object") return false;
  const account = value as Partial<RememberedDriveAccount>;
  return typeof account.permissionId === "string"
    && (account.displayName === null || typeof account.displayName === "string")
    && (account.emailAddress === null || typeof account.emailAddress === "string");
}

function isGrant(value: unknown, now: number): value is DriveAccessGrant {
  if (!value || typeof value !== "object") return false;
  const grant = value as Partial<DriveAccessGrant>;
  return typeof grant.accessToken === "string"
    && typeof grant.expiresAt === "number"
    && grant.expiresAt > now + EXPIRY_SKEW_MS
    && typeof grant.scope === "string";
}

export function loadDriveSpikeSession(
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
  now = Date.now(),
): DriveSpikeSession {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptySession();
    const stored = JSON.parse(raw) as Partial<StoredDriveSpikeSession>;
    const account = isAccount(stored.account) ? stored.account : null;
    const grant = isGrant(stored.grant, now) ? stored.grant : null;

    if (stored.version !== 1) return emptySession();
    if (stored.grant && !grant) {
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, account, grant: null }));
    }
    return { account, grant };
  } catch {
    return emptySession();
  }
}

export function saveDriveSpikeSession(
  session: DriveSpikeSession,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...session }));
  } catch {
    // The probe still works in memory when storage is disabled or full.
  }
}

export function forgetDriveSpikeToken(
  account: RememberedDriveAccount | null,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  saveDriveSpikeSession({ account, grant: null }, storage);
}
