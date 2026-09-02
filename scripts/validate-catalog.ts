import path from "node:path";
import { validateCatalogSnapshot } from "../src/catalog/validate-snapshot.js";

const directory = path.resolve(process.argv[2] ?? "public/data/live");

validateCatalogSnapshot(directory).then(
  (manifest) => {
    console.log(
      `Validated catalog ${manifest.snapshotId}: ${manifest.counts.titles.toLocaleString("en-US")} titles, ${manifest.synopsisShards.count} synopsis shards`,
    );
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
