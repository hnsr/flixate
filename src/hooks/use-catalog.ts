import { useEffect, useState } from "react";
import { loadCatalog } from "../data/catalog.js";
import type { CatalogDocument } from "../domain/catalog.js";

type CatalogState =
  | { status: "loading" }
  | { status: "ready"; catalog: CatalogDocument }
  | { status: "error"; message: string };

export function useCatalog(): CatalogState {
  const [state, setState] = useState<CatalogState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    loadCatalog(controller.signal)
      .then((catalog) => setState({ status: "ready", catalog }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load the catalog.",
        });
      });
    return () => controller.abort();
  }, []);

  return state;
}
