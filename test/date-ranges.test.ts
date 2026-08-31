import { describe, expect, it } from "vitest";
import { daysInRange, splitDateRange } from "../src/catalog/date-ranges.js";

describe("date ranges", () => {
  it("splits an inclusive even range without gaps or overlap", () => {
    expect(splitDateRange({ start: "2024-01-01", end: "2024-01-04" })).toEqual([
      { start: "2024-01-01", end: "2024-01-02" },
      { start: "2024-01-03", end: "2024-01-04" },
    ]);
  });

  it("splits an odd range and preserves every day", () => {
    const split = splitDateRange({ start: "2024-02-27", end: "2024-03-02" });
    expect(split).toEqual([
      { start: "2024-02-27", end: "2024-02-28" },
      { start: "2024-02-29", end: "2024-03-02" },
    ]);
    expect(split?.reduce((sum, range) => sum + daysInRange(range), 0)).toBe(5);
  });

  it("does not split a single day", () => {
    expect(splitDateRange({ start: "2024-01-01", end: "2024-01-01" })).toBeNull();
  });
});
