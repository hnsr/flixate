export const SYNC_METADATA_KEY = "flixate:sync-metadata:v1";

const DEVICE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SyncAccountIdentity = {
  permissionId: string;
  emailAddress: string | null;
  displayName: string | null;
};

export type SyncAccountBindingV1 = SyncAccountIdentity & {
  connectedAt: string;
};

export type SyncMetadataV1 = {
  version: 1;
  deviceId: string;
  account: SyncAccountBindingV1 | null;
};

type SyncMetadataStorage = Pick<Storage, "getItem" | "setItem">;

export class SyncAccountMismatchError extends Error {
  constructor(
    readonly currentPermissionId: string,
    readonly requestedPermissionId: string,
  ) {
    super("The connected Google account does not match this browser's saved sync account.");
    this.name = "SyncAccountMismatchError";
  }
}

export function isDeviceId(value: unknown): value is string {
  return typeof value === "string" && DEVICE_ID_PATTERN.test(value);
}

function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseAccountBinding(value: unknown): SyncAccountBindingV1 | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") {
    throw new Error("Sync account metadata is malformed.");
  }
  const candidate = value as Partial<SyncAccountBindingV1>;
  if (
    typeof candidate.permissionId !== "string" ||
    candidate.permissionId.length === 0 ||
    !isNullableString(candidate.emailAddress) ||
    !isNullableString(candidate.displayName) ||
    !isCanonicalIsoDate(candidate.connectedAt)
  ) {
    throw new Error("Sync account metadata is malformed.");
  }
  return {
    permissionId: candidate.permissionId,
    emailAddress: candidate.emailAddress,
    displayName: candidate.displayName,
    connectedAt: candidate.connectedAt,
  };
}

export function parseSyncMetadata(value: unknown): SyncMetadataV1 {
  if (!value || typeof value !== "object") throw new Error("Sync metadata is malformed.");
  const candidate = value as Partial<SyncMetadataV1>;
  if (candidate.version !== 1 || !isDeviceId(candidate.deviceId)) {
    throw new Error("Sync metadata is malformed or unsupported.");
  }
  return {
    version: 1,
    deviceId: candidate.deviceId,
    account: parseAccountBinding(candidate.account),
  };
}

export function saveSyncMetadata(storage: SyncMetadataStorage, metadata: SyncMetadataV1): void {
  storage.setItem(SYNC_METADATA_KEY, JSON.stringify(parseSyncMetadata(metadata)));
}

export function loadOrCreateSyncMetadata(
  storage: SyncMetadataStorage,
  createDeviceId: () => string = () => crypto.randomUUID(),
): SyncMetadataV1 {
  try {
    const raw = storage.getItem(SYNC_METADATA_KEY);
    if (raw) return parseSyncMetadata(JSON.parse(raw));
  } catch {
    // Replace unreadable or malformed local metadata with a fresh, valid identity.
  }

  const deviceId = createDeviceId();
  if (!isDeviceId(deviceId)) throw new Error("The generated sync device ID is not a valid UUID.");
  const metadata: SyncMetadataV1 = { version: 1, deviceId, account: null };
  saveSyncMetadata(storage, metadata);
  return metadata;
}

export function bindSyncAccount(
  metadata: SyncMetadataV1,
  identity: SyncAccountIdentity,
  now = new Date().toISOString(),
  options: { allowReplacement?: boolean } = {},
): SyncMetadataV1 {
  if (!identity.permissionId) throw new Error("Google Drive did not return an account ID.");
  if (!isNullableString(identity.emailAddress) || !isNullableString(identity.displayName)) {
    throw new Error("Google Drive returned malformed account details.");
  }
  if (!isCanonicalIsoDate(now)) throw new Error("The account connection time is invalid.");

  const existing = metadata.account;
  if (
    existing &&
    existing.permissionId !== identity.permissionId &&
    !options.allowReplacement
  ) {
    throw new SyncAccountMismatchError(existing.permissionId, identity.permissionId);
  }

  return {
    ...parseSyncMetadata(metadata),
    account: {
      ...identity,
      connectedAt: existing?.permissionId === identity.permissionId ? existing.connectedAt : now,
    },
  };
}

export function clearSyncAccount(metadata: SyncMetadataV1): SyncMetadataV1 {
  return { ...parseSyncMetadata(metadata), account: null };
}
