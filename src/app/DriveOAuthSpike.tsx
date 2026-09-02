import { useEffect, useRef, useState } from "react";
import { runDriveProbe, type DriveProbeResult } from "../sync/drive-spike.js";
import {
  forgetDriveSpikeToken,
  loadDriveSpikeSession,
  saveDriveSpikeSession,
  type RememberedDriveAccount,
} from "../sync/drive-spike-session.js";
import {
  loadGoogleIdentity,
  requestDriveAccess,
  type DriveAccessGrant,
  type GoogleOAuth2,
} from "../sync/google-identity.js";

type DriveOAuthSpikeProps = {
  clientId: string;
};

type ProbeState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "authorizing" }
  | { status: "probing" }
  | { status: "success"; result: DriveProbeResult; expiresAt: number }
  | { status: "error"; message: string };

function describeAccount(result: DriveProbeResult): string {
  return result.account.emailAddress ?? result.account.displayName ?? "Google Drive account";
}

export function DriveOAuthSpike({ clientId }: DriveOAuthSpikeProps): React.JSX.Element {
  const oauth = useRef<GoogleOAuth2 | null>(null);
  const initialSession = useRef(loadDriveSpikeSession());
  const grant = useRef<DriveAccessGrant | null>(initialSession.current.grant);
  const account = useRef<RememberedDriveAccount | null>(initialSession.current.account);
  const [hasSavedToken, setHasSavedToken] = useState(Boolean(initialSession.current.grant));
  const [hasRememberedAccount, setHasRememberedAccount] = useState(Boolean(initialSession.current.account));
  const [state, setState] = useState<ProbeState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void loadGoogleIdentity().then(
      (loaded) => {
        if (!active) return;
        oauth.current = loaded;
        setState({ status: "ready" });
      },
      (error: unknown) => {
        if (active) setState({
          status: "error",
          message: error instanceof Error ? error.message : "Google Identity could not be loaded.",
        });
      },
    );
    return () => { active = false; };
  }, []);

  const authorizeAndProbe = async () => {
    if (!oauth.current) return;
    try {
      let nextGrant = grant.current;
      if (!nextGrant || nextGrant.expiresAt <= Date.now() + 30_000) {
        setState({ status: "authorizing" });
        nextGrant = await requestDriveAccess(oauth.current, clientId, {
          prompt: account.current ? "" : "select_account",
          loginHint: account.current?.emailAddress ?? undefined,
        });
        grant.current = nextGrant;
      }
      setState({ status: "probing" });
      const result = await runDriveProbe(nextGrant.accessToken);
      if (account.current && result.account.permissionId !== account.current.permissionId) {
        grant.current = null;
        forgetDriveSpikeToken(account.current);
        setHasSavedToken(false);
        throw new Error("Google returned a different account. The saved token was discarded before personal sync could occur.");
      }
      account.current = result.account;
      saveDriveSpikeSession({ account: result.account, grant: nextGrant });
      setHasSavedToken(true);
      setHasRememberedAccount(true);
      setState({ status: "success", result, expiresAt: nextGrant.expiresAt });
    } catch (error) {
      grant.current = null;
      forgetDriveSpikeToken(account.current);
      setHasSavedToken(false);
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "The Drive probe failed.",
      });
    }
  };

  const simulateExpiry = () => {
    grant.current = null;
    forgetDriveSpikeToken(account.current);
    setHasSavedToken(false);
    setState({ status: "ready" });
  };

  const busy = state.status === "authorizing" || state.status === "probing";
  const idleLabel = state.status === "loading"
    ? "Loading Google…"
    : state.status === "authorizing"
      ? "Waiting for Google…"
      : state.status === "probing"
        ? "Testing Drive…"
        : hasSavedToken
          ? "Test Drive using saved token"
          : hasRememberedAccount
            ? "Test expired-token reconnect"
            : "Connect and test Drive";

  return (
    <section className="drive-spike" aria-labelledby="drive-spike-heading">
      <div>
        <span className="eyebrow">Development probe</span>
        <h2 id="drive-spike-heading">Google Drive OAuth feasibility</h2>
        <p>
          This requests only Flixate's private app-data permission and round-trips a harmless
          test JSON file. It does not upload your seen history. For this test, the short-lived
          access token is saved in this browser only until its original expiry.
        </p>
      </div>

      <div className="drive-spike-actions">
        <button
          className="primary-button"
          type="button"
          disabled={state.status === "loading" || busy}
          onClick={() => void authorizeAndProbe()}
        >
          {idleLabel}
        </button>
        {(state.status === "success" || hasSavedToken) && (
          <button className="secondary-button" type="button" onClick={simulateExpiry} disabled={busy}>
            Simulate token expiry
          </button>
        )}
      </div>

      {state.status === "ready" && (
        <p className="drive-spike-status" role="status">
          {hasRememberedAccount
            ? "Account remembered. The next test requests a fresh token without forcing account selection."
            : "Ready to open Google's initial account dialog."}
        </p>
      )}
      {busy && <p className="drive-spike-status" role="status">Keep this page open while the probe runs.</p>}
      {state.status === "error" && (
        <div className="drive-spike-result is-error" role="alert">
          <strong>Probe did not complete</strong>
          <p>{state.message}</p>
          <p>No Flixate personal state was sent.</p>
        </div>
      )}
      {state.status === "success" && (
        <div className="drive-spike-result" role="status">
          <strong>Drive round trip passed</strong>
          <dl>
            <div><dt>Account</dt><dd>{describeAccount(state.result)}</dd></div>
            <div><dt>File</dt><dd>{state.result.fileAction}</dd></div>
            <div><dt>Total</dt><dd>{state.result.timings.totalMs.toLocaleString()} ms</dd></div>
            <div>
              <dt>Token expires</dt>
              <dd>{new Date(state.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</dd>
            </div>
          </dl>
          <p>Account identity, list, write, download, and payload validation succeeded.</p>
        </div>
      )}
    </section>
  );
}
