import {
  DriveRequestError,
  GoogleDriveStateTransport,
  type DriveStateTransport,
} from "./drive-transport.js";
import {
  DriveAuthorizationCoordinator,
} from "./drive-session.js";
import type { DriveAccessRequest } from "./google-identity.js";
import type { SyncAccountIdentity } from "./sync-metadata.js";
import {
  DriveSyncEngine,
  type DriveSyncResult,
  type SyncStateStore,
} from "./sync-engine.js";

export class DriveAuthorizationRequiredError extends Error {
  constructor(readonly cause?: unknown) {
    super("Google Drive authorization is required before Flixate can synchronize.");
    this.name = "DriveAuthorizationRequiredError";
  }
}

export type DriveSyncServiceOptions = {
  authorize?: boolean;
  accessRequest?: DriveAccessRequest;
};

export type DriveTransportFactory = (accessToken: string) => DriveStateTransport;

export class DriveSyncService {
  constructor(
    private readonly authorization: DriveAuthorizationCoordinator,
    private readonly store: SyncStateStore,
    private readonly createTransport: DriveTransportFactory = (accessToken) =>
      new GoogleDriveStateTransport(accessToken),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async authorizeAndInspectAccount(
    request: DriveAccessRequest = {},
  ): Promise<SyncAccountIdentity> {
    const grant = await this.authorization.requestNew(request);
    try {
      return await this.createTransport(grant.accessToken).getAccount();
    } catch (error) {
      if (error instanceof DriveRequestError && error.authorizationFailed) {
        this.authorization.invalidate(grant.accessToken);
        throw new DriveAuthorizationRequiredError(error);
      }
      throw error;
    }
  }

  async synchronize(options: DriveSyncServiceOptions = {}): Promise<DriveSyncResult> {
    let grant = this.authorization.currentGrant();
    if (!grant) {
      if (!options.authorize) throw new DriveAuthorizationRequiredError();
      grant = await this.authorization.requestNew(options.accessRequest);
    }

    try {
      return await new DriveSyncEngine(
        this.createTransport(grant.accessToken),
        this.store,
        this.now,
      ).synchronize();
    } catch (error) {
      if (error instanceof DriveRequestError && error.authorizationFailed) {
        this.authorization.invalidate(grant.accessToken);
        throw new DriveAuthorizationRequiredError(error);
      }
      throw error;
    }
  }
}
