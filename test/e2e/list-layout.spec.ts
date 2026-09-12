import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("long lists use page scrolling and remain complete when filters and cards expand", async ({ page }) => {
  const fixture = JSON.parse(readFileSync("public/data/catalog.fixture.json", "utf8"));
  const genres = [12, 14, 16, 18, 27, 28, 35, 36, 37, 53, 80, 99, 878, 9648, 10402,
    10749, 10751, 10752, 10762, 10763, 10764, 10766, 10767, 10768, 10770];
  fixture.titles = Array.from({ length: 100 }, (_, index) => ({
    key: `movie:${index + 1}`, tmdbId: index + 1, title: `Film ${String(index + 1).padStart(3, "0")}`,
    mediaType: "movie", genreIds: [genres[index % genres.length]], rating: 8, voteCount: 100,
  }));
  await page.route("**/data/catalog.fixture.json", route => route.fulfill({ json: fixture }));
  await page.route("**/data/synopsis/**", route => route.fulfill({ json: {
    schemaVersion: 1, synopses: { "movie:100": "An unusually long synopsis. ".repeat(90) },
  } }));
  await page.goto("/");
  const list = page.locator(".catalog-virtual");
  const lastCard = page.locator('[data-title-key="movie:100"]');
  const summary = page.locator(".excluded-genres summary");
  await expect(list).toBeVisible();
  await expect(list).toHaveCSS("overflow-y", "visible");
  await expect(page.locator(".filter-container")).toHaveCSS("position", "static");
  await summary.click();

  const reachLastAction = async () => {
    await expect.poll(async () => {
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      const box = await lastCard.getByRole("button", { name: "Mark Film 100 as seen", exact: true }).boundingBox();
      return !!box && box.y >= 0 && box.y + box.height <= page.viewportSize()!.height;
    }).toBe(true);
  };
  await reachLastAction();
  // The page footer follows the whole list, not the bottom of a short inner viewport.
  expect(await page.locator("article").count()).toBeLessThan(30);
  await lastCard.getByRole("button", { name: "Read synopsis", exact: true }).click();
  await expect(lastCard.locator(".synopsis")).toContainText("An unusually long synopsis.");
  await reachLastAction();
  const cardBox = await lastCard.boundingBox();
  const footerBox = await page.locator("footer").boundingBox();
  expect(footerBox!.y).toBeGreaterThanOrEqual(cardBox!.y + cardBox!.height);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.getByRole("button", { name: "Show filters", exact: true }).click();
  // Exclusions stayed expanded. Both opening the mobile panel and collapsing
  // this section move the list's document offset; neither may leave blank rows.
  await summary.click();
  await summary.click();
  await page.evaluate(() => {
    const list = document.querySelector(".catalog-virtual")!;
    window.scrollTo({ top: list.getBoundingClientRect().top + window.scrollY, behavior: "instant" });
  });
  await expect(page.getByRole("heading", { name: "Film 001", exact: true })).toBeVisible();
  await reachLastAction();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
