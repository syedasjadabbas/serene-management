import type { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@/config/prisma";
import { appError } from "@/lib/customError";
import type { PropertyContext } from "@/lib/context";
import { canAccessProperty } from "@serene/shared/lib/permissions/evaluate";
import { toDateOnly } from "@serene/shared/modules/business-date/business-date.policy";
import { findCurrentBusinessDate } from "@/modules/business-date/business-date.repository";

/**
 * Mount behind `requireAuth` on routes with a `:propertyId` path parameter.
 * The property id comes only from the path; access to it is checked before
 * anything else is parsed. Inaccessible and non-existent properties are
 * indistinguishable (403), so ids cannot be probed. On success `req.ctx`
 * becomes the PropertyContext (code, timezone, currency, current business
 * date). The business date is read per request, never cached (M10).
 */
export const propertyScope: RequestHandler = async (req, _res, next) => {
  const propertyId = z.uuid().safeParse(req.params.propertyId);
  if (!propertyId.success || !canAccessProperty(req.ctx.access, propertyId.data)) {
    throw appError("FORBIDDEN", "You do not have access to this property");
  }
  const property = req.auth.properties.find((p) => p.id === propertyId.data);
  if (!property) throw appError("FORBIDDEN", "You do not have access to this property");

  const current = await findCurrentBusinessDate(prisma, property.id);
  const ctx: PropertyContext = {
    ...req.ctx,
    propertyId: property.id,
    propertyCode: property.code,
    timezone: property.timezone,
    currencyCode: property.currencyCode,
    businessDate: current ? toDateOnly(current.date) : null,
  };
  req.ctx = ctx;
  next();
};
