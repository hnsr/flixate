import { describe, expect, it } from "vitest";
import {
  mergeUserStates,
  migrateUserState,
  seenTitleKeys,
  toggleSeen,
  type UserStateV1,
} from "../src/domain/user-state.js";

describe("user state", () => {
  it("migrates the legacy seen array", () => {
    const state = migrateUserState(
      { version: 0, seen: ["movie:1", "invalid", "tv:2"] },
      "2026-01-01T00:00:00.000Z",
    );
    expect([...seenTitleKeys(state)]).toEqual(["movie:1", "tv:2"]);
    expect(state.titles["movie:1"]?.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("writes explicit unseen tombstones", () => {
    const seen = toggleSeen({ version: 1, titles: {} }, "movie:1", "2026-01-01T00:00:00.000Z");
    const unseen = toggleSeen(seen, "movie:1", "2026-01-02T00:00:00.000Z");
    expect(unseen.titles["movie:1"]).toEqual({ seen: false, updatedAt: "2026-01-02T00:00:00.000Z" });
  });

  it("merges per-title state by timestamp", () => {
    const local: UserStateV1 = {
      version: 1,
      titles: {
        "movie:1": { seen: true, updatedAt: "2026-03-01T00:00:00.000Z" },
        "tv:2": { seen: true, updatedAt: "2026-01-01T00:00:00.000Z" },
      },
    };
    const incoming: UserStateV1 = {
      version: 1,
      titles: {
        "movie:1": { seen: false, updatedAt: "2026-02-01T00:00:00.000Z" },
        "tv:2": { seen: false, updatedAt: "2026-04-01T00:00:00.000Z" },
      },
    };
    const merged = mergeUserStates(local, incoming);
    expect(merged.titles["movie:1"]?.seen).toBe(true);
    expect(merged.titles["tv:2"]?.seen).toBe(false);
  });
});
