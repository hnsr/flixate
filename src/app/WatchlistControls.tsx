import { useState } from "react";
import type { activeWatchlists } from "../sync/sync-state.js";

export type WatchlistOption = ReturnType<typeof activeWatchlists>[number];

type Props = {
  lists: WatchlistOption[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
};

export function WatchlistControls(props: Props): React.JSX.Element {
  const [name, setName] = useState("");
  const [rename, setRename] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const selected = props.lists.find(({ id }) => id === props.selected);
  return (
    <section className="watchlist-bar" aria-label="Your watchlists">
      <div className="watchlist-tabs">
        <button className={props.selected === null ? "is-active" : ""}
          aria-pressed={props.selected === null} onClick={() => props.onSelect(null)}>Discover</button>
        {props.lists.map(({ id, list }) => (
          <button key={id} className={id === props.selected ? "is-active" : ""}
            aria-pressed={id === props.selected} onClick={() => props.onSelect(id)}>
            {list.name.value} <span>{Object.values(list.members).filter(field => field?.value).length}</span>
          </button>
        ))}
      </div>
      <details className="list-manager" key={props.selected ?? "discover"}>
        <summary>Manage watchlists</summary>
        <div className="list-manager-body">
          <form onSubmit={event => {
            event.preventDefault();
            if (name.trim()) { props.onCreate(name); setName(""); }
          }}>
            <label>New watchlist
              <input value={name} onChange={event => setName(event.target.value)}
                maxLength={80} placeholder="e.g. Friday night" required />
            </label>
            <button className="primary-button" disabled={!name.trim()}>Create list</button>
          </form>
          {selected && (
            <>
              <form onSubmit={event => {
                event.preventDefault();
                if (rename.trim()) { props.onRename(selected.id, rename); setRename(""); }
              }}>
                <label>Rename selected watchlist
                  <input value={rename} onChange={event => setRename(event.target.value)}
                    maxLength={80} placeholder={selected.list.name.value} required />
                </label>
                <button className="secondary-button" disabled={!rename.trim()}>Rename list</button>
              </form>
              <button className="text-button danger-button" onClick={() => setConfirmDelete(selected.id)}>Delete list</button>
              {confirmDelete === selected.id && (
                <div className="list-delete-confirmation" role="alert">
                  <p>Delete “{selected.list.name.value}”? Seen history and other lists are kept.</p>
                  <button className="secondary-button danger-button" onClick={() => {
                    props.onDelete(selected.id); setConfirmDelete(null);
                  }}>Confirm delete list</button>
                  <button className="text-button" onClick={() => setConfirmDelete(null)}>Cancel</button>
                </div>
              )}
            </>
          )}
          <p className="field-note">A title can belong to several lists. Your lists follow your connected Google account.</p>
        </div>
      </details>
    </section>
  );
}
