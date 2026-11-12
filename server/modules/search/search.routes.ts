import { Router } from "express";
import { validateParams, validateQuery } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import { propertyScope } from "@/middlewares/propertyScope";
import * as controller from "./search.controller";
import { globalSearchQuerySchema, propertyParamsSchema } from "./search.validators";

/** Global search; no single permission gates the routes (each record type is checked by the service). */
export const router = Router();

router.get("/search", requireAuth, validateQuery(globalSearchQuerySchema), controller.organization);

router.get(
  "/properties/:propertyId/search",
  requireAuth,
  propertyScope,
  validateParams(propertyParamsSchema),
  validateQuery(globalSearchQuerySchema),
  controller.property,
);
