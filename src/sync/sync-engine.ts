import { DriveRequestError, type DriveStateFile, type DriveStateTransport } from "./drive-transport.js";
import {
  SyncAccountMismatchError,
  bindSyncAccount,
  type SyncMetadataV1,
} from "./sync-metadata.js";
import {
  createSyncEnvelope,
  mergeSyncStates,
  parseSyncEnvelope,
  syncFileName,
  type SyncEnvelopeV1,
  type SyncStateV1,
} from "./sync-state.js";

export interface SyncStateStore {
  loadState(): SyncStateV1 | Promise<SyncStateV1>;
  saveState(state: SyncStateV1): void | Promise<void>;
  loadMetadata(): SyncMetadataV1 | Promise<SyncMetadataV1>;
  saveMetadata(metadata: SyncMetadataV1): void | Promise<void>;
}

export type SyncWarning = {
  fileId: string;
  fileName: string;
  message: string;
};

export type DriveSyncResult = {
  accountPermissionId: string;
  remoteFileCount: number;
  validDocumentCount: number;
  warnings: SyncWarning[];
  write: "created" | "updated" | "unchanged";
  state: SyncStateV1;
};

export type DriveSyncOptions = {
  localState?: "merge" | "remote";
};

export class SyncAccountNotBoundError extends Error {
  constructor() {
    super("This browser has not confirmed which Google Drive account it should synchronize with.");
    this.name = "SyncAccountNotBoundError";
  }
}

type DownloadedDocument = {
  file: DriveStateFile;
  envelope: SyncEnvelopeV1;
};

function newestFirst(a: DriveStateFile, b: DriveStateFile): number {
  return (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? "");
}

function sameState(a: SyncStateV1, b: SyncStateV1): boolean {
  return JSON.stringify(mergeSyncStates(a)) === JSON.stringify(mergeSyncStates(b));
}

export class DriveSyncEngine {
  constructor(
    private readonly transport: DriveStateTransport,
    private readonly store: SyncStateStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async synchronize(options: DriveSyncOptions = {}): Promise<DriveSyncResult> {
    const metadata = await this.store.loadMetadata();
    if (!metadata.account) throw new SyncAccountNotBoundError();

    const account = await this.transport.getAccount();
    if (account.permissionId !== metadata.account.permissionId) {
      throw new SyncAccountMismatchError(metadata.account.permissionId, account.permissionId);
    }
    await this.store.saveMetadata(bindSyncAccount(metadata, account, this.now()));

    const files = (await this.transport.listStateFiles()).sort(newestFirst);
    const warnings: SyncWarning[] = [];
    const documents: DownloadedDocument[] = [];
    for (const file of files) {
      const expectedDeviceId = file.name.slice("flixate-state-".length, -".json".length);
      const text = await this.transport.downloadStateFile(file);
      try {
        const envelope = parseSyncEnvelope(text);
        if (envelope.deviceId !== expectedDeviceId) {
          throw new Error("The document owner does not match its Drive filename.");
        }
        documents.push({ file, envelope });
      } catch (error) {
        warnings.push({
          fileId: file.id,
          fileName: file.name,
          message: error instanceof Error ? error.message : "The sync document is invalid.",
        });
      }
    }

    const mergedRemote = mergeSyncStates(...documents.map(({ envelope }) => envelope.state));
    if (options.localState === "remote" && files.length > 0 && documents.length === 0) {
      throw new Error("Drive contains Flixate state files, but none could be read safely.");
    }

    // Re-read just before committing so local edits made during Drive downloads are
    // included. An explicit first-connect replacement is the sole exception.
    let merged = mergedRemote;
    if (options.localState !== "remote") {
      const initialLocal = await this.store.loadState();
      const latestLocal = await this.store.loadState();
      merged = mergeSyncStates(initialLocal, mergedRemote, latestLocal);
    }
    await this.store.saveState(merged);

    const ownedName = syncFileName(metadata.deviceId);
    const ownedFiles = files.filter((file) => file.name === ownedName);
    const existing = ownedFiles[0] ?? null;
    if (ownedFiles.length > 1) {
      warnings.push({
        fileId: existing?.id ?? "unknown",
        fileName: ownedName,
        message: `Google Drive contains ${ownedFiles.length} documents for this device; the newest one will be updated.`,
      });
    }
    const existingDocument = existing
      ? documents.find(({ file }) => file.id === existing.id)?.envelope
      : undefined;
    if (existingDocument && sameState(existingDocument.state, merged)) {
      return {
        accountPermissionId: account.permissionId,
        remoteFileCount: files.length,
        validDocumentCount: documents.length,
        warnings,
        write: "unchanged",
        state: merged,
      };
    }

    const envelope = createSyncEnvelope(metadata.deviceId, merged, this.now());
    await this.transport.writeOwnedStateFile(metadata.deviceId, existing, envelope);
    return {
      accountPermissionId: account.permissionId,
      remoteFileCount: files.length,
      validDocumentCount: documents.length,
      warnings,
      write: existing ? "updated" : "created",
      state: merged,
    };
  }
}

export function isDriveAuthorizationError(error: unknown): boolean {
  return error instanceof DriveRequestError && error.authorizationFailed;
}
