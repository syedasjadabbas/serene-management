import "server-only";
import { serverEnv } from "@/lib/env";
import { jobHandlers } from "./registry";
import { JobWorker, workerOptionsFromEnv } from "./worker";

const holder = globalThis as unknown as { __sereneJobWorker?: JobWorker };

/**
 * Starts this application process's job worker once (JOB_WORKER=inline,
 * called from instrumentation-node.ts). The graceful shutdown stops it from
 * claiming; jobs still running then are re-claimed elsewhere when their lease
 * expires.
 */
/** The inline worker if this process started one. */
export function inlineWorker(): JobWorker | undefined {
  return holder.__sereneJobWorker;
}

export function startInlineWorker(): JobWorker | null {
  if (serverEnv().JOB_WORKER !== "inline") return null;
  if (holder.__sereneJobWorker) return holder.__sereneJobWorker;
  const worker = new JobWorker(jobHandlers(), workerOptionsFromEnv());
  holder.__sereneJobWorker = worker;
  worker.start();
  // Stopped by the graceful shutdown (lib/lifecycle/register.ts).
  return worker;
}
