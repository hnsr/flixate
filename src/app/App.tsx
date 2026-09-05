import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createPersonalBackup,
  normalizeFilterSettings,
  parseBackup,
  previewImport,
  type FlixateBackup,
  type ImportPreview,
} from "../domain/backup.js";
import { availableGenres, DEFAULT_FILTERS, type FilterSettings, type TitleKey } from "../domain/catalog.js";
import { createCatalogFilterIndex, filterCatalogIndex } from "../domain/filters.js";
import {
  loadUserState,
  migrateUserState,
  seenTitleKeys,
  USER_STATE_KEY,
} from "../domain/user-state.js";
import { useCatalog } from "../hooks/use-catalog.js";
import { useDriveSync } from "../hooks/use-drive-sync.js";
import { usePersistentState } from "../hooks/use-persistent-state.js";
import type { SyncStateStore } from "../sync/sync-engine.js";
import {
  loadOrCreateSyncMetadata,
  parseSyncMetadata,
  saveSyncMetadata,
  SYNC_METADATA_KEY,
  type SyncMetadataV1,
} from "../sync/sync-metadata.js";
import {
  LOCAL_SYNC_STATE_KEY,
  LEGACY_SYNC_STATE_KEY,
  loadOrMigrateLocalSyncState,
  parseLocalSyncState,
  saveLocalSyncState,
  syncStatesEqual,
} from "../sync/sync-local-state.js";
import {
  applyBooleanChange,
  activeWatchlists,
  changeWatchlist,
  mergeSyncStates,
  migrateUserStateToSync,
  syncStateToUserState,
  type SyncStateV1,
} from "../sync/sync-state.js";
import { CatalogList } from "./CatalogList.js";
import { FiltersPanel } from "./FiltersPanel.js";
import { ImportDialog } from "./ImportDialog.js";
import { SearchBar } from "./SearchBar.js";
import { SyncControls } from "./SyncControls.js";
import { WatchlistControls } from "./WatchlistControls.js";
import { FilterPresets } from "./FilterPresets.js";

const SETTINGS_KEY = "flixate:filters:v1";
const REFRESH_WORKFLOW_URL = "https://github.com/hnsr/flixate/actions/workflows/catalog.yml";
const GOOGLE_CLIENT_ID = import.meta.env.MODE === "test"
  ? undefined
  : import.meta.env.VITE_GOOGLE_CLIENT_ID;

type PendingImport = {
  backup: FlixateBackup;
  preview: ImportPreview;
};

