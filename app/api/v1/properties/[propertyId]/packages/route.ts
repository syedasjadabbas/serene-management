import { definePropertyRoute } from "@/lib/http/route";
import { propertyParamsSchema } from "@/modules/properties/properties.schema";
import { createPackage, listPackages } from "@/modules/rates/packages.service";
import { createPackageSchema } from "@/modules/rates/rates.schema";

export const GET = definePropertyRoute({
  permission: "rates:read",
  params: propertyParamsSchema,
  handler: ({ ctx }) => listPackages(ctx),
});

export const POST = definePropertyRoute({
  permission: "packages:manage",
  params: propertyParamsSchema,
  body: createPackageSchema,
  status: 201,
  handler: ({ ctx, body }) => createPackage(ctx, body),
});
