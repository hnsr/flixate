import { parseCoreCatalog } from "../data/catalog-validation.js";
import { fetchGzipJson } from "../data/compressed-json.js";

type CatalogWorkerRequest = {
  url: string;
  sha256: string;
  expectedTitles: number;
};

type CatalogWorkerResponse =
  | { ok: true; titles: ReturnType<typeof parseCoreCatalog>["titles"] }
  | { ok: false; message: string };

self.onmessage = async (event: MessageEvent<CatalogWorkerRequest>) => {
  let response: CatalogWorkerResponse;
  try {
    const payload = await fetchGzipJson(event.data.url, event.data.sha256);
    response = {
      ok: true,
      titles: parseCoreCatalog(payload, event.data.expectedTitles).titles,
    };
  } catch (error) {
    response = {
      ok: false,
      message: error instanceof Error ? error.message : "Could not open the catalog",
    };
  }
  self.postMessage(response);
};
