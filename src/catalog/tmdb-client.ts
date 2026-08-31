import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RequestStats } from "./types.js";

type Credentials =
  | { token: string; apiKey?: never }
  | { token?: never; apiKey: string };

export function credentialsFromEnvironment(): Credentials {
  const token = process.env.TMDB_API_TOKEN?.trim();
  const apiKey = process.env.TMDB_API_KEY?.trim();
  if (token) return { token };
  if (apiKey) return { apiKey };
  throw new Error("Set TMDB_API_TOKEN or TMDB_API_KEY in .env");
}

class StartRateGate {
  private nextStart = 0;
  private chain = Promise.resolve();

  constructor(private readonly requestsPerSecond: number) {}

  wait(): Promise<void> {
    const run = this.chain.then(async () => {
      const now = Date.now();
      const delay = Math.max(0, this.nextStart - now);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      this.nextStart = Date.now() + Math.ceil(1000 / this.requestsPerSecond);
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}

export class TmdbClient {
  readonly stats: RequestStats = {
    networkRequests: 0,
    cacheHits: 0,
    retries: 0,
    rateLimits: 0,
  };

  private readonly gate: StartRateGate;

  constructor(
    private readonly credentials: Credentials,
    private readonly cacheDir: string,
    requestsPerSecond = 18,
  ) {
    this.gate = new StartRateGate(requestsPerSecond);
  }

  async get<T>(endpoint: string, params: Record<string, string | number | boolean | undefined>): Promise<T> {
    const publicParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) publicParams.set(key, String(value));
    }
    const cacheKey = createHash("sha256")
      .update(`${endpoint}?${publicParams.toString()}`)
      .digest("hex");
    const cacheFile = path.join(this.cacheDir, `${cacheKey}.json`);

    try {
      const cached = await readFile(cacheFile, "utf8");
      this.stats.cacheHits++;
      return JSON.parse(cached) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const url = new URL(`https://api.themoviedb.org/3${endpoint}`);
    for (const [key, value] of publicParams) url.searchParams.set(key, value);
    if (this.credentials.apiKey) url.searchParams.set("api_key", this.credentials.apiKey);

    for (let attempt = 0; attempt < 6; attempt++) {
      await this.gate.wait();
      this.stats.networkRequests++;
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          ...(this.credentials.token
            ? { Authorization: `Bearer ${this.credentials.token}` }
            : {}),
        },
      });

      if (response.ok) {
        const body = (await response.json()) as T;
        await mkdir(this.cacheDir, { recursive: true });
        await writeFile(cacheFile, JSON.stringify(body));
        return body;
      }

      if (response.status === 429 || response.status >= 500) {
        this.stats.retries++;
        if (response.status === 429) this.stats.rateLimits++;
        const retryAfter = Number(response.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : Math.min(30_000, 500 * 2 ** attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      const body = await response.text();
      throw new Error(`TMDB ${endpoint} returned ${response.status}: ${body.slice(0, 300)}`);
    }

    throw new Error(`TMDB ${endpoint} failed after retries`);
  }
}
