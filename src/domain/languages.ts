export function normalizeOriginalLanguage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const code = value.trim().toLowerCase();
  // TMDB's "xx" is an unspecified/no-language marker, not a spoken language.
  return /^[a-z]{2}$/.test(code) && code !== "xx" ? code : undefined;
}

let names: Intl.DisplayNames | undefined;

export function originalLanguageName(value: unknown): string | null {
  const code = normalizeOriginalLanguage(value);
  if (!code) return null;
  names ??= new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });
  // TMDB uses "cn" for Cantonese; Intl uses the standard "yue" tag.
  return names.of(code === "cn" ? "yue" : code) ?? null;
}
