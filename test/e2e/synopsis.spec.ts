import { expect, test } from "@playwright/test";
import { synopsisSnapshot } from "../helpers/synopsis.js";

test("an open catalog recovers a removed gzip synopsis without reloading or losing filters", async ({ page }) => {
  const old = synopsisSnapshot("old"), current = synopsisSnapshot("current", 2);
  const origin = "http://127.0.0.1:4173";
  old.catalog.manifestUrl = `${origin}/data/live/manifest.json`;
  old.catalog.synopsisShards.files!.forEach(file => { file.file = file.file.replace("http://localhost", origin); });
  let refreshes = 0;
  await page.route("**/data/catalog.fixture.json", route => route.fulfill({ json: old.catalog }));
  await page.route("**/data/live/manifest.json", route => {
    refreshes++;
    return route.fulfill({ json: current.manifest });
  });
  await page.route("**/data/live/synopsis/**", route => route.request().url().includes("old-")
    ? route.fulfill({ status: 404 }) : route.fulfill({ body: current.bodies[1], contentType: "application/octet-stream" }));
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search titles" }).fill("Recovery Film");
  await page.getByRole("button", { name: "Read synopsis" }).click();
  await expect(page.getByText("current synopsis", { exact: true })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search titles" })).toHaveValue("Recovery Film");
  expect(refreshes).toBe(1);
});

test("a failed synopsis can be retried explicitly and by reopening details", async ({ page }) => {
  let available = false;
  await page.route("**/data/synopsis/**", route => available
    ? route.continue() : route.fulfill({ status: 503 }));
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search titles" }).fill("Arrival");
  const arrival = page.locator('[data-title-key="movie:329865"]');
  await arrival.getByRole("button", { name: "Read synopsis" }).click();
  await expect(page.getByRole("button", { name: "Retry synopsis" })).toBeVisible();
  available = true;
  await page.getByRole("button", { name: "Retry synopsis" }).click();
  await expect(page.getByText(/expert linguist is recruited/i)).toBeVisible();
  available = false;
  await page.reload();
  await arrival.getByRole("button", { name: "Read synopsis" }).click();
  await expect(page.getByRole("button", { name: "Retry synopsis" })).toBeVisible();
  await page.getByRole("button", { name: "Close details" }).click();
  available = true;
  await arrival.getByRole("button", { name: "Read synopsis" }).click();
  await expect(page.getByText(/expert linguist is recruited/i)).toBeVisible();
});
