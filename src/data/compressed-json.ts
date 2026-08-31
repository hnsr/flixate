export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function decompressGzip(bytes: ArrayBuffer): Promise<string> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot decompress the catalog");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

export async function decodeGzipJson(
  bytes: ArrayBuffer,
  expectedSha256: string,
): Promise<unknown> {
  const actualSha256 = await sha256Hex(bytes);
  if (actualSha256 !== expectedSha256) throw new Error("Catalog file integrity check failed");
  return JSON.parse(await decompressGzip(bytes)) as unknown;
}

export async function fetchGzipJson(
  url: string,
  expectedSha256: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Catalog file request failed with ${response.status}`);
  return decodeGzipJson(await response.arrayBuffer(), expectedSha256);
}
