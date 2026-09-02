const DRIVE_API_URL = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3";
const SPIKE_FILE_NAME = "flixate-oauth-spike.json";

type DriveUser = {
  permissionId?: string;
  displayName?: string;
  emailAddress?: string;
};

type DriveFile = {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: string;
};

type SpikePayload = {
  format: "flixate-oauth-spike";
  version: 1;
  nonce: string;
  writtenAt: string;
};

export type DriveProbeResult = {
  account: {
    permissionId: string;
    displayName: string | null;
    emailAddress: string | null;
  };
  fileAction: "created" | "updated";
  fileId: string;
  writtenAt: string;
  timings: {
    accountMs: number;
    listMs: number;
    writeMs: number;
    readMs: number;
    totalMs: number;
  };
};

type Fetcher = typeof fetch;

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

async function driveRequest<T>(
  fetcher: Fetcher,
  accessToken: string,
  input: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetcher(input, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...init.headers,
    },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300).replace(/\s+/g, " ").trim();
    throw new Error(`Google Drive returned ${response.status}${detail ? `: ${detail}` : "."}`);
  }
  return response.json() as Promise<T>;
}

function createMultipartBody(payload: SpikePayload): { body: string; contentType: string } {
  const boundary = `flixate-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({
    name: SPIKE_FILE_NAME,
    mimeType: "application/json",
    parents: ["appDataFolder"],
  });
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    metadata,
    `--${boundary}`,
    "Content-Type: application/json",
    "",
    JSON.stringify(payload),
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

function isSpikePayload(value: unknown, nonce: string): value is SpikePayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SpikePayload>;
  return candidate.format === "flixate-oauth-spike"
    && candidate.version === 1
    && candidate.nonce === nonce
    && typeof candidate.writtenAt === "string";
}

export async function runDriveProbe(
  accessToken: string,
  fetcher: Fetcher = fetch,
): Promise<DriveProbeResult> {
  const totalStarted = performance.now();

  const accountStarted = performance.now();
  const about = await driveRequest<{ user?: DriveUser }>(
    fetcher,
    accessToken,
    `${DRIVE_API_URL}/about?fields=user(permissionId,displayName,emailAddress)`,
  );
  const accountMs = elapsed(accountStarted);
  if (!about.user?.permissionId) {
    throw new Error("Google Drive did not return an account identifier.");
  }

  const listStarted = performance.now();
  const listParams = new URLSearchParams({
    spaces: "appDataFolder",
    q: `name = '${SPIKE_FILE_NAME}'`,
    orderBy: "modifiedTime desc",
    pageSize: "10",
    fields: "files(id,name,modifiedTime,size)",
  });
  const listed = await driveRequest<{ files?: DriveFile[] }>(
    fetcher,
    accessToken,
    `${DRIVE_API_URL}/files?${listParams}`,
  );
  const listMs = elapsed(listStarted);
  const existing = listed.files?.[0];

  const payload: SpikePayload = {
    format: "flixate-oauth-spike",
    version: 1,
    nonce: crypto.randomUUID(),
    writtenAt: new Date().toISOString(),
  };

  const writeStarted = performance.now();
  let file: DriveFile;
  let fileAction: DriveProbeResult["fileAction"];
  if (existing) {
    fileAction = "updated";
    file = await driveRequest<DriveFile>(
      fetcher,
      accessToken,
      `${DRIVE_UPLOAD_URL}/files/${encodeURIComponent(existing.id)}?uploadType=media&fields=id,name,modifiedTime,size`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
  } else {
    fileAction = "created";
    const multipart = createMultipartBody(payload);
    file = await driveRequest<DriveFile>(
      fetcher,
      accessToken,
      `${DRIVE_UPLOAD_URL}/files?uploadType=multipart&fields=id,name,modifiedTime,size`,
      {
        method: "POST",
        headers: { "Content-Type": multipart.contentType },
        body: multipart.body,
      },
    );
  }
  const writeMs = elapsed(writeStarted);
  if (!file.id) throw new Error("Google Drive wrote the probe without returning a file ID.");

  const readStarted = performance.now();
  const roundTrip = await driveRequest<unknown>(
    fetcher,
    accessToken,
    `${DRIVE_API_URL}/files/${encodeURIComponent(file.id)}?alt=media`,
  );
  const readMs = elapsed(readStarted);
  if (!isSpikePayload(roundTrip, payload.nonce)) {
    throw new Error("The Drive round trip returned different probe data than Flixate wrote.");
  }

  return {
    account: {
      permissionId: about.user.permissionId,
      displayName: about.user.displayName ?? null,
      emailAddress: about.user.emailAddress ?? null,
    },
    fileAction,
    fileId: file.id,
    writtenAt: payload.writtenAt,
    timings: {
      accountMs,
      listMs,
      writeMs,
      readMs,
      totalMs: elapsed(totalStarted),
    },
  };
}
