import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("movie and series cards open an encoded IMDb title search in a new tab", async ({ page, context }) => {
  const fixture = JSON.parse(readFileSync("public/data/catalog.fixture.json", "utf8"));
  fixture.titles = [
    { key: "tv:1", tmdbId: 1, title: "Talamasca: The Secret Order", mediaType: "show" },
    { key: "movie:2", tmdbId: 2, title: "Amélie & Friends + #1?", mediaType: "movie" },
  ].map(title => ({ ...title, genreIds: [18], releaseYear: 2025, rating: 8, voteCount: 100 }));
  await page.route("**/data/catalog.fixture.json", route => route.fulfill({ json: fixture }));
  // Verify new-tab behavior without depending on IMDb availability or bot checks.
  await context.route("https://www.imdb.com/**", route => route.fulfill({
    contentType: "text/html", body: "<title>IMDb search test</title>",
  }));
  await page.goto("/");
  for (const title of fixture.titles) {
    const link = page.locator(`[data-title-key="${title.key}"]`).getByRole("link", { name: "IMDb", exact: true });
    const url = `https://www.imdb.com/find/?q=${encodeURIComponent(title.title)}`;
    await expect(link).toHaveAttribute("href", url);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    const popupPromise = page.waitForEvent("popup");
    await link.click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(url);
    expect(new URL(popup.url()).searchParams.get("q")).toBe(title.title);
    await popup.close();
    await expect(page).toHaveURL("/");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("link", { name: "IMDb", exact: true })).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
