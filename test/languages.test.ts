import { describe, expect, it } from "vitest";
import { normalizeOriginalLanguage, originalLanguageName } from "../src/domain/languages.js";

describe("original language labels", () => {
  it("displays readable names, including TMDB's Cantonese code", () => {
    expect(originalLanguageName("ko")).toBe("Korean");
    expect(originalLanguageName("nl")).toBe("Dutch");
    expect(originalLanguageName("ja")).toBe("Japanese");
    expect(originalLanguageName("en")).toBe("English");
    expect(originalLanguageName("cn")).toBe("Cantonese");
  });
  it("normalizes valid codes and omits unknown or missing values", () => {
    expect(normalizeOriginalLanguage(" KO ")).toBe("ko");
    for (const value of [undefined, null, "", "xx", "und", "English", "en-US", 42, "<script>"]) {
      expect(normalizeOriginalLanguage(value)).toBeUndefined();
      expect(originalLanguageName(value)).toBeNull();
    }
    expect(originalLanguageName("zz")).toBeNull();
  });
});
