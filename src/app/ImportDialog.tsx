import type { FlixateBackup, ImportPreview } from "../domain/backup.js";

type ImportDialogProps = {
  backup: FlixateBackup;
  preview: ImportPreview;
  onApply: () => void;
  onCancel: () => void;
};

export function ImportDialog(props: ImportDialogProps): React.JSX.Element {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={props.onCancel}>
      <section
        className="import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span className="eyebrow">Backup preview</span>
        <h2 id="import-title">Bring this history in?</h2>
        <p>
          Newer changes win. Nothing currently stored in this browser is deleted
          just because it is absent from the backup.
        </p>
        <dl className="import-stats">
          <div><dt>Newer changes</dt><dd>{props.preview.newer}</dd></div>
          <div><dt>Older or unchanged</dt><dd>{props.preview.unchangedOrOlder}</dd></div>
          <div><dt>Seen after merge</dt><dd>{props.preview.seenAfterMerge}</dd></div>
        </dl>
        <p className="backup-date">Exported {props.backup.exportedAt === "unknown" ? "at an unknown time" : new Date(props.backup.exportedAt).toLocaleString()}</p>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={props.onCancel}>Cancel</button>
          <button type="button" className="primary-button" onClick={props.onApply}>Merge backup</button>
        </div>
      </section>
    </div>
  );
}
