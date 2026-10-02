/**
 * `npm start`: `next start` with graceful shutdown owned by the application
 * (docs/OPERATIONS.md §10). NEXT_MANUAL_SIG_HANDLE must be set before Next.js
 * starts, so it is set here rather than in .env; lib/lifecycle then drains
 * readiness, ends event streams and job claims, waits for in-flight requests
 * and closes the pools on SIGTERM / SIGINT. Arguments pass through
 * (`npm start -- -p 3100`).
 */
process.env.NEXT_MANUAL_SIG_HANDLE ??= "true";
process.argv = [process.argv[0], "next", "start", ...process.argv.slice(2)];
await import("../node_modules/next/dist/bin/next");
