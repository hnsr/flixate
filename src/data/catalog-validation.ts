import { GENRE_LABELS, type CoreTitle } from "../domain/catalog.js";

type CoreCatalogPayload = {
  schemaVersion: 1;
  titles: CoreTitle[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTitle(value: unknown): value is CoreTitle {
  if (!isRecord(value)) return false;
  if (typeof value.key !== "string" || !/^(movie|tv):\d+$/.test(value.key)) return false;
  if (!Number.isInteger(value.tmdbId) || (value.tmdbId as number) < 1) return false;
  if (value.key !== `${value.key.startsWith("tv:") ? "tv" : "movie"}:${value.tmdbId}`) return false;
  if (typeof value.title !== "string" || !value.title.trim()) return false;
  if (value.mediaType !== "movie" && value.mediaType !== "show") return false;
  if ((value.mediaType === "show") !== value.key.startsWith("tv:")) return false;
  if (
    !Array.isArray(value.genreIds)
    || !value.genreIds.every((genreId) => Number.isInteger(genreId) && GENRE_LABELS[Number(genreId)])
  ) return false;
  if (
    value.releaseYear !== undefined
    && (!Number.isInteger(value.releaseYear) || (value.releaseYear as number) < 1800 || (value.releaseYear as number) > 2200)
  ) return false;
  if (value.rating !== undefined && (typeof value.rating !== "number" || !Number.isFinite(value.rating) || value.rating < 0 || value.rating > 10)) return false;
  if (!Number.isInteger(value.voteCount) || (value.voteCount as number) < 0) return false;
  if (value.rating !== undefined && (value.voteCount as number) < 1) return false;
  if (value.posterPath !== undefined && (typeof value.posterPath !== "string" || !value.posterPath.startsWith("/"))) return false;
  return true;
}

export function parseCoreCatalog(value: unknown, expectedTitles: number): CoreCatalogPayload {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.titles)) {
    throw new Error("Catalog payload has an unsupported schema");
  }
  if (value.titles.length !== expectedTitles) {
    throw new Error(`Catalog expected ${expectedTitles} titles but found ${value.titles.length}`);
  }
  if (!value.titles.every(validTitle)) throw new Error("Catalog contains an invalid title record");
  const keys = new Set(value.titles.map((title) => (title as CoreTitle).key));
  if (keys.size !== value.titles.length) throw new Error("Catalog contains duplicate title keys");
  return value as CoreCatalogPayload;
}
