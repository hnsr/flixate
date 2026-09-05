import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("discovery limits after filtering, refills seen results, and remembers a year preset", async ({ page }) => {
  const fixture = JSON.parse(readFileSync("public/data/catalog.fixture.json", "utf8"));
  fixture.titles = Array.from({ length: 105 }, (_, i) => ({
    key: `movie:${i + 1}`, tmdbId: i + 1, title: `Test title ${String(i + 1).padStart(3, "0")}`,
    releaseYear: 1900 + i, mediaType: "movie", genreIds: [18], rating: 8, voteCount: 100,
  }));
  await page.route("**/data/catalog.fixture.json", route => route.fulfill({ json: fixture }));
  await page.goto("/");
  await expect(page.getByText("Showing 100 of 105 matches")).toBeVisible();
  await page.getByRole("button", { name: "Mark Test title 001 as seen", exact: true }).click();
  await expect(page.getByText("Showing 100 of 104 matches")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search titles" }).fill("Test title 105");
  await expect(page.getByRole("heading", { name: "Test title 105", exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search titles" }).fill("");
  await page.getByRole("spinbutton", { name: "Year from", exact: true }).fill("2000");
  await page.getByRole("spinbutton", { name: "Year through", exact: true }).fill("2004");
  await expect(page.getByText("Showing 5 of 5 matches")).toBeVisible();
  await page.getByText("Saved filters", { exact: true }).click();
  await page.getByRole("textbox", { name: "Preset name" }).fill("Early 2000s");
  await page.getByRole("button", { name: "Save current filters" }).click();
  await page.getByRole("button", { name: /^Reset/ }).click();
  await expect(page.getByText("Showing 100 of 104 matches")).toBeVisible();
  await page.getByRole("combobox", { name: "Apply saved filters" }).selectOption({ label: "Early 2000s" });
  await expect(page.getByText("Showing 5 of 5 matches")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Showing 5 of 5 matches")).toBeVisible();
  await page.getByText("Saved filters · 1", { exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Apply saved filters" })).toContainText("Early 2000s");
});

test("multiple lists survive reload and backup restoration; removing one keeps the other and seen history", async ({ page, browser }) => {
  await page.route("https://image.tmdb.org/**", route => route.abort());
  await page.goto("/");
  await page.getByText("Manage watchlists", { exact: true }).click();
  for (const name of ["Friday", "Together"]) {
    await page.getByRole("textbox", { name: "New watchlist", exact: true }).fill(name);
    await page.getByRole("button", { name: "Create list", exact: true }).click();
  }
  await page.getByRole("searchbox", { name: "Search titles" }).fill("Arrival");
  const arrival = page.locator('[data-title-key="movie:329865"]');
  await arrival.getByRole("button", { name: "Watchlists for Arrival", exact: true }).click();
  await arrival.getByRole("checkbox", { name: "Friday", exact: true }).check();
  await arrival.getByRole("checkbox", { name: "Together", exact: true }).check();
  await page.getByRole("button", { name: "Friday 1", exact: true }).click();
  await arrival.getByRole("button", { name: "Mark Arrival as seen", exact: true }).click();
  await expect(arrival).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Friday 1", exact: true }).click();
  await expect(arrival.getByRole("button", { name: "Mark Arrival as unseen" })).toBeVisible();
  await page.getByText("Manage watchlists", { exact: true }).click();
  await page.getByRole("textbox", { name: "Rename selected watchlist" }).fill("Weekend");
  await page.getByRole("button", { name: "Rename list", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const backup = Buffer.concat(chunks);
  expect(JSON.parse(backup.toString()).version).toBe(2);

  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await fresh.newPage();
  await phone.route("https://image.tmdb.org/**", route => route.abort());
  await phone.goto("http://127.0.0.1:4173/");
  await phone.getByLabel("Import Flixate backup").setInputFiles({
    name: "backup.json", mimeType: "application/json", buffer: backup,
  });
  await phone.getByRole("button", { name: "Merge backup", exact: true }).click();
  await phone.getByRole("button", { name: "Weekend 1", exact: true }).click();
  await expect(phone.getByRole("button", { name: "Mark Arrival as unseen" })).toBeVisible();
  await phone.getByText("Manage watchlists", { exact: true }).click();
  await phone.getByRole("button", { name: "Delete list", exact: true }).click();
  await phone.getByRole("button", { name: "Confirm delete list", exact: true }).click();
  await expect(phone.getByRole("button", { name: "Weekend 1", exact: true })).toHaveCount(0);
  await phone.getByRole("button", { name: "Together 1", exact: true }).click();
  await expect(phone.getByRole("button", { name: "Mark Arrival as unseen" })).toBeVisible();
  await expect(phone.getByRole("complementary", { name: "Catalog filters" })).toBeHidden();
  await phone.getByRole("button", { name: "Show filters", exact: true }).click();
  await expect(phone.getByRole("spinbutton", { name: "Year from" })).toBeVisible();
  expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await fresh.close();
});
