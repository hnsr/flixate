import type { CatalogManifest } from "../catalog/types.js";
import {
  synopsisShardNumber,
  type CatalogDocument,
  type CoreTitle,
  type TitleKey,
} from "../domain/catalog.js";
import { CatalogFileRequestError, fetchGzipJson } from "./compressed-json.js";
import { parseCatalogManifest, resolveManifestFiles } from "./manifest.js";

const LAST_GOOD_MANIFEST_KEY = "flixate:catalog-manifest:v1";

type SynopsisShard = {
  schemaVersion: 1;
  synopses: Partial<Record<TitleKey, string>>;
};

type CatalogWorkerResponse =
  | { ok: true; titles: CoreTitle[] }
  | { ok: false; message: string };

function appAssetUrl(file: string): string {
  const base = new URL(import.meta.env.BASE_URL, location.origin);
  return new URL(file, base).href;
}

function readLastGoodManifest(): CatalogManifest | null {
  try {
    const saved = localStorage.getItem(LAST_GOOD_MANIFEST_KEY);
    return saved ? parseCatalogManifest(JSON.parse(saved)) : null;
  } catch {
    return null;
  }
}

function saveLastGoodManifest(manifest: CatalogManifest): void {
  try {
    localStorage.setItem(LAST_GOOD_MANIFEST_KEY, JSON.stringify(manifest));
  } catch {
    // Catalog use remains possible when local storage is unavailable.
  }
}

