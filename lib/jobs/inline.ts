import "server-only";
import { serverEnv } from "@/lib/env";
import { jobHandlers } from "./registry";
import { JobWorker, workerOptionsFromEnv } from "./worker";

const holder = globalThis as unknown as { __sereneJobWorker?: JobWorker };

/**
 * Starts this application process's job worker once (JOB_WORKER=inline,
 * called from instrumentation-node.ts). Stops claiming on SIGTERM/SIGINT;
 * jobs still running then are re-claimed elsewhere when their lease expires.
 */
export function startInlineWorker(): JobWorker | null {
  if (serverEnv().JOB_WORKER !== "inline") return null;
  if (holder.__sereneJobWorker) return holder.__sereneJobWorker;
  const worker = new JobWorker(jobHandlers(), workerOptionsFromEnv());
  holder.__sereneJobWorker = worker;
  worker.start();
  const stop = () => void worker.stop(10_000);
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  return worker;
}
