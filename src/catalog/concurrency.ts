export async function mapLimit<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit < 1) throw new Error("Concurrency limit must be positive");
  const results = new Array<R>(values.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor++;
      const value = values[index];
      if (value !== undefined) results[index] = await mapper(value, index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );
  return results;
}
