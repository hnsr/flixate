import { useEffect, useState } from "react";
import { SynopsisRepository } from "../data/catalog.js";
import type { WatchlistOption } from "./WatchlistControls.js";
import {
  genresForTitle,
  posterUrl,
  tmdbUrl,
  type CatalogDocument,
  type CoreTitle,
} from "../domain/catalog.js";

type CatalogCardProps = {
  catalog: CatalogDocument;
  title: CoreTitle;
  seen: boolean;
  synopsisRepository: SynopsisRepository;
  onToggleSeen: () => void;
  onSizeChange?: () => void;
  watchlists?: WatchlistOption[];
  onMembershipChange?: (listId: string, member: boolean) => void;
};

type SynopsisState =
  | { status: "idle" | "loading" }
  | { status: "ready"; text: string | null }
  | { status: "error" };

function formatVotes(votes: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(votes);
}

export function CatalogCard(props: CatalogCardProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [listsOpen, setListsOpen] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [synopsis, setSynopsis] = useState<SynopsisState>({ status: "idle" });
  const imageUrl = posterUrl(props.catalog, props.title);
  const lowConfidence = props.title.rating !== undefined && props.title.voteCount < 50;

  useEffect(() => {
    props.onSizeChange?.();
  }, [expanded, listsOpen, synopsis, props.watchlists, props.onSizeChange]);

  const toggleDetails = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && synopsis.status === "idle") {
      setSynopsis({ status: "loading" });
      props.synopsisRepository.get(props.catalog, props.title.key)
        .then((text) => setSynopsis({ status: "ready", text }))
        .catch(() => setSynopsis({ status: "error" }));
    }
  };

  return (
    <article className={props.seen ? "catalog-card is-seen" : "catalog-card"} data-title-key={props.title.key}>
      <div className="poster-frame">
        {imageUrl && !posterFailed ? (
          <img
            src={imageUrl}
            alt={`Poster for ${props.title.title}`}
            loading="lazy"
            decoding="async"
            onError={() => setPosterFailed(true)}
          />
        ) : (
          <div className="poster-placeholder" role="img" aria-label={`No poster for ${props.title.title}`}>
            <span aria-hidden="true">F</span>
            <small>No poster</small>
          </div>
        )}
      </div>

      <div className="card-content">
        <div className="card-heading">
          <div>
            <div className="title-kicker">
              <span>{props.title.mediaType === "show" ? "Series" : "Film"}</span>
              <span aria-hidden="true">·</span>
              <span>{props.title.releaseYear ?? "Year unknown"}</span>
            </div>
            <h3>{props.title.title}</h3>
          </div>
          <div className={lowConfidence ? "score score-low-confidence" : "score"}>
            <strong>{props.title.rating?.toFixed(1) ?? "—"}</strong>
            <span>{props.title.rating === undefined ? "Unrated" : `${formatVotes(props.title.voteCount)} votes`}</span>
          </div>
        </div>

        <div className="genre-row" aria-label="Genres">
          {genresForTitle(props.title).map((genre) => <span key={genre}>{genre}</span>)}
          {lowConfidence && <span className="confidence-tag">Low confidence</span>}
        </div>

        {expanded && (
          <div className="synopsis" aria-live="polite">
            <span className="eyebrow">Synopsis</span>
            {synopsis.status === "loading" && <p className="muted">Opening the file…</p>}
            {synopsis.status === "ready" && synopsis.text && <p>{synopsis.text}</p>}
            {synopsis.status === "ready" && !synopsis.text && <p className="muted">No synopsis is available for this title.</p>}
            {synopsis.status === "error" && <p className="muted">The synopsis could not be loaded. It may not be cached while offline.</p>}
          </div>
        )}

        <div className="card-actions">
          <button type="button" className="secondary-button" aria-expanded={expanded} onClick={toggleDetails}>
            {expanded ? "Close details" : "Read synopsis"}
          </button>
          <a href={tmdbUrl(props.title)} target="_blank" rel="noreferrer" className="tmdb-link">
            TMDB <span aria-hidden="true">↗</span>
          </a>
          <button type="button" className="secondary-button" aria-expanded={listsOpen}
            aria-label={`Watchlists for ${props.title.title}`} onClick={() => setListsOpen(!listsOpen)}>
            Lists{props.watchlists?.some(({ list }) => list.members[props.title.key]?.value) ? " ✓" : ""}
          </button>
          <button
            type="button"
            className={props.seen ? "seen-button is-seen" : "seen-button"}
            aria-label={`Mark ${props.title.title} as ${props.seen ? "unseen" : "seen"}`}
            onClick={props.onToggleSeen}
          >
            <span aria-hidden="true">{props.seen ? "✓" : "+"}</span>
            {props.seen ? "Seen" : "Mark seen"}
          </button>
        </div>
        {listsOpen && (
          <fieldset className="card-watchlists">
            <legend>Add to watchlists</legend>
            {!props.watchlists?.length && <p>Create a watchlist using “Manage watchlists” above the catalog.</p>}
            {props.watchlists?.map(({ id, list }) => (
              <label key={id}>
                <input type="checkbox" checked={list.members[props.title.key]?.value ?? false}
                  onChange={event => props.onMembershipChange?.(id, event.target.checked)} />
                {list.name.value}
              </label>
            ))}
          </fieldset>
        )}
      </div>
    </article>
  );
}
