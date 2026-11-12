import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { Response as ExpressResponse } from "express";

/**
 * Writes a Fetch `Response` (status, headers, body stream) built by a service
 * to the Express response, for CSV downloads. The caller returns undefined
 * afterwards (lib/controller.ts leaves a response that was already sent alone).
 */
export async function sendWebResponse(res: ExpressResponse, web: Response): Promise<void> {
  res.status(web.status);
  web.headers.forEach((value, key) => res.setHeader(key, value));
  if (!web.body) {
    res.end();
    return;
  }
  const stream = Readable.fromWeb(web.body as NodeReadableStream);
  await new Promise<void>((resolve, reject) => {
    stream.on("error", reject);
    res.on("close", resolve);
    stream.pipe(res);
  });
}
