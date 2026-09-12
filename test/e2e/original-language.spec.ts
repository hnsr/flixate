import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("cards show original language beside type and year, with clean legacy fallback", async ({ page }) => {
  const fixture = JSON.parse(readFileSync("public/data/catalog.fixture.json", "utf8"));
  fixture.titles = [
    { key: "tv:1", tmdbId: 1, title: "Korean show", mediaType: "show", originalLanguage: "ko" },
    { key: "movie:2", tmdbId: 2, title: "Dutch film", mediaType: "movie", originalLanguage: "nl" },
    { key: "movie:3", tmdbId: 3, title: "Legacy film", mediaType: "movie" },
  ].map(title => ({ ...title, releaseYear: 1999, genreIds: [18], rating: 8, voteCount: 100 }));
  await page.route("**/data/catalog.fixture.json", route => route.fulfill({ json: fixture }));
  await page.goto("/");
  const korean = page.locator('[data-title-key="tv:1"] .title-kicker');
  const dutch = page.locator('[data-title-key="movie:2"] .title-kicker');
  const legacy = page.locator('[data-title-key="movie:3"] .title-kicker');
  await expect(korean).toHaveText("Series·1999·Korean");
  await expect(dutch).toHaveText("Film·1999·Dutch");
  await expect(legacy).toHaveText("Film·1999");
  await expect(korean.locator('[title="Original language"]')).toHaveText("Korean");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(korean).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
