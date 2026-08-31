import {
  DEFAULT_FILTERS,
  type FilterSettings,
  type MediaFilter,
  type SeenFilter,
} from "../domain/catalog.js";

type FiltersPanelProps = {
  settings: FilterSettings;
  genres: string[];
  onChange: (settings: FilterSettings) => void;
};

const SCORE_OPTIONS = [5, 6, 6.5, 7, 7.5, 8, 8.5, 9];
const VOTE_OPTIONS = [0, 10, 50, 100, 500, 1_000, 5_000];

function Segment<T extends string>(props: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}): React.JSX.Element {
  return (
    <fieldset className="filter-group">
      <legend>{props.label}</legend>
      <div className="segmented-control">
        {props.options.map((option) => (
          <button
            className={props.value === option.value ? "is-active" : undefined}
            key={option.value}
            type="button"
            aria-pressed={props.value === option.value}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function FiltersPanel({ settings, genres, onChange }: FiltersPanelProps): React.JSX.Element {
  const update = <K extends keyof FilterSettings>(key: K, value: FilterSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };
  const activeCount = [
    settings.mediaType !== "all",
    settings.seen !== "hide",
    settings.minimumRating !== null,
    settings.maximumRating !== null,
    settings.minimumVotes > 0,
    settings.genres.length > 0,
  ].filter(Boolean).length;

  return (
    <aside className="filters-panel" aria-label="Catalog filters">
      <div className="filters-heading">
        <div>
          <span className="eyebrow">Narrow it down</span>
          <h2>Filters</h2>
        </div>
        <button
          className="text-button"
          type="button"
          disabled={activeCount === 0 && !settings.query}
          onClick={() => onChange(DEFAULT_FILTERS)}
        >
          Reset{activeCount > 0 ? ` · ${activeCount}` : ""}
        </button>
      </div>

      <Segment<MediaFilter>
        label="Format"
        value={settings.mediaType}
        onChange={(value) => update("mediaType", value)}
        options={[
          { value: "all", label: "Both" },
          { value: "movie", label: "Movies" },
          { value: "show", label: "Shows" },
        ]}
      />

      <Segment<SeenFilter>
        label="Seen titles"
        value={settings.seen}
        onChange={(value) => update("seen", value)}
        options={[
          { value: "hide", label: "Hide" },
          { value: "all", label: "All" },
          { value: "only", label: "Only seen" },
        ]}
      />

      <div className="filter-group two-column-fields">
        <label>
          <span>Minimum score</span>
          <select
            aria-label="Minimum score"
            value={settings.minimumRating ?? ""}
            onChange={(event) => update("minimumRating", event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">Any</option>
            {SCORE_OPTIONS.map((score) => <option key={score} value={score}>{score.toFixed(1)}+</option>)}
          </select>
        </label>
        <label>
          <span>Maximum score</span>
          <select
            aria-label="Maximum score"
            value={settings.maximumRating ?? ""}
            onChange={(event) => update("maximumRating", event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">Any</option>
            {[...SCORE_OPTIONS].reverse().map((score) => <option key={score} value={score}>{score.toFixed(1)}</option>)}
          </select>
        </label>
      </div>

      <div className="filter-group">
        <label>
          <span>Minimum votes</span>
          <select
            aria-label="Minimum votes"
            value={settings.minimumVotes}
            onChange={(event) => update("minimumVotes", Number(event.target.value))}
          >
            {VOTE_OPTIONS.map((votes) => (
              <option key={votes} value={votes}>{votes === 0 ? "Any" : votes.toLocaleString("en-US") + "+"}</option>
            ))}
          </select>
        </label>
        <p className="field-note">Under 50 votes is marked as low confidence.</p>
      </div>

      <fieldset className="filter-group genre-filter">
        <div className="legend-row">
          <legend>Genres</legend>
          <div className="micro-toggle" aria-label="Genre matching mode">
            <button
              type="button"
              className={settings.genreMode === "any" ? "is-active" : undefined}
              aria-pressed={settings.genreMode === "any"}
              onClick={() => update("genreMode", "any")}
            >Any</button>
            <button
              type="button"
              className={settings.genreMode === "all" ? "is-active" : undefined}
              aria-pressed={settings.genreMode === "all"}
              onClick={() => update("genreMode", "all")}
            >All</button>
          </div>
        </div>
        <div className="genre-options">
          {genres.map((genre) => {
            const selected = settings.genres.includes(genre);
            return (
              <button
                key={genre}
                type="button"
                className={selected ? "genre-option is-active" : "genre-option"}
                aria-pressed={selected}
                onClick={() => update(
                  "genres",
                  selected ? settings.genres.filter((item) => item !== genre) : [...settings.genres, genre],
                )}
              >
                {genre === "Documentary" && <span aria-hidden="true">●</span>}
                {genre}
              </button>
            );
          })}
        </div>
      </fieldset>
    </aside>
  );
}
