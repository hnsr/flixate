import {
  synopsisShardNumber,
  type CatalogDocument,
  type TitleKey,
} from "../domain/catalog.js";

export async function loadCatalog(signal?: AbortSignal): Promise<CatalogDocument> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/catalog.fixture.json`, { signal });
  if (!response.ok) throw new Error(`Catalog request failed with ${response.status}`);
  return response.json() as Promise<CatalogDocument>;
}

type SynopsisShard = {
  schemaVersion: 1;
  synopses: Partial<Record<TitleKey, string>>;
};

export class SynopsisRepository {
  private readonly shards = new Map<number, Promise<SynopsisShard>>();

  async get(catalog: CatalogDocument, key: TitleKey): Promise<string | null> {
    const shardNumber = synopsisShardNumber(key, catalog.synopsisShards.count);
    let shard = this.shards.get(shardNumber);
    if (!shard) {
      const filename = catalog.synopsisShards.pattern.replace("{shard}", String(shardNumber));
      shard = fetch(`${import.meta.env.BASE_URL}${filename}`)
        .then(async (response) => {
          if (!response.ok) throw new Error(`Synopsis request failed with ${response.status}`);
          return response.json() as Promise<SynopsisShard>;
        })
        .catch((error: unknown) => {
          this.shards.delete(shardNumber);
          throw error;
        });
      this.shards.set(shardNumber, shard);
    }
    return (await shard).synopses[key] ?? null;
  }
}
