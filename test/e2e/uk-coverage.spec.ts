import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("coverage follows the snapshot and UK-only titles remain discoverable on mobile", async ({ page }) => {
  const fixture = JSON.parse(readFileSync("public/data/catalog.fixture.json", "utf8"));
  fixture.regions = ["US", "NL", "GB"];
  fixture.titles.push({ key: "tv:312693", tmdbId: 312693, title: "Small Prophets",
    mediaType: "show", genreIds: [35], releaseYear: 2026, rating: 8.325, voteCount: 40 });
  await page.route("**/data/catalog.fixture.json", route => route.fulfill({ json: fixture }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("US + NL + UK", { exact: true })).toBeVisible();
  await expect(page.getByText(/streaming in the US, Netherlands, or UK/)).toBeAttached();
  await page.getByRole("searchbox", { name: "Search titles" }).fill("Small Prophets");
  await expect(page.getByRole("heading", { name: "Small Prophets", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  fixture.regions = ["US", "NL"];
  await page.reload();
  await expect(page.getByText("US + NL", { exact: true })).toBeVisible();
  await expect(page.getByText(/streaming in the US or Netherlands/)).toBeAttached();
});