async function fetchManifest(url: string, signal?: AbortSignal): Promise<CatalogManifest> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Catalog manifest request failed with ${response.status}`);
  return parseCatalogManifest(await response.json());
}

function loadCoreInWorker(
  manifest: CatalogManifest,
  signal?: AbortSignal,
): Promise<CoreTitle[]> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Catalog request aborted", "AbortError"));
      return;
    }
    const worker = new Worker(new URL("../workers/catalog.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = () => {
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      finish();
      reject(new DOMException("Catalog request aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.onerror = () => {
      finish();
      reject(new Error("The catalog worker could not start"));
    };
    worker.onmessage = (event: MessageEvent<CatalogWorkerResponse>) => {
      finish();
      if (event.data.ok) resolve(event.data.titles);
      else reject(new Error(event.data.message));
    };
    worker.postMessage({
      url: manifest.catalog.file,
      sha256: manifest.catalog.sha256,
      expectedTitles: manifest.counts.titles,
    });
  });
}

async function activateManifest(
  rawManifest: CatalogManifest,
  manifestUrl: string,
  signal?: AbortSignal,
  warning?: string,
): Promise<CatalogDocument> {
  const manifest = resolveManifestFiles(rawManifest, manifestUrl);
  const titles = await loadCoreInWorker(manifest, signal);
  return {
    schemaVersion: 1,
    fixture: false,
    snapshotId: manifest.snapshotId,
    manifestUrl,
    createdAt: manifest.createdAt,
    regions: manifest.regions,
    image: manifest.image,
    synopsisShards: {
      count: manifest.synopsisShards.count,
      format: "gzip-json",
      files: manifest.synopsisShards.shards.map((shard) => ({
        number: shard.number,
        file: shard.file,
        sha256: shard.sha256,
      })),
    },
    ...(warning ? { loadWarning: warning } : {}),
    titles,
  };
}

async function loadProductionCatalog(manifestPath: string, signal?: AbortSignal): Promise<CatalogDocument> {
  const manifestUrl = appAssetUrl(manifestPath);
  const lastGood = readLastGoodManifest();
  try {
    const candidate = await fetchManifest(manifestUrl, signal);
    const catalog = await activateManifest(candidate, manifestUrl, signal);
    saveLastGoodManifest(candidate);
    return catalog;
  } catch (candidateError) {
    if (signal?.aborted) throw candidateError;
    if (lastGood) {
      try {
        return await activateManifest(
          lastGood,
          manifestUrl,
          signal,
          "The latest catalog could not be validated. Using the last known-good snapshot.",
        );
      } catch {
        // Report the original refresh failure when the fallback is unavailable too.
      }
    }
    throw candidateError;
  }
}

export async function loadCatalog(signal?: AbortSignal): Promise<CatalogDocument> {
  const manifestPath = import.meta.env.VITE_CATALOG_MANIFEST_URL?.trim();
  if (manifestPath) return loadProductionCatalog(manifestPath, signal);

  const response = await fetch(appAssetUrl("data/catalog.fixture.json"), { signal });
  if (!response.ok) throw new Error(`Catalog request failed with ${response.status}`);
  return response.json() as Promise<CatalogDocument>;
}

function parseSynopsisShard(value: unknown): SynopsisShard {
  if (
    typeof value !== "object"
    || value === null
    || (value as SynopsisShard).schemaVersion !== 1
    || typeof (value as SynopsisShard).synopses !== "object"
    || (value as SynopsisShard).synopses === null
  ) {
    throw new Error("Synopsis shard has an unsupported schema");
  }
  const shard = value as SynopsisShard;
  if (
    !Object.entries(shard.synopses).every(
      ([key, synopsis]) => /^(movie|tv):\d+$/.test(key) && typeof synopsis === "string",
    )
  ) {
    throw new Error("Synopsis shard contains an invalid record");
  }
  return shard;
}

export class SynopsisRepository {
  private readonly shards = new Map<string, Promise<SynopsisShard>>();
  private readonly sources = new WeakMap<CatalogDocument, CatalogDocument["synopsisShards"]>();
  private readonly refreshes = new Map<string, Promise<CatalogDocument["synopsisShards"]>>();

  async get(catalog: CatalogDocument, key: TitleKey): Promise<string | null> {
    const source = this.sources.get(catalog) ?? catalog.synopsisShards;
    try {
      return (await this.getShard(source, key)).synopses[key] ?? null;
    } catch (error) {
      if (!catalog.manifestUrl || source.format !== "gzip-json"
        || !(error instanceof CatalogFileRequestError) || ![404, 410].includes(error.status)) throw error;

      // A deployment can remove uncached files referenced by an already-open app.
      // Refresh only synopsis metadata; leave the catalog, filters and user state alone.
      const latest = this.sources.get(catalog);
      const refreshed = latest && latest !== source ? latest : await this.refreshSource(catalog.manifestUrl);
      this.sources.set(catalog, refreshed);
      // Recompute the bucket: a newer snapshot may use a different shard count.
      return (await this.getShard(refreshed, key)).synopses[key] ?? null;
    }
  }

  private refreshSource(manifestUrl: string): Promise<CatalogDocument["synopsisShards"]> {
    let refresh = this.refreshes.get(manifestUrl);
    if (!refresh) {
      refresh = (async () => {
        // Bypass HTTP and service-worker manifest caches during recovery.
        const response = await fetch(manifestUrl, { cache: "no-store" });
        if (!response.ok) throw new CatalogFileRequestError(response.status);
        const manifest = resolveManifestFiles(parseCatalogManifest(await response.json()), manifestUrl);
        return { count: manifest.synopsisShards.count, format: "gzip-json" as const,
          files: manifest.synopsisShards.shards };
      })().finally(() => this.refreshes.delete(manifestUrl));
      this.refreshes.set(manifestUrl, refresh);
    }
    return refresh;
  }

  private getShard(source: CatalogDocument["synopsisShards"], key: TitleKey): Promise<SynopsisShard> {
    const shardNumber = synopsisShardNumber(key, source.count);
    const descriptor = source.files?.find(file => file.number === shardNumber);
    const filename = source.format === "gzip-json" ? descriptor?.file
      : source.pattern?.replace("{shard}", String(shardNumber));
    if (!filename) return Promise.reject(new Error(`Synopsis shard ${shardNumber} is missing`));
    const cacheKey = JSON.stringify([source.format, appAssetUrl(filename), descriptor?.sha256]);
    let shard = this.shards.get(cacheKey);
    if (!shard) {
      shard = this.loadShard(source, shardNumber).catch((error: unknown) => {
        this.shards.delete(cacheKey);
        throw error;
      });
      this.shards.set(cacheKey, shard);
    }
    return shard;
  }

  private async loadShard(source: CatalogDocument["synopsisShards"], shardNumber: number): Promise<SynopsisShard> {
    if (source.format === "gzip-json") {
      const descriptor = source.files?.find((file) => file.number === shardNumber);
      if (!descriptor) throw new Error(`Synopsis shard ${shardNumber} is missing from the manifest`);
      return parseSynopsisShard(await fetchGzipJson(descriptor.file, descriptor.sha256));
    }

    const pattern = source.pattern;
    if (!pattern) throw new Error("Synopsis shard pattern is missing");
    const filename = pattern.replace("{shard}", String(shardNumber));
    const response = await fetch(appAssetUrl(filename));
    if (!response.ok) throw new Error(`Synopsis request failed with ${response.status}`);
    return parseSynopsisShard(await response.json());
  }
}
