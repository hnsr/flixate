export const DRIVE_APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

const GOOGLE_IDENTITY_SCRIPT_URL = "https://accounts.google.com/gsi/client";

export type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

type GoogleTokenClient = {
  requestAccessToken(options?: { prompt?: string; login_hint?: string }): void;
};

export type GoogleOAuth2 = {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback(response: GoogleTokenResponse): void;
    error_callback?(error: { type?: string; message?: string }): void;
  }): GoogleTokenClient;
};

export type DriveAccessGrant = {
  accessToken: string;
  expiresAt: number;
  scope: string;
};

export type DriveAccessRequest = {
  prompt?: "" | "consent" | "none" | "select_account";
  loginHint?: string;
};

let identityLoad: Promise<GoogleOAuth2> | null = null;

function currentOAuth2(): GoogleOAuth2 | undefined {
  return (globalThis as typeof globalThis & {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }).google?.accounts?.oauth2;
}

export function loadGoogleIdentity(): Promise<GoogleOAuth2> {
  const loaded = currentOAuth2();
  if (loaded) return Promise.resolve(loaded);
  if (identityLoad) return identityLoad;

  const loading = new Promise<GoogleOAuth2>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GOOGLE_IDENTITY_SCRIPT_URL}"]`,
    );
    const script = existing ?? document.createElement("script");

    const onLoad = () => {
      const oauth2 = currentOAuth2();
      if (oauth2) resolve(oauth2);
      else reject(new Error("Google Identity loaded without its OAuth client."));
    };
    const onError = () => reject(new Error("Google Identity could not be loaded."));

    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.src = GOOGLE_IDENTITY_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.append(script);
    }
  }).catch((error: unknown) => {
    identityLoad = null;
    throw error;
  });

  identityLoad = loading;
  return loading;
}

export function requestDriveAccess(
  oauth2: GoogleOAuth2,
  clientId: string,
  request: DriveAccessRequest = {},
): Promise<DriveAccessGrant> {
  return new Promise((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_APPDATA_SCOPE,
      callback(response) {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description ?? response.error ?? "Google did not grant Drive access."));
          return;
        }
        resolve({
          accessToken: response.access_token,
          expiresAt: Date.now() + Math.max(0, response.expires_in ?? 0) * 1_000,
          // GIS may omit `scope` when it exactly matches the requested grant. This
          // client requests only drive.appdata, so that successful response is still
          // unambiguous and safe to persist until its stated expiry.
          scope: response.scope ?? DRIVE_APPDATA_SCOPE,
        });
      },
      error_callback(error) {
        const reason = error.type === "popup_closed"
          ? "The Google authorization window was closed."
          : error.message ?? "Google authorization could not open.";
        reject(new Error(reason));
      },
    });

    // Calling this directly from the button handler preserves the browser's user
    // activation, which Google's dialog flow requires.
    client.requestAccessToken({
      prompt: request.prompt,
      login_hint: request.loginHint,
    });
  });
}
