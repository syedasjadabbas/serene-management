import { z } from "zod";
import { SEARCH_MAX_QUERY, SEARCH_MIN_QUERY } from "./search.policy";

/** `GET /search` and `GET /properties/{id}/search`: the text only; limits are fixed. */
export const globalSearchQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .min(SEARCH_MIN_QUERY, `Type at least ${SEARCH_MIN_QUERY} characters`)
      .max(SEARCH_MAX_QUERY),
  })
  .strict();

export type GlobalSearchQuery = z.infer<typeof globalSearchQuerySchema>;
