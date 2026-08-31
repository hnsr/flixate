import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";

type BenchmarkResult = {
  titles: number;
  compressedBytes: number;
  downloadAndDecompressMs: number;
  parseMs: number;
  queryMs: number;
  resultCount: number;
  usedJSHeapSize: number | null;
};

const catalogPath = path.resolve("artifacts", "phase0", "catalog.json.gz");
const compressed = await readFile(catalogPath);

function browserExecutable(): string {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  for (const candidate of ["google-chrome", "chromium", "chromium-browser"]) {
    try {
      return execFileSync("which", [candidate], { encoding: "utf8" }).trim();
    } catch {
      // Try the next locally installed Chromium browser.
    }
  }
  throw new Error("Set CHROME_BIN to a Chrome or Chromium executable");
}

const page = `<!doctype html>
<meta charset="utf-8">
<title>Flixate Phase 0 browser benchmark</title>
<script type="module">
  const downloadStarted = performance.now();
  const response = await fetch('/catalog.json');
  const text = await response.text();
  const downloadAndDecompressMs = performance.now() - downloadStarted;
  const parseStarted = performance.now();
  const catalog = JSON.parse(text);
  const parseMs = performance.now() - parseStarted;
  const queryStarted = performance.now();
  const resultCount = catalog.titles.filter(
    (title) => title.mediaType === 'movie' && (title.rating ?? -1) >= 7,
  ).length;
  const queryMs = performance.now() - queryStarted;
  window.phaseZeroResult = {
    titles: catalog.titles.length,
    compressedBytes: ${compressed.byteLength},
    downloadAndDecompressMs,
    parseMs,
    queryMs,
    resultCount,
    usedJSHeapSize: performance.memory?.usedJSHeapSize ?? null,
  };
</script>`;

const server = createServer((request, response) => {
  if (request.url === "/catalog.json") {
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-encoding": "gzip",
      "content-length": compressed.byteLength,
      "cache-control": "no-store",
    });
    response.end(compressed);
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(page);
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Could not start benchmark server");

const browser = await chromium.launch({
  executablePath: browserExecutable(),
  headless: true,
});

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36",
  });
  const browserPage = await context.newPage();
  const cdp = await context.newCDPSession(browserPage);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await browserPage.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
  await browserPage.waitForFunction(() => "phaseZeroResult" in window);
  const result = await browserPage.evaluate<BenchmarkResult>(
    () => (window as unknown as { phaseZeroResult: BenchmarkResult }).phaseZeroResult,
  );
  console.log(JSON.stringify({ cpuThrottle: 4, viewport: "390x844@3x", ...result }, null, 2));
  await context.close();
} finally {
  await browser.close();
  server.close();
}
