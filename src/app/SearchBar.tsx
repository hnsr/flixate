import { useEffect, useState } from "react";
import type { SortMode } from "../domain/catalog.js";

const SEARCH_DEBOUNCE_MS = 175;

type SearchBarProps = {
  query: string;
  sort: SortMode;
  onDraftChange: (query: string) => void;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: SortMode) => void;
};

export function SearchBar({ query, sort, onDraftChange, onQueryChange, onSortChange }: SearchBarProps): React.JSX.Element {
  const [draftQuery, setDraftQuery] = useState(query);

  useEffect(() => {
    setDraftQuery(query);
    onDraftChange(query);
  }, [onDraftChange, query]);

  useEffect(() => {
    if (draftQuery === query) return;
    const timeout = window.setTimeout(() => onQueryChange(draftQuery), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [draftQuery, onQueryChange, query]);

  return (
    <section
      className="search-bar"
      aria-label="Search and sort"
      aria-busy={draftQuery !== query}
    >
      <label className="search-field">
        <span className="visually-hidden">Search titles</span>
        <span aria-hidden="true" className="search-symbol">⌕</span>
        <input
          type="search"
          placeholder="Search films and series…"
          value={draftQuery}
          onChange={(event) => {
            setDraftQuery(event.target.value);
            onDraftChange(event.target.value);
          }}
          onBlur={() => {
            if (draftQuery !== query) onQueryChange(draftQuery);
          }}
        />
        {draftQuery && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setDraftQuery("");
              onDraftChange("");
            }}
          >×</button>
        )}
      </label>
      <label className="sort-field">
        <span>Sort</span>
        <select value={sort} onChange={(event) => onSortChange(event.target.value as SortMode)}>
          <option value="rating">Highest score</option>
          <option value="votes">Most votes</option>
          <option value="year">Newest first</option>
          <option value="title">Title A–Z</option>
        </select>
      </label>
    </section>
  );
}
