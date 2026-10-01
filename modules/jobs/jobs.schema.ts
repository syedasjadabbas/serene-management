import { z } from "zod";

export const jobParamsSchema = z.object({ jobId: z.uuid() }).strict();