function downloadBackup(state: SyncStateV1, settings: FilterSettings): void {
  const backup = createPersonalBackup(state, settings);
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
  const initialPersonalState = useRef<{
    metadata: SyncMetadataV1;
    state: SyncStateV1;
  } | null>(null);
  if (!initialPersonalState.current) {
    const metadata = loadOrCreateSyncMetadata(localStorage);
    initialPersonalState.current = {
      metadata,
      state: loadOrMigrateLocalSyncState(
        localStorage,
        metadata.deviceId,
        loadUserState(localStorage),
      ),
    };
  }
  const [filters, setFilters] = usePersistentState(SETTINGS_KEY, DEFAULT_FILTERS, normalizeFilterSettings);
  const searchDraft = useRef(filters.query);
  const [syncMetadata, setSyncMetadata] = useState(initialPersonalState.current.metadata);
  const [syncState, setSyncState] = useState(initialPersonalState.current.state);
  const syncMetadataRef = useRef(syncMetadata);
  const syncStateRef = useRef(syncState);
  syncMetadataRef.current = syncMetadata;
  syncStateRef.current = syncState;
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  const [selectedList, setSelectedList] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const commitSyncState = useCallback((next: SyncStateV1) => {
    syncStateRef.current = next;
    try {
      saveLocalSyncState(localStorage, syncMetadataRef.current.deviceId, next);
      localStorage.setItem(USER_STATE_KEY, JSON.stringify(syncStateToUserState(next)));
    } catch {
      // The in-memory session remains usable when browser storage is unavailable.
    }
    setSyncState((current) => syncStatesEqual(current, next) ? current : next);
  }, []);

  const syncStore = useMemo<SyncStateStore>(() => ({
    loadState: () => syncStateRef.current,
    saveState: (next) => { commitSyncState(next); },
    loadMetadata: () => syncMetadataRef.current,
    saveMetadata: (next) => {
      syncMetadataRef.current = next;
      try {
        saveSyncMetadata(localStorage, next);
      } catch {
        // Retain the confirmed binding in memory if storage is unavailable.
      }
      setSyncMetadata(next);
    },
  }), [commitSyncState]);
  const driveSync = useDriveSync({
    clientId: GOOGLE_CLIENT_ID,
    store: syncStore,
    metadata: syncMetadata,
  });
  const userState = useMemo(() => syncStateToUserState(syncState), [syncState]);

  useEffect(() => {
    commitSyncState(syncStateRef.current);
  }, [commitSyncState]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!event.newValue) return;
      if (event.key === LOCAL_SYNC_STATE_KEY || event.key === LEGACY_SYNC_STATE_KEY) {
        try {
          const incoming = parseLocalSyncState(event.newValue, syncMetadataRef.current.deviceId);
          const merged = mergeSyncStates(syncStateRef.current, incoming);
          if (!syncStatesEqual(syncStateRef.current, merged)) commitSyncState(merged);
        } catch {
          // Ignore malformed cross-tab state and retain the current valid state.
        }
      }
      if (event.key === USER_STATE_KEY) {
        try {
          const legacy = migrateUserState(JSON.parse(event.newValue));
          const incoming = migrateUserStateToSync(
            legacy,
            syncMetadataRef.current.deviceId,
          );
          const merged = mergeSyncStates(syncStateRef.current, incoming);
          if (!syncStatesEqual(syncStateRef.current, merged)) commitSyncState(merged);
        } catch {
          // Support an older Flixate tab during rollout without trusting bad state.
        }
      }
      if (event.key === SYNC_METADATA_KEY) {
        try {
          const incoming = parseSyncMetadata(JSON.parse(event.newValue));
          if (incoming.deviceId === syncMetadataRef.current.deviceId) {
            syncMetadataRef.current = incoming;
            setSyncMetadata(incoming);
          }
        } catch {
          // Ignore malformed cross-tab metadata.
        }
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
  const catalogIndex = useMemo(
    () => catalog ? createCatalogFilterIndex(catalog.titles) : null,
    [catalog],
  );
  const titles = useMemo(
    () => catalogIndex ? filterCatalogIndex(catalogIndex, filters, seenKeys) : [],
    [catalogIndex, filters, seenKeys],
  );
  const watchlists = useMemo(() => activeWatchlists(syncState), [syncState]);
  const activeList = watchlists.find(({ id }) => id === selectedList);
  useEffect(() => {
    if (selectedList && !activeList) setSelectedList(null);
  }, [selectedList, activeList]);
  const matchingTitles = useMemo(() => activeList
    ? titles.filter(title => activeList.list.members[title.key]?.value)
    : titles, [titles, activeList]);
  const displayedTitles = useMemo(() => activeList ? matchingTitles : matchingTitles.slice(0, 100),
    [activeList, matchingTitles]);
  const catalogKeys = useMemo(() => new Set(catalog?.titles.map(title => title.key)), [catalog]);
  const unavailableMembers = activeList
    ? Object.entries(activeList.list.members).filter(([key, field]) => field?.value && !catalogKeys.has(key as TitleKey))
    : [];

  const selectList = (id: string | null) => {
    setSelectedList(id);
    setFilters({ ...DEFAULT_FILTERS, sort: filters.sort, seen: id ? "all" : "hide" });
  };
  const editList = (id: string, action: Parameters<typeof changeWatchlist>[3]) => {
    try {
      commitSyncState(changeWatchlist(syncStateRef.current, syncMetadataRef.current.deviceId, id, action));
      driveSync.afterLocalChange();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The watchlist could not be updated.");
    }
  };

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
    const imported = pendingImport.backup.personalState ?? migrateUserStateToSync(
      pendingImport.backup.state,
      syncMetadataRef.current.deviceId,
    );
    commitSyncState(mergeSyncStates(syncStateRef.current, imported));
    setFilters(pendingImport.backup.settings);
    setPendingImport(null);
    setNotice("Backup merged. Your newer local changes were kept.");
    driveSync.afterLocalChange();
  };

  const toggleTitle = useCallback(
    (key: TitleKey) => {
      const current = syncStateRef.current;
      const next = applyBooleanChange(
        current,
        syncMetadataRef.current.deviceId,
        key,
        "seen",
        !(current.titles[key]?.seen?.value ?? false),
      );
      commitSyncState(next);
      driveSync.afterLocalChange();
    },
    [commitSyncState, driveSync],
  );
  const updateQuery = useCallback(
    (query: string) => setFilters((current) => current.query === query
      ? current
      : { ...current, query }),
    [setFilters],
  );
  const updateSearchDraft = useCallback((query: string) => {
    searchDraft.current = query;
  }, []);
  const updateSort = useCallback(
    (sort: FilterSettings["sort"]) => setFilters((current) => current.sort === sort
      ? current
      : { ...current, sort }),
    [setFilters],
  );
  const exportCurrent = useCallback(() => {
    downloadBackup(syncStateRef.current, { ...filters, query: searchDraft.current });
  }, [filters]);

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
          <SyncControls
            metadata={syncMetadata}
            controller={driveSync}
            open={syncPanelOpen}
            onOpenChange={setSyncPanelOpen}
            onExport={exportCurrent}
          />
          <button
            className="text-button"
            type="button"
            onClick={exportCurrent}
          >Export</button>
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

        <WatchlistControls
          lists={watchlists} selected={activeList?.id ?? null} onSelect={selectList}
          onCreate={(name) => editList(crypto.randomUUID(), { name })}
          onRename={(id, name) => editList(id, { name })}
          onDelete={(id) => editList(id, { delete: true })}
        />
        <SearchBar
          query={filters.query}
          sort={filters.sort}
          onDraftChange={updateSearchDraft}
          onQueryChange={updateQuery}
          onSortChange={updateSort}
        />

        <FilterPresets getSettings={() => ({ ...filters, query: searchDraft.current })} onApply={setFilters} />
        <button type="button" className="secondary-button mobile-filter-toggle"
          aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
          {filtersOpen ? "Hide filters" : "Show filters"}
        </button>
        <div className="catalog-layout">
          <div className={filtersOpen ? "filter-container is-open" : "filter-container"}>
            <FiltersPanel settings={filters} genres={genres} onChange={setFilters} />
          </div>
          <section className="results-panel" aria-labelledby="results-heading">
            {freshnessWarning && (
              <p className="catalog-warning" role="status">
                {freshnessWarning}{" "}
                {!catalogState.catalog.fixture && (
                  <a href={REFRESH_WORKFLOW_URL} target="_blank" rel="noreferrer">Open refresh workflow ↗</a>
                )}
              </p>
            )}
            <div className="results-heading">
              <div>
                <span className="eyebrow">{activeList ? activeList.list.name.value : "The shortlist"}</span>
                <h2 id="results-heading">{displayedTitles.length} {displayedTitles.length === 1 ? "title" : "titles"}</h2>
                <p className="match-count">Showing {displayedTitles.length.toLocaleString("en-US")} of {matchingTitles.length.toLocaleString("en-US")} matches</p>
              </div>
              <p>Updated {refreshed} <span aria-hidden="true">·</span> TMDB scores</p>
            </div>
            <CatalogList
              key={activeList?.id ?? "discover"}
              catalog={catalogState.catalog}
              titles={displayedTitles}
              seenKeys={seenKeys}
              onToggleSeen={toggleTitle}
              watchlists={watchlists}
              onMembershipChange={(id, key, member) => editList(id, { key, member })}
            />
            {unavailableMembers.length > 0 && (
              <details className="unavailable-members">
                <summary>{unavailableMembers.length} saved titles outside the current catalog</summary>
                <p>These titles stay in your list even if they no longer appear in the US + NL catalog.</p>
                {unavailableMembers.map(([key]) => (
                  <div key={key}>
                    <a href={`https://www.themoviedb.org/${key.replace(":", "/")}`} target="_blank" rel="noreferrer">
                      {key.startsWith("tv:") ? "Series" : "Movie"} {key.split(":")[1]} ↗
                    </a>
                    <button className="text-button" onClick={() => editList(activeList!.id, { key: key as TitleKey, member: false })}>
                      Remove from list
                    </button>
                  </div>
                ))}
              </details>
            )}
          </section>
        </div>
      </main>

      <footer id="credits">
        <div>
          <strong>Flixate</strong>
          <p>A personal, local-first watch finder. Optional sync stores seen history and watchlists in your own private Google Drive app data.</p>
          <p>Coverage includes subscription, free, and ad-supported streaming in the US or Netherlands.
            Rental/purchase-only titles are excluded. Availability can change, and a series may qualify with only some seasons available.</p>
          <nav className="legal-links" aria-label="Legal information">
            <a href={`${import.meta.env.BASE_URL}privacy.html`}>Privacy</a>
            <a href={`${import.meta.env.BASE_URL}terms.html`}>Terms</a>
          </nav>
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
