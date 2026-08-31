import { expect, test } from "@playwright/test";

test("seen state survives a reload and synopsis is loaded on demand", async ({ page }) => {
  await page.route("https://image.tmdb.org/**", (route) => route.abort());
  await page.goto("/");

  const search = page.getByRole("searchbox", { name: "Search titles" });
  await search.fill("Arrival");
  const arrival = page.locator('[data-title-key="movie:329865"]');
  await expect(arrival.getByRole("heading", { name: "Arrival", exact: true })).toBeVisible();

  await arrival.getByRole("button", { name: "Read synopsis" }).click();
  await expect(arrival.getByText(/expert linguist is recruited/i)).toBeVisible();

  await arrival.getByRole("button", { name: "Mark Arrival as seen" }).click();
  await expect(arrival).toBeHidden();

  await page.reload();
  await expect(search).toHaveValue("Arrival");
  await expect(arrival).toBeHidden();

  await page.getByRole("button", { name: "Only seen" }).click();
  await expect(arrival.getByRole("heading", { name: "Arrival", exact: true })).toBeVisible();
  await expect(arrival.getByRole("button", { name: "Mark Arrival as unseen" })).toBeVisible();
});

test("a backup can be exported, previewed, and restored", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search titles" }).fill("The Matrix");
  const matrix = page.locator('[data-title-key="movie:603"]');
  await matrix.getByRole("button", { name: "Mark The Matrix as seen" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^flixate-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const backup = Buffer.concat(chunks);

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole("searchbox", { name: "Search titles" })).toHaveValue("");

  await page.getByLabel("Import Flixate backup").setInputFiles({
    name: "flixate-backup.json",
    mimeType: "application/json",
    buffer: backup,
  });
  await expect(page.getByRole("heading", { name: "Bring this history in?" })).toBeVisible();
  await expect(page.locator(".import-stats div").filter({ hasText: "Newer changes" }).locator("dd")).toHaveText("1");
  await page.getByRole("button", { name: "Merge backup" }).click();

  await expect(page.getByRole("searchbox", { name: "Search titles" })).toHaveValue("The Matrix");
  await page.getByRole("button", { name: "Only seen" }).click();
  await expect(matrix.getByRole("heading", { name: "The Matrix" })).toBeVisible();
});
