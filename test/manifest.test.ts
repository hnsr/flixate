import { describe, expect, it } from "vitest";
import { parseCatalogManifest } from "../src/data/manifest.js";
import { synopsisSnapshot } from "./helpers/synopsis.js";

describe("regional catalog manifests", () => {
  it.each([["US", "NL"], ["US", "NL", "GB"]])("accepts supported snapshot regions: %j", (...regions) => {
    const { manifest } = synopsisSnapshot("regions");
    expect(parseCatalogManifest({ ...manifest, regions }).regions).toEqual(regions);
  });

  it.each([[], ["US"], ["GB"], ["US", "NL", "UK"], ["US", "NL", "GB", "GB"], ["US", "NL", "AU"]])(
    "rejects incomplete or unsupported regions: %j", (...regions) => {
      const { manifest } = synopsisSnapshot("regions");
      expect(() => parseCatalogManifest({ ...manifest, regions })).toThrow("supported regional union");
    },
  );
});
