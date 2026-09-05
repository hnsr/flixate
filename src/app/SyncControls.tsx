import { useEffect, useRef, useState } from "react";
import type { SyncAccountIdentity, SyncMetadataV1 } from "../sync/sync-metadata.js";
import type { ConnectionChoice, DriveSyncController } from "../hooks/use-drive-sync.js";

type SyncControlsProps = {
  metadata: SyncMetadataV1;
  controller: DriveSyncController;
  open: boolean;
  onOpenChange(open: boolean): void;
  onExport(): void;
};

function accountLabel(account: SyncAccountIdentity): string {
  return account.emailAddress ?? account.displayName ?? "Google Drive account";
}

type ConnectionDialogProps = {
  account: SyncAccountIdentity;
  replacing: boolean;
  busy: boolean;
  onChoose(choice: ConnectionChoice): void;
  onExport(): void;
  onCancel(): void;
  dialogRef: React.RefObject<HTMLElement | null>;
};

function ConnectionDialog(props: ConnectionDialogProps): React.JSX.Element {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={props.onCancel}>
      <section
        ref={props.dialogRef}
        className="import-dialog sync-connect-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-connect-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span className="eyebrow">Private Google Drive sync</span>
        <h2 id="sync-connect-title">How should this browser connect?</h2>
        <p>
          Google returned <strong>{accountLabel(props.account)}</strong>.
          {props.replacing
            ? " This is different from the account currently remembered by Flixate."
            : " Only Flixate's hidden app-data folder will be used."}
        </p>
        <div className="sync-choice-list">
          <button type="button" onClick={() => props.onChoose("merge")} disabled={props.busy}>
            <strong>Merge browser and Drive</strong>
            <span>Recommended. For each title, keep the newest seen or unseen decision.</span>
          </button>
          <button type="button" onClick={() => props.onChoose("remote")} disabled={props.busy}>
            <strong>Use Drive state here</strong>
            <span>Replace this browser's personal state with the state currently in this account.</span>
          </button>
        </div>
        <p className="sync-destructive-note">
          “Use Drive state” can remove local history. Export a JSON backup first if you may want it later.
        </p>
        <div className="dialog-actions sync-dialog-actions">
          <button type="button" className="text-button" onClick={props.onExport}>Export first</button>
          <button type="button" className="secondary-button" onClick={props.onCancel} disabled={props.busy}>Cancel</button>
        </div>
      </section>
    </div>
  );
}

export function SyncControls(props: SyncControlsProps): React.JSX.Element {
  const account = props.metadata.account;
  const statusClass = `sync-status-dot is-${props.controller.status.kind}`;
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const deleteConfirmationButton = useRef<HTMLButtonElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const modalOpen = props.open || Boolean(props.controller.pendingAccount);

  useEffect(() => {
    if (!props.open || !account) setConfirmingDelete(false);
  }, [account, props.open]);

  useEffect(() => {
    if (confirmingDelete) deleteConfirmationButton.current?.focus();
  }, [confirmingDelete]);

  useEffect(() => {
    if (!modalOpen || !dialog.current) return;
    const container = dialog.current;
    const focusable = () => [...container.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )];
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (props.controller.pendingAccount) props.controller.cancelConnection();
        else props.onOpenChange(false);
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (elements.length === 0) return;
      const first = elements[0]!;
      const last = elements[elements.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      trigger.current?.focus();
    };
  }, [
    modalOpen,
    props.controller.pendingAccount,
    props.controller.cancelConnection,
    props.onOpenChange,
  ]);

  return (
    <>
      <button
        ref={trigger}
        className="sync-menu-button"
        type="button"
        aria-haspopup="dialog"
        aria-label={`Sync: ${props.controller.status.label}`}
        onClick={() => props.onOpenChange(true)}
      >
        <span className={statusClass} aria-hidden="true" />
        <span>{props.controller.status.label}</span>
      </button>

      {props.open && !props.controller.pendingAccount && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => props.onOpenChange(false)}>
          <section
            ref={dialog}
            className="import-dialog sync-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sync-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="eyebrow">Cross-device history</span>
            <h2 id="sync-dialog-title">Google Drive sync</h2>
            <div className="sync-current-status" role="status">
              <span className={statusClass} aria-hidden="true" />
              <div>
                <strong>{props.controller.status.label}</strong>
                <p>{props.controller.status.detail}</p>
              </div>
            </div>

            {account ? (
              <>
                <dl className="sync-account-details">
                  <div><dt>Account</dt><dd>{accountLabel(account)}</dd></div>
                  <div><dt>Storage</dt><dd>Private Drive app data</dd></div>
                </dl>
                <div className="sync-panel-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={props.controller.busy}
                    onClick={() => void props.controller.syncNow()}
                  >Sync now</button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={props.controller.busy || !props.controller.googleReady}
                    onClick={() => void props.controller.connect()}
                  >Change account</button>
                  <button
                    type="button"
                    className="text-button danger-button disconnect-button"
                    disabled={props.controller.busy}
                    onClick={() => void props.controller.disconnect()}
                  >Disconnect</button>
                  <button
                    type="button"
                    className="text-button danger-button"
                    disabled={props.controller.busy}
                    onClick={() => setConfirmingDelete(true)}
                  >Delete Drive history</button>
                </div>
                <p className="sync-footnote">
                  Disconnecting keeps the history already stored in this browser and does not delete Drive data.
                </p>
                {confirmingDelete && (
                  <div className="sync-delete-confirmation" role="alert">
                    <strong>Permanently delete the Drive copy?</strong>
                    <p>
                      This deletes every Flixate sync file in this account and disconnects this browser.
                      Local seen history stays here. Another connected device can upload its copy again.
                    </p>
                    <div className="dialog-actions">
                      <button
                        ref={deleteConfirmationButton}
                        type="button"
                        className="secondary-button danger-button"
                        disabled={props.controller.busy}
                        onClick={() => void props.controller.deleteRemoteData()
                          .finally(() => setConfirmingDelete(false))}
                      >Permanently delete Drive history</button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={props.controller.busy}
                        onClick={() => setConfirmingDelete(false)}
                      >Cancel deletion</button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="sync-intro">
                  Keep seen history in your own hidden Google Drive app-data folder. Flixate has no server and cannot browse your normal Drive files.
                </p>
                {props.controller.googleError && (
                  <p className="sync-google-error" role="alert">{props.controller.googleError}</p>
                )}
                <button
                  type="button"
                  className="primary-button"
                  disabled={!props.controller.googleReady || props.controller.busy}
                  onClick={() => void props.controller.connect()}
                >{props.controller.googleReady
                    ? "Connect Google Drive"
                    : props.controller.googleError
                      ? "Google unavailable"
                      : "Loading Google…"}</button>
              </>
            )}
            <button
              type="button"
              className="dialog-close-button"
              aria-label="Close sync settings"
              onClick={() => props.onOpenChange(false)}
            >×</button>
          </section>
        </div>
      )}

      {props.controller.pendingAccount && (
        <ConnectionDialog
          account={props.controller.pendingAccount}
          replacing={Boolean(account && account.permissionId !== props.controller.pendingAccount.permissionId)}
          busy={props.controller.busy}
          onChoose={(choice) => void props.controller.confirmConnection(choice)}
          onExport={props.onExport}
          onCancel={props.controller.cancelConnection}
          dialogRef={dialog}
        />
      )}
    </>
  );
}
