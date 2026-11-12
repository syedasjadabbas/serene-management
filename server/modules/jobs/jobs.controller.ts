import { handle } from "@/lib/controller";
import { getJobForRequester } from "./jobs.service";

/**
 * Status of a background job the caller started: status, attempts, public
 * progress, result or error. Any other job answers 404, as if it did not exist.
 */
export const get = handle((req) => getJobForRequester(req.ctx, req.params.jobId));
