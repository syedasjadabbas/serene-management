import { Router } from "express";
import * as controller from "./health.controller";

/**
 * Liveness, readiness and metrics (task T2). Mounted under /api (not /api/v1),
 * unauthenticated; /metrics answers 404 unless the scraper sends METRICS_TOKEN.
 */
export const router = Router();

router.get("/health/live", controller.live);
router.get("/health/ready", controller.ready);
router.get("/health", controller.legacyHealth);
router.get("/metrics", controller.metrics);
