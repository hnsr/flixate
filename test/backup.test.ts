import { describe, expect, it } from "vitest";
import { createBackup, parseBackup, previewImport } from "../src/domain/backup.js";
import { DEFAULT_FILTERS } from "../src/domain/catalog.js";
import type { UserStateV1 } from "../src/domain/user-state.js";

describe("backup files", () => {
  it("round-trips a versioned backup", () => {
    const state: UserStateV1 = {
      version: 1,
      titles: { "movie:1": { seen: true, updatedAt: "2026-01-01T00:00:00.000Z" } },
    };
    const backup = createBackup(state, { ...DEFAULT_FILTERS, minimumRating: 7 }, "2026-02-01T00:00:00.000Z");
    expect(parseBackup(JSON.stringify(backup))).toEqual(backup);
  });

  it("rejects unrelated JSON", () => {
    expect(() => parseBackup('{"version":1}')).toThrow("not a supported Flixate backup");
  });

  it("previews newer and older changes without mutating state", () => {
    const local: UserStateV1 = {
      version: 1,
      titles: { "movie:1": { seen: true, updatedAt: "2026-02-01T00:00:00.000Z" } },
    };
    const incoming: UserStateV1 = {
      version: 1,
      titles: {
        "movie:1": { seen: false, updatedAt: "2026-01-01T00:00:00.000Z" },
        "tv:2": { seen: true, updatedAt: "2026-03-01T00:00:00.000Z" },
      },
    };
    expect(previewImport(local, incoming)).toEqual({ newer: 1, unchangedOrOlder: 1, seenAfterMerge: 2 });
    expect(local.titles["tv:2"]).toBeUndefined();
  });
});
