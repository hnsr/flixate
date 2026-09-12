import { Blob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SynopsisRepository } from "../src/data/catalog.js";
import { synopsisSnapshot } from "./helpers/synopsis.js";

beforeEach(() => {
  vi.stubGlobal("Blob", Blob);
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => vi.unstubAllGlobals());

describe("synopsis snapshot recovery", () => {
  it("refreshes a removed shard, recomputes its bucket, and shares concurrent requests", async () => {
    const old = synopsisSnapshot("old");
    const current = synopsisSnapshot("current", 2);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("manifest.json")) return Response.json(current.manifest);
      if (url.includes("old-")) return new Response(null, { status: 404 });
      expect(url).toBe("http://localhost/data/live/synopsis/current-1.json.gz.bin");
      return new Response(current.bodies[1]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const repository = new SynopsisRepository();
    expect(await Promise.all([repository.get(old.catalog, "movie:1"), repository.get(old.catalog, "movie:1")]))
      .toEqual(["current synopsis", "current synopsis"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledWith(old.catalog.manifestUrl, { cache: "no-store" });
    expect(await repository.get(old.catalog, "movie:1")).toBe("current synopsis");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not mix identical bucket numbers from different catalogs", async () => {
    const a = synopsisSnapshot("a"), b = synopsisSnapshot("b");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(url.includes("/a-") ? a.bodies[0] : b.bodies[0])));
    const repository = new SynopsisRepository();
    expect(await repository.get(a.catalog, "movie:1")).toBe("a synopsis");
    expect(await repository.get(b.catalog, "movie:1")).toBe("b synopsis");
  });

  it("keeps cached synopses usable offline without refreshing metadata", async () => {
    const snapshot = synopsisSnapshot("cached");
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(snapshot.bodies[0]))
      .mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const repository = new SynopsisRepository();
    expect(await repository.get(snapshot.catalog, "movie:1")).toBe("cached synopsis");
    expect(await repository.get(snapshot.catalog, "movie:1")).toBe("cached synopsis");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not hide an integrity failure by switching snapshots", async () => {
    const snapshot = synopsisSnapshot("valid");
    const fetchMock = vi.fn(async () => new Response(synopsisSnapshot("corrupt").bodies[0]));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new SynopsisRepository().get(snapshot.catalog, "movie:1")).rejects.toThrow("integrity");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows retry after a failed refresh and bounds each attempt to one refresh", async () => {
    const old = synopsisSnapshot("old"), next = synopsisSnapshot("next");
    let online = false;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("manifest.json")) {
        if (!online) throw new TypeError("offline");
        return Response.json(next.manifest);
      }
      return new Response(null, { status: 410 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const repository = new SynopsisRepository();
    await expect(repository.get(old.catalog, "movie:1")).rejects.toThrow("offline");
    online = true;
    await expect(repository.get(old.catalog, "movie:1")).rejects.toThrow("410");
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("manifest.json"))).toHaveLength(2);
    fetchMock.mockImplementation(async (url: string) => url.endsWith("manifest.json")
      ? Response.json(next.manifest) : new Response(next.bodies[0]));
    expect(await repository.get(old.catalog, "movie:1")).toBe("next synopsis");
  });

  it("rejects malformed refreshed manifests without replacing the saved core manifest", async () => {
    const old = synopsisSnapshot("old");
    localStorage.setItem("flixate:catalog-manifest:v1", "keep validated core");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("manifest.json")
      ? Response.json({ schemaVersion: 999 }) : new Response(null, { status: 404 })));
    await expect(new SynopsisRepository().get(old.catalog, "movie:1")).rejects.toThrow("unsupported schema");
    expect(localStorage.getItem("flixate:catalog-manifest:v1")).toBe("keep validated core");
  });
});
