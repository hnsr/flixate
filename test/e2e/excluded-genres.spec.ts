import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("genre exclusions are mutually exclusive, persist in presets/backups, and reset on mobile", async ({ page }) => {
  const fixture = JSON.parse(readFileSync("public/data/catalog.fixture.json", "utf8"));
  fixture.titles = [
    { key: "movie:1", tmdbId: 1, title: "Drama film", genreIds: [18] },
    { key: "movie:2", tmdbId: 2, title: "Documentary drama", genreIds: [18, 99] },
    { key: "movie:3", tmdbId: 3, title: "Animated drama", genreIds: [18, 16] },
  ].map(title => ({ ...title, mediaType: "movie", releaseYear: 2020, rating: 8, voteCount: 100 }));
  await page.route("**/data/catalog.fixture.json", route => route.fulfill({ json: fixture }));
  await page.goto("/");
  const exclusions = page.locator(".excluded-genres");
  const summary = exclusions.locator("summary");
  await expect(summary).toHaveText("Exclude genres");
  await expect(page.getByRole("button", { name: "Exclude Documentary", exact: true })).toBeHidden();
  await summary.click();
  const includeDocumentary = page.getByRole("button", { name: "Documentary", exact: true });
  const excludeDocumentary = page.getByRole("button", { name: "Exclude Documentary", exact: true });
  await includeDocumentary.click();
  await excludeDocumentary.click();
  await expect(includeDocumentary).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("heading", { name: "Documentary drama", exact: true })).toBeHidden();
  await includeDocumentary.click();
  await expect(excludeDocumentary).toHaveAttribute("aria-pressed", "false");
  await excludeDocumentary.click();
  await page.getByRole("button", { name: "Exclude Animation", exact: true }).click();
  await page.getByRole("button", { name: "Drama", exact: true }).click();
  await expect(page.getByText("Showing 1 of 1 matches")).toBeVisible();
  await summary.click();
  await expect(summary).toHaveText("Exclude genres · 2");
  await page.getByText("Saved filters", { exact: true }).click();
  await page.getByRole("textbox", { name: "Preset name" }).fill("Drama without docs or animation");
  await page.getByRole("button", { name: "Save current filters" }).click();
  await page.reload();
  await expect(page.getByText("Showing 1 of 1 matches")).toBeVisible();
  await expect(summary).toHaveText("Exclude genres · 2");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const backup = Buffer.concat(chunks);
  expect(JSON.parse(backup.toString()).settings.excludedGenres).toEqual(["Documentary", "Animation"]);
  await page.getByRole("button", { name: /^Reset/ }).click();
  await expect(page.getByText("Showing 3 of 3 matches")).toBeVisible();
  await page.getByText("Saved filters · 1", { exact: true }).click();
  await page.getByRole("combobox", { name: "Apply saved filters" })
    .selectOption({ label: "Drama without docs or animation" });
  await expect(summary).toHaveText("Exclude genres · 2");
  await expect(page.getByText("Showing 1 of 1 matches")).toBeVisible();
  await page.getByRole("button", { name: /^Reset/ }).click();
  await page.getByLabel("Import Flixate backup").setInputFiles({
    name: "backup.json", mimeType: "application/json", buffer: backup,
  });
  await page.getByRole("button", { name: "Merge backup" }).click();
  await expect(page.getByText("Showing 1 of 1 matches")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Show filters", exact: true }).click();
  await expect(summary).toHaveText("Exclude genres · 2");
  await summary.click();
  await expect(excludeDocumentary).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: /^Reset/ }).click();
  await expect(summary).toHaveText("Exclude genres");
  await expect(excludeDocumentary).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("Showing 3 of 3 matches")).toBeVisible();
});
