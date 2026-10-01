import { defineSessionRoute } from "@/lib/http/route";
import { jobParamsSchema } from "@/modules/jobs/jobs.schema";
import { getJobForRequester } from "@/modules/jobs/jobs.service";

/**
 * Status of a background job the caller started (docs/SCALABILITY.md §33):
 * status, attempts, public progress, result or error. Any other job — another
 * user's, another organization's, or one at a property the caller can no
 * longer reach — answers 404, as if it did not exist.
 */
export const GET = defineSessionRoute({
  params: jobParamsSchema,
  handler: ({ ctx, params }) => getJobForRequester(ctx, params.jobId),
});
