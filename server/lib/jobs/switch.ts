/**
 * Kill switch for background jobs: JOB_WORKER=off stops the inline worker of a
 * web process and makes a separate worker process (workers/worker.ts) exit
 * without claiming anything. Pure, so it is unit-tested.
 */
export function jobWorkerOff(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "off";
}
