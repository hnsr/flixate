import type { SyncAccountIdentity } from "./sync-metadata.js";
import { isDeviceId } from "./sync-metadata.js";
import {
  parseSyncEnvelope,
  syncFileName,
  type SyncEnvelopeV1,
} from "./sync-state.js";

const DRIVE_API_URL = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3";
const STATE_FILE_PREFIX = "flixate-state-";

export type DriveStateFile = {
  id: string;
  name: string;
  modifiedTime: string | null;
  size: number | null;
};

export interface DriveStateTransport {
  getAccount(): Promise<SyncAccountIdentity>;
  listStateFiles(): Promise<DriveStateFile[]>;
  downloadStateFile(file: DriveStateFile): Promise<string>;
  deleteStateFile(file: DriveStateFile): Promise<void>;
  writeOwnedStateFile(
    deviceId: string,
    existing: DriveStateFile | null,
    envelope: SyncEnvelopeV1,
  ): Promise<DriveStateFile>;
}

export type DriveTransportOptions = {
  fetcher?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  maxAttempts?: number;
  retryBaseMs?: number;
};

export class DriveRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "DriveRequestError";
  }

  get authorizationFailed(): boolean {
    return this.status === 401 || (this.status === 403 && !this.retryable);
  }
}

type DriveFileResponse = {
  id?: string;
  name?: string;
  modifiedTime?: string;
  size?: string;
};

type DriveListResponse = {
  nextPageToken?: string;
  files?: DriveFileResponse[];
};

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function responseFile(value: DriveFileResponse): DriveStateFile {
  if (!value.id || !value.name) throw new Error("Google Drive returned a file without an ID or name.");
  const parsedSize = value.size === undefined ? null : Number(value.size);
  return {
    id: value.id,
    name: value.name,
    modifiedTime: value.modifiedTime ?? null,
    size: parsedSize !== null && Number.isFinite(parsedSize) ? parsedSize : null,
  };
}

export function deviceIdFromSyncFileName(name: string): string | null {
  if (!name.startsWith(STATE_FILE_PREFIX) || !name.endsWith(".json")) return null;
  const deviceId = name.slice(STATE_FILE_PREFIX.length, -".json".length);
  return isDeviceId(deviceId) ? deviceId : null;
}

function cleanErrorDetail(text: string): string {
  return text.slice(0, 300).replace(/\s+/g, " ").trim();
}

function isRetryableStatus(status: number, detail: string): boolean {
  return status === 408
    || status === 429
    || status >= 500
    || (status === 403 && /(?:user)?rateLimitExceeded|backendError/i.test(detail));
}

export class GoogleDriveStateTransport implements DriveStateTransport {
  private readonly fetcher: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;

  constructor(
    private readonly accessToken: string,
    options: DriveTransportOptions = {},
  ) {
    if (!accessToken) throw new Error("A Google Drive access token is required.");
    this.fetcher = options.fetcher ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    this.maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
    this.retryBaseMs = Math.max(0, options.retryBaseMs ?? 250);
  }

  async getAccount(): Promise<SyncAccountIdentity> {
    const about = await this.requestJson<{
      user?: { permissionId?: string; displayName?: string; emailAddress?: string };
    }>(`${DRIVE_API_URL}/about?fields=user(permissionId,displayName,emailAddress)`);
    if (!about.user?.permissionId) {
      throw new Error("Google Drive did not return an account identifier.");
    }
    return {
      permissionId: about.user.permissionId,
      displayName: about.user.displayName ?? null,
      emailAddress: about.user.emailAddress ?? null,
    };
  }

