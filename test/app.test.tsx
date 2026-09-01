import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App.js";
import type { CatalogDocument } from "../src/domain/catalog.js";

const catalog: CatalogDocument = {
  schemaVersion: 1,
  fixture: true,
  createdAt: "2026-08-30T00:00:00.000Z",
  regions: ["US", "NL"],
  image: { baseUrl: "https://image.tmdb.org/t/p", posterSize: "w342" },
  synopsisShards: { count: 1, format: "json", pattern: "data/synopsis/{shard}.json" },
  titles: [
    { key: "movie:1", tmdbId: 1, title: "Arrival", releaseYear: 2016, mediaType: "movie", genreIds: [18, 878], rating: 7.6, voteCount: 100 },
    { key: "tv:2", tmdbId: 2, title: "Unrated Show", releaseYear: 2024, mediaType: "show", genreIds: [99], voteCount: 0 },
  ],
};

describe("Flixate app", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body = url.includes("synopsis")
        ? { schemaVersion: 1, synopses: { "movie:1": "Visitors arrive from beyond the stars." } }
        : catalog;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }));
  });

  it("loads details lazily and hides a title after it is marked seen", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("Arrival")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);

    await user.click(screen.getAllByRole("button", { name: "Read synopsis" })[0]!);
    expect(await screen.findByText("Visitors arrive from beyond the stars.")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: "Mark Arrival as seen" }));
    await waitFor(() => expect(screen.queryByText("Arrival")).not.toBeInTheDocument());
    expect(localStorage.getItem("flixate:user-state:v1")).toContain('"seen":true');
  });

  it("updates the search input immediately and applies the catalog query after a debounce", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("Unrated Show")).toBeInTheDocument();
    const search = screen.getByRole("searchbox", { name: "Search titles" });
    await user.type(search, "Arrival");

    expect(search).toHaveValue("Arrival");
    expect(screen.getByText("Unrated Show")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Search and sort" })).toHaveAttribute("aria-busy", "true");

    await waitFor(() => expect(screen.queryByText("Unrated Show")).not.toBeInTheDocument());
    expect(screen.getByRole("region", { name: "Search and sort" })).toHaveAttribute("aria-busy", "false");
  });
});
