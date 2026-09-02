import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DriveRequestError } from "../sync/drive-transport.js";
import {
  DriveAuthorizationCoordinator,
} from "../sync/drive-session.js";
import {
  DriveAuthorizationRequiredError,
  DriveSyncService,
} from "../sync/drive-sync-service.js";
import type { DriveSyncResult, SyncStateStore } from "../sync/sync-engine.js";
import {
  loadGoogleIdentity,
  requestDriveAccess,
  type GoogleOAuth2,
} from "../sync/google-identity.js";
import {
  SyncAccountMismatchError,
  bindSyncAccount,
  clearSyncAccount,
  type SyncAccountIdentity,
  type SyncMetadataV1,
} from "../sync/sync-metadata.js";
import { SyncCoordinator } from "../sync/sync-coordinator.js";

export type DriveSyncStatus = {
  kind: "local" | "ready" | "connecting" | "syncing" | "synced" | "offline" | "attention";
  label: string;
  detail: string;
};

export type ConnectionChoice = "merge" | "remote";

export type DriveSyncController = {
  status: DriveSyncStatus;
  googleReady: boolean;
  googleError: string | null;
  busy: boolean;
  pendingAccount: SyncAccountIdentity | null;
  connect(): Promise<void>;
  confirmConnection(choice: ConnectionChoice): Promise<void>;
  cancelConnection(): void;
  syncNow(): Promise<void>;
  disconnect(): Promise<void>;
  afterLocalChange(): void;
};

type UseDriveSyncOptions = {
  clientId?: string;
  store: SyncStateStore;
  metadata: SyncMetadataV1;
};

function initialStatus(metadata: SyncMetadataV1): DriveSyncStatus {
  return metadata.account
    ? {
        kind: "ready",
        label: "Connected",
        detail: "Changes are saved locally and will synchronize with Google Drive.",
      }
    : {
        kind: "local",
        label: "Local only",
        detail: "Seen history is stored only in this browser.",
      };
}

function describeError(error: unknown): DriveSyncStatus {
  if (!navigator.onLine || (error instanceof DriveRequestError && error.retryable)) {
    return {
      kind: "offline",
      label: "Waiting to sync",
      detail: "Your changes are safe in this browser. Flixate will retry from a later interaction.",
    };
  }
  if (error instanceof DriveAuthorizationRequiredError) {
    return {
      kind: "attention",
      label: "Reconnect to sync",
      detail: "Your changes are safe locally. The next sync action can reconnect Google Drive.",
    };
  }
  if (error instanceof SyncAccountMismatchError) {
    return {
      kind: "attention",
      label: "Different Google account",
      detail: "Flixate stopped before reading or writing personal state.",
    };
  }
  return {
    kind: "attention",
    label: "Sync needs attention",
    detail: error instanceof Error ? error.message : "Google Drive synchronization did not complete.",
  };
}

function successfulStatus(result: DriveSyncResult): DriveSyncStatus {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (result.warnings.length > 0) {
    return {
      kind: "attention",
      label: "Synced with a warning",
      detail: `${result.warnings.length} Drive ${result.warnings.length === 1 ? "file was" : "files were"} ignored. Your valid history was kept.`,
    };
  }
  return {
    kind: "synced",
    label: `Synced at ${time}`,
    detail: result.write === "unchanged"
      ? "This browser and Google Drive already matched."
      : "Your seen history is up to date in Google Drive.",
  };
}

