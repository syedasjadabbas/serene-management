"use client";

import "./globals.css";

/**
 * Last-resort boundary for errors in the root layout itself (Next.js renders
 * it instead of the whole document). Plain markup: providers and the design
 * system's client components may be what failed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-full bg-surface text-fg">
        <main
          role="alert"
          className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center"
        >
          <h1 className="text-lg font-semibold">SERENE MANAGEMENT is unavailable</h1>
          <p className="text-sm text-fg-secondary">
            Something went wrong while loading the application. Try again in a moment.
          </p>
          {error.digest ? (
            <p className="font-mono text-2xs text-fg-muted">Reference: {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            className="mt-2 min-h-11 rounded-md border border-border px-4 text-sm font-medium"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
