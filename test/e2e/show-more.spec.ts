import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

async function openCatalog(page: Page): Promise<void> {
  const fixture = JSON.parse(readFileSync("public/data/catalog.fixture.json", "utf8"));
  fixture.titles = Array.from({ length: 250 }, (_, index) => ({
    key: `movie:${index + 1}`, tmdbId: index + 1,
    title: `Film ${String(index + 1).padStart(3, "0")}`, mediaType: "movie",
    genreIds: [18], releaseYear: 2020, rating: 8, voteCount: 100,
  }));
  await page.route("**/data/catalog.fixture.json", route => route.fulfill({ json: fixture }));
  await page.goto("/");
}

test("show more appends batches, preserves reading position, refills seen titles, and reaches the final match", async ({ page }) => {
  await openCatalog(page);
  await expect(page.getByText("Showing 100 of 250 matches")).toBeVisible();
  const more = page.getByRole("button", { name: "Show 100 more", exact: true });
  await more.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  await more.click();
  await expect(page.getByText("Showing 200 of 250 matches")).toBeVisible();
  expect(Math.abs(await page.evaluate(() => window.scrollY) - before)).toBeLessThan(300);
  await page.getByRole("button", { name: "Mark Film 100 as seen", exact: true }).click();
  await expect(page.getByText("Showing 200 of 249 matches")).toBeVisible();
  await page.getByRole("button", { name: "Show 49 more", exact: true }).click();
  await expect(page.getByText("Showing 249 of 249 matches")).toBeVisible();
  await expect(page.locator(".load-more-titles")).toHaveCount(0);
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await expect(page.getByRole("heading", { name: "Film 250", exact: true })).toBeVisible();
  expect(await page.locator("article").count()).toBeLessThan(40);
  await page.reload();
  await expect(page.getByText("Showing 100 of 249 matches")).toBeVisible();
});

test("search, filters, sort, and watchlist navigation reset discovery batches", async ({ page }) => {
  await openCatalog(page);
  const more = page.getByRole("button", { name: "Show 100 more", exact: true });
  const expand = async () => {
    await more.click();
    await expect(page.getByText("Showing 200 of 250 matches")).toBeVisible();
  };
  await expand();
  await page.getByRole("combobox", { name: "Sort", exact: true }).selectOption("title");
  await expect(page.getByText("Showing 100 of 250 matches")).toBeVisible();
  await expand();
  await page.getByRole("combobox", { name: "Minimum votes", exact: true }).selectOption("50");
  await expect(page.getByText("Showing 100 of 250 matches")).toBeVisible();
  await expand();
  await page.getByRole("searchbox", { name: "Search titles" }).fill("Film 250");
  await expect(page.getByText("Showing 1 of 1 matches")).toBeVisible();
  await expect(page.locator(".load-more-titles")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search titles" }).fill("");
  await expect(page.getByText("Showing 100 of 250 matches")).toBeVisible();
  await expand();
  await page.getByText("Manage watchlists", { exact: true }).click();
  await page.getByRole("textbox", { name: "New watchlist", exact: true }).fill("Weekend");
  await page.getByRole("button", { name: "Create list", exact: true }).click();
  await page.getByRole("button", { name: "Weekend 0", exact: true }).click();
  await expect(page.locator(".load-more-titles")).toHaveCount(0);
  await page.getByRole("button", { name: "Discover", exact: true }).click();
  await expect(page.getByText("Showing 100 of 250 matches")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await more.click();
  await expect(page.getByText("Showing 200 of 250 matches")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