export function useDriveSync(options: UseDriveSyncOptions): DriveSyncController {
  const oauth = useRef<GoogleOAuth2 | null>(null);
  const metadata = useRef(options.metadata);
  metadata.current = options.metadata;
  const [googleReady, setGoogleReady] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [status, setStatus] = useState<DriveSyncStatus>(() => initialStatus(options.metadata));
  const [pendingAccount, setPendingAccount] = useState<SyncAccountIdentity | null>(null);

  const authorization = useMemo(() => {
    if (!options.clientId) return null;
    return new DriveAuthorizationCoordinator((request) => {
      if (!oauth.current) {
        return Promise.reject(new Error("Google authorization is still loading. Please try again."));
      }
      return requestDriveAccess(oauth.current, options.clientId!, request);
    });
  }, [options.clientId]);
  const service = useMemo(
    () => authorization ? new DriveSyncService(authorization, options.store) : null,
    [authorization, options.store],
  );

  useEffect(() => {
    if (!options.clientId) return;
    let active = true;
    void loadGoogleIdentity().then(
      (loaded) => {
        if (!active) return;
        oauth.current = loaded;
        setGoogleError(null);
        setGoogleReady(true);
      },
      (error: unknown) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "Google authorization could not load.";
        setGoogleError(message);
        if (metadata.current.account) setStatus(describeError(error));
      },
    );
    return () => { active = false; };
  }, [options.clientId]);

  const performSync = useCallback(async (localState: ConnectionChoice = "merge") => {
    if (!service) throw new Error("Google Drive sync is not configured.");
    setStatus({
      kind: "syncing",
      label: "Syncing…",
      detail: "Comparing this browser with your private Flixate Drive data.",
    });
    try {
      const result = await service.synchronize({ localState });
      setStatus(successfulStatus(result));
      return result;
    } catch (error) {
      setStatus(describeError(error));
      throw error;
    }
  }, [service]);

  const performSyncRef = useRef(performSync);
  performSyncRef.current = performSync;
  const coordinator = useMemo(
    () => service ? new SyncCoordinator(() => performSyncRef.current()) : null,
    [service],
  );
  useEffect(() => () => coordinator?.dispose(), [coordinator]);

  const reconnect = useCallback(async (): Promise<void> => {
    if (!authorization || !coordinator || !googleReady) {
      setStatus({
        kind: "attention",
        label: "Reconnect to sync",
        detail: "Google authorization is not ready yet. Your changes remain saved locally.",
      });
      return;
    }
    setStatus({
      kind: "connecting",
      label: "Reconnecting…",
      detail: "Google may briefly open a small authorization window.",
    });
    try {
      await authorization.requestNew({
        prompt: "",
        loginHint: metadata.current.account?.emailAddress ?? undefined,
      });
      await coordinator.flush();
    } catch (error) {
      setStatus(describeError(error));
    }
  }, [authorization, coordinator, googleReady]);

  const connect = useCallback(async (): Promise<void> => {
    if (!service || !googleReady) {
      setStatus({
        kind: "attention",
        label: googleError ? "Google unavailable" : "Google is still loading",
        detail: googleError ?? "Please try connecting again in a moment.",
      });
      return;
    }
    setStatus({
      kind: "connecting",
      label: "Connecting…",
      detail: "Choose the Google account whose private Drive data Flixate should use.",
    });
    try {
      const account = await service.authorizeAndInspectAccount({ prompt: "select_account" });
      setPendingAccount(account);
      setStatus({
        kind: "ready",
        label: "Choose how to connect",
        detail: "Flixate will not read or write personal state until you confirm.",
      });
    } catch (error) {
      setStatus(describeError(error));
    }
  }, [googleError, googleReady, service]);

  const confirmConnection = useCallback(async (choice: ConnectionChoice): Promise<void> => {
    if (!pendingAccount || !service) return;
    const previousMetadata = metadata.current;
    try {
      const bound = bindSyncAccount(
        metadata.current,
        pendingAccount,
        new Date().toISOString(),
        { allowReplacement: true },
      );
      metadata.current = bound;
      await options.store.saveMetadata(bound);
      setPendingAccount(null);
      await performSync(choice);
    } catch (error) {
      if (choice === "remote") {
        metadata.current = previousMetadata;
        await options.store.saveMetadata(previousMetadata);
        authorization?.invalidate();
      }
      setStatus(describeError(error));
    }
  }, [authorization, options.store, pendingAccount, performSync, service]);

  const cancelConnection = useCallback(() => {
    authorization?.invalidate();
    setPendingAccount(null);
    setStatus(initialStatus(metadata.current));
  }, [authorization]);

  const syncNow = useCallback(async (): Promise<void> => {
    if (!metadata.current.account || !authorization || !coordinator) return;
    if (authorization.currentGrant()) {
      try {
        await coordinator.flush();
      } catch {
        // performSync already records the user-facing failure.
      }
      return;
    }
    await reconnect();
  }, [authorization, coordinator, reconnect]);

  const disconnect = useCallback(async (): Promise<void> => {
    authorization?.invalidate();
    const disconnected = clearSyncAccount(metadata.current);
    metadata.current = disconnected;
    await options.store.saveMetadata(disconnected);
    setPendingAccount(null);
    setStatus(initialStatus(disconnected));
  }, [authorization, options.store]);

  const afterLocalChange = useCallback(() => {
    if (!metadata.current.account || !authorization || !coordinator) return;
    if (authorization.currentGrant()) {
      coordinator.schedule();
    } else {
      // This function is called directly by seen/import button handlers, retaining
      // the user activation Google requires for optimized reauthorization.
      void reconnect();
    }
  }, [authorization, coordinator, reconnect]);

  const busy = status.kind === "connecting" || status.kind === "syncing";
  return {
    status,
    googleReady,
    googleError,
    busy,
    pendingAccount,
    connect,
    confirmConnection,
    cancelConnection,
    syncNow,
    disconnect,
    afterLocalChange,
  };
}