  async listStateFiles(): Promise<DriveStateFile[]> {
    const files: DriveStateFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        spaces: "appDataFolder",
        q: `name contains '${STATE_FILE_PREFIX}' and trashed = false`,
        orderBy: "modifiedTime desc",
        pageSize: "100",
        fields: "nextPageToken,files(id,name,modifiedTime,size)",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await this.requestJson<DriveListResponse>(`${DRIVE_API_URL}/files?${params}`);
      for (const candidate of page.files ?? []) {
        if (candidate.name && deviceIdFromSyncFileName(candidate.name)) {
          files.push(responseFile(candidate));
        }
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return files;
  }

  downloadStateFile(file: DriveStateFile): Promise<string> {
    return this.requestText(
      `${DRIVE_API_URL}/files/${encodeURIComponent(file.id)}?alt=media`,
    );
  }

  async deleteStateFile(file: DriveStateFile): Promise<void> {
    if (!deviceIdFromSyncFileName(file.name)) {
      throw new Error("Refusing to delete a non-Flixate Drive document.");
    }
    try {
      await this.requestText(
        `${DRIVE_API_URL}/files/${encodeURIComponent(file.id)}`,
        { method: "DELETE" },
        false,
      );
    } catch (error) {
      if (!(error instanceof DriveRequestError) || error.status !== 404) throw error;
      // A repeated or concurrent deletion already achieved the requested result.
    }
  }

  async writeOwnedStateFile(
    deviceId: string,
    existing: DriveStateFile | null,
    envelope: SyncEnvelopeV1,
  ): Promise<DriveStateFile> {
    const ownedName = syncFileName(deviceId);
    if (envelope.deviceId !== deviceId) {
      throw new Error("Refusing to upload a sync envelope owned by another device.");
    }
    parseSyncEnvelope(envelope);

    if (existing) {
      if (existing.name !== ownedName) {
        throw new Error("Refusing to update another device's sync document.");
      }
      return this.updateFile(existing.id, envelope);
    }

    try {
      return await this.createFile(ownedName, envelope);
    } catch (error) {
      if (!(error instanceof DriveRequestError) || !error.retryable) throw error;

      // A create may have succeeded even if its response was lost. Re-list before
      // retrying so an ambiguous network failure does not blindly create duplicates.
      await this.waitBeforeRetry(0);
      const recovered = (await this.listStateFiles()).find((file) => file.name === ownedName);
      if (recovered) return this.updateFile(recovered.id, envelope);
      return this.createFile(ownedName, envelope);
    }
  }

  private async updateFile(fileId: string, envelope: SyncEnvelopeV1): Promise<DriveStateFile> {
    const response = await this.requestJson<DriveFileResponse>(
      `${DRIVE_UPLOAD_URL}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,modifiedTime,size`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
      },
    );
    return responseFile(response);
  }

  private async createFile(name: string, envelope: SyncEnvelopeV1): Promise<DriveStateFile> {
    const boundary = `flixate-${crypto.randomUUID()}`;
    const body = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify({ name, mimeType: "application/json", parents: ["appDataFolder"] }),
      `--${boundary}`,
      "Content-Type: application/json",
      "",
      JSON.stringify(envelope),
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const response = await this.requestJson<DriveFileResponse>(
      `${DRIVE_UPLOAD_URL}/files?uploadType=multipart&fields=id,name,modifiedTime,size`,
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      },
      false,
    );
    return responseFile(response);
  }

  private async requestJson<T>(
    input: string,
    init: RequestInit = {},
    safeToRetry = true,
  ): Promise<T> {
    const text = await this.requestText(input, init, safeToRetry);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new DriveRequestError("Google Drive returned malformed JSON.", null, false);
    }
  }

  private async requestText(
    input: string,
    init: RequestInit = {},
    safeToRetry = true,
  ): Promise<string> {
    const attempts = safeToRetry ? this.maxAttempts : 1;
    let lastError: DriveRequestError | null = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${this.accessToken}`);
        // Keep fetch as a plain function call. Some browser implementations reject
        // a native fetch invoked with this transport instance as its receiver.
        const fetcher = this.fetcher;
        const response = await fetcher(input, { ...init, headers });
        if (response.ok) return response.text();
        const detail = cleanErrorDetail(await response.text());
        const error = new DriveRequestError(
          `Google Drive returned ${response.status}${detail ? `: ${detail}` : "."}`,
          response.status,
          isRetryableStatus(response.status, detail),
        );
        if (!error.retryable || attempt === attempts - 1) throw error;
        lastError = error;
      } catch (error) {
        if (error instanceof DriveRequestError && !error.retryable) throw error;
        const reason = error instanceof Error ? cleanErrorDetail(error.message) : "";
        lastError = error instanceof DriveRequestError
          ? error
          : new DriveRequestError(
              `Google Drive could not be reached${reason ? `: ${reason}` : "."}`,
              null,
              true,
            );
        if (!safeToRetry || attempt === attempts - 1) throw lastError;
      }
      await this.waitBeforeRetry(attempt);
    }
    throw lastError ?? new DriveRequestError("Google Drive could not be reached.", null, true);
  }

  private waitBeforeRetry(attempt: number): Promise<void> {
    const exponential = this.retryBaseMs * 2 ** attempt;
    const jitter = exponential * 0.25 * this.random();
    return this.sleep(exponential + jitter);
  }
}
