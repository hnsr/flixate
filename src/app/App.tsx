import { useEffect, useMemo, useRef, useState } from "react";
import {
  createBackup,
  normalizeFilterSettings,
  parseBackup,
  previewImport,
  type FlixateBackup,
  type ImportPreview,
} from "../domain/backup.js";
import { availableGenres, DEFAULT_FILTERS, type FilterSettings, type TitleKey } from "../domain/catalog.js";
import { filterAndSortTitles } from "../domain/filters.js";
import {
  loadUserState,
  mergeUserStates,
  migrateUserState,
  seenTitleKeys,
  toggleSeen,
  USER_STATE_KEY,
  type UserStateV1,
} from "../domain/user-state.js";
import { useCatalog } from "../hooks/use-catalog.js";
import { usePersistentState } from "../hooks/use-persistent-state.js";
import { CatalogList } from "./CatalogList.js";
import { FiltersPanel } from "./FiltersPanel.js";
import { ImportDialog } from "./ImportDialog.js";

const SETTINGS_KEY = "flixate:filters:v1";

type PendingImport = {
  backup: FlixateBackup;
  preview: ImportPreview;
};

function downloadBackup(state: UserStateV1, settings: FilterSettings): void {
  const backup = createBackup(state, settings);
  const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `flixate-backup-${backup.exportedAt.slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function LoadingState(): React.JSX.Element {
  return (
    <main className="centered-state">
      <img src={`${import.meta.env.BASE_URL}flixate.svg`} alt="" />
      <span className="eyebrow">Opening the catalog</span>
      <div className="loading-line" />
    </main>
  );
}

export function App(): React.JSX.Element {
  const catalogState = useCatalog();
  const importInput = useRef<HTMLInputElement>(null);
  const [filters, setFilters] = usePersistentState(SETTINGS_KEY, DEFAULT_FILTERS, normalizeFilterSettings);
  const [userState, setUserState] = useState(() => loadUserState(localStorage));
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(USER_STATE_KEY, JSON.stringify(userState));
    } catch {
      // The in-memory session remains usable when browser storage is unavailable.
    }
  }, [userState]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== USER_STATE_KEY || !event.newValue) return;
      try {
        setUserState(migrateUserState(JSON.parse(event.newValue)));
      } catch {
        // Ignore a malformed cross-tab update and retain the current valid state.
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const seenKeys = useMemo(() => seenTitleKeys(userState), [userState]);
  const catalog = catalogState.status === "ready" ? catalogState.catalog : null;
  const genres = useMemo(() => catalog ? availableGenres(catalog.titles) : [], [catalog]);
  const titles = useMemo(
    () => catalog ? filterAndSortTitles(catalog.titles, filters, seenKeys) : [],
    [catalog, filters, seenKeys],
  );

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const backup = parseBackup(await file.text());
      setPendingImport({ backup, preview: previewImport(userState, backup.state) });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The backup could not be read.");
    } finally {
      if (importInput.current) importInput.current.value = "";
    }
  };

  const applyImport = () => {
    if (!pendingImport) return;
    setUserState((current) => mergeUserStates(current, pendingImport.backup.state));
    setFilters(pendingImport.backup.settings);
    setPendingImport(null);
    setNotice("Backup merged. Your newer local changes were kept.");
  };

  if (catalogState.status === "loading") return <LoadingState />;
  if (catalogState.status === "error") {
    return (
      <main className="centered-state error-state">
        <span className="eyebrow">Catalog unavailable</span>
        <h1>Flixate could not open.</h1>
        <p>{catalogState.message}</p>
        <button className="primary-button" type="button" onClick={() => location.reload()}>Try again</button>
      </main>
    );
  }

  const toggleTitle = (key: TitleKey) => setUserState((current) => toggleSeen(current, key));
  const refreshed = new Date(catalogState.catalog.createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const catalogAgeDays = Math.floor(
    (Date.now() - new Date(catalogState.catalog.createdAt).getTime()) / (24 * 60 * 60 * 1000),
  );
  const freshnessWarning = catalogState.catalog.loadWarning
    ?? (!catalogState.catalog.fixture && catalogAgeDays > 14
      ? "This catalog is older than two weeks. The scheduled refresh may need attention."
      : null);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="Flixate home">
          <img src={`${import.meta.env.BASE_URL}flixate.svg`} alt="" />
          <span>flixate</span>
        </a>
        <div className="topbar-actions">
          <span
            className="fixture-badge"
            title={catalogState.catalog.fixture ? "Development uses a representative local catalog" : "Validated US+NL catalog snapshot"}
          >
            {catalogState.catalog.fixture ? "Development fixture" : "US + NL catalog"}
          </span>
          <button className="text-button" type="button" onClick={() => downloadBackup(userState, filters)}>Export</button>
          <button className="text-button" type="button" onClick={() => importInput.current?.click()}>Import</button>
          <input
            ref={importInput}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            aria-label="Import Flixate backup"
            onChange={(event) => void handleImport(event.target.files?.[0])}
          />
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">Your next watch, minus the noise</span>
            <h1>Find the one<br />worth your evening.</h1>
          </div>
          <div className="hero-meta" aria-label="Catalog summary">
            <div>
              <strong>{catalogState.catalog.titles.length.toLocaleString("en-US")}</strong>
              <span>{catalogState.catalog.fixture ? "fixture titles" : "streaming titles"}</span>
            </div>
            <div><strong>{seenKeys.size}</strong><span>marked seen</span></div>
            <div><strong>US + NL</strong><span>availability union</span></div>
          </div>
        </section>

        <section className="search-bar" aria-label="Search and sort">
          <label className="search-field">
            <span className="visually-hidden">Search titles</span>
            <span aria-hidden="true" className="search-symbol">⌕</span>
            <input
              type="search"
              placeholder="Search films and series…"
              value={filters.query}
              onChange={(event) => setFilters({ ...filters, query: event.target.value })}
            />
            {filters.query && (
              <button type="button" aria-label="Clear search" onClick={() => setFilters({ ...filters, query: "" })}>×</button>
            )}
          </label>
          <label className="sort-field">
            <span>Sort</span>
            <select value={filters.sort} onChange={(event) => setFilters({ ...filters, sort: event.target.value as FilterSettings["sort"] })}>
              <option value="rating">Highest score</option>
              <option value="votes">Most votes</option>
              <option value="year">Newest first</option>
              <option value="title">Title A–Z</option>
            </select>
          </label>
        </section>

        <div className="catalog-layout">
          <FiltersPanel settings={filters} genres={genres} onChange={setFilters} />
          <section className="results-panel" aria-labelledby="results-heading">
            {freshnessWarning && <p className="catalog-warning" role="status">{freshnessWarning}</p>}
            <div className="results-heading">
              <div>
                <span className="eyebrow">The shortlist</span>
                <h2 id="results-heading">{titles.length} {titles.length === 1 ? "title" : "titles"}</h2>
              </div>
              <p>Updated {refreshed} <span aria-hidden="true">·</span> TMDB scores</p>
            </div>
            <CatalogList
              catalog={catalogState.catalog}
              titles={titles}
              seenKeys={seenKeys}
              onToggleSeen={toggleTitle}
            />
          </section>
        </div>
      </main>

      <footer>
        <div>
          <strong>Flixate</strong>
          <p>A personal, local-first watch finder. Your seen history stays in this browser.</p>
        </div>
        <div className="credits">
          <img className="tmdb-logo" src={`${import.meta.env.BASE_URL}tmdb.svg`} alt="The Movie Database (TMDB)" />
          <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
          <p>Streaming availability data is supplied through TMDB by JustWatch.</p>
          <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">Visit TMDB ↗</a>
        </div>
      </footer>

      {pendingImport && (
        <ImportDialog
          backup={pendingImport.backup}
          preview={pendingImport.preview}
          onApply={applyImport}
          onCancel={() => setPendingImport(null)}
        />
      )}
      {notice && <div className="notice" role="status">{notice}</div>}
    </div>
  );
}
