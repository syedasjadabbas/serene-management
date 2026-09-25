import { definePropertyRoute } from "@/lib/http/route";
import { getPackage, updatePackage } from "@/modules/rates/packages.service";
import { packageParamsSchema, updatePackageSchema } from "@/modules/rates/rates.schema";

export const GET = definePropertyRoute({
  permission: "rates:read",
  params: packageParamsSchema,
  handler: ({ ctx, params }) => getPackage(ctx, params.packageId),
});

export const PATCH = definePropertyRoute({
  permission: "packages:manage",
  params: packageParamsSchema,
  body: updatePackageSchema,
  handler: ({ ctx, params, body }) => updatePackage(ctx, params.packageId, body),
});
