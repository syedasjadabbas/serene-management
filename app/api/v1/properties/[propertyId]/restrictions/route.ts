import { definePropertyRoute } from "@/lib/http/route";
import {
  restrictionsQuerySchema,
  setRestrictionsSchema,
} from "@/modules/availability/availability.schema";
import { listRestrictions, setRestrictions } from "@/modules/availability/restrictions.service";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";

export const GET = definePropertyRoute({
  permission: "availability:read",
  params: propertyParamsSchema,
  query: restrictionsQuerySchema,
  handler: ({ ctx, query }) => listRestrictions(ctx, query),
});

/** Sets or clears one restriction over a date range (high-risk: reason required). */
export const POST = definePropertyRoute({
  permission: "availability:manage",
  params: propertyParamsSchema,
  body: setRestrictionsSchema,
  handler: ({ ctx, body }) => setRestrictions(ctx, body),
});
