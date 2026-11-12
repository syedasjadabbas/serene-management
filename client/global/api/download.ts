import { authorizedFetch } from "./session";

/** The file name from a `Content-Disposition` header (RFC 6266 `filename*` or `filename`). */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const encoded = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim());
    } catch {
      // fall through to the plain form
    }
  }
  const plain = /filename\s*=\s*(?:"([^"]+)"|([^;]+))/.exec(header);
  const name = (plain?.[1] ?? plain?.[2])?.trim();
  return name ? name.replace(/[\/]/g, "_") : fallback;
}

export class DownloadError extends Error {}

/**
 * Downloads an API file (CSV export) with the Bearer header: the browser
 * cannot send it from a plain link. The bytes become a blob that is saved
 * under the server's file name, then released.
 */
export async function downloadApiFile(path: string, fallbackName: string): Promise<string> {
  let response: Response;
  try {
    response = await authorizedFetch(path, { headers: { Accept: "text/csv,*/*" } });
  } catch {
    throw new DownloadError("Cannot reach the server. Check your connection and try again.");
  }
  if (!response.ok) {
    let message = `The export failed (HTTP ${response.status}).`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // not JSON: keep the generic message
    }
    throw new DownloadError(message);
  }
  const filename = filenameFromDisposition(
    response.headers.get("content-disposition"),
    fallbackName,
  );
  const url = URL.createObjectURL(await response.blob());
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    // The download has started; give the browser a moment before releasing the blob.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return filename;
}
