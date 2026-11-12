import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { serverEnv } from "@/config/env";
import { isAllowedOrigin } from "@/lib/origin";
import { MAX_JSON_BODY_BYTES } from "@/lib/response";
import { bodyLimit } from "@/middlewares/bodyLimit";
import { errorHandler, notFound } from "@/middlewares/errorHandler";
import { observe } from "@/middlewares/observe";
import { globalWriteLimit } from "@/middlewares/rateLimit";
import { requestId } from "@/middlewares/requestId";
import { router as accounts } from "@/modules/accounts/accounts.routes";
import { router as audit } from "@/modules/audit/audit.routes";
import { router as availability } from "@/modules/availability/availability.routes";
import { router as billing } from "@/modules/billing/billing.routes";
import { router as businessDate } from "@/modules/business-date/business-date.routes";
import { router as frontDesk } from "@/modules/front-desk/front-desk.routes";
import { router as groups } from "@/modules/groups/groups.routes";
import { router as guests } from "@/modules/guests/guests.routes";
import { router as health } from "@/modules/health/health.routes";
import { router as housekeeping } from "@/modules/housekeeping/housekeeping.routes";
import { router as identity } from "@/modules/identity/identity.routes";
import { router as jobs } from "@/modules/jobs/jobs.routes";
import { router as loyalty } from "@/modules/loyalty/loyalty.routes";
import { router as maintenance } from "@/modules/maintenance/maintenance.routes";
import { router as nightAudit } from "@/modules/night-audit/night-audit.routes";
import { router as organization } from "@/modules/organization/organization.routes";
import { router as properties } from "@/modules/properties/properties.routes";
import { router as rates } from "@/modules/rates/rates.routes";
import { router as realtime } from "@/modules/realtime/realtime.routes";
import { router as reports } from "@/modules/reports/reports.routes";
import { router as reservations } from "@/modules/reservations/reservations.routes";
import { router as rooms } from "@/modules/rooms/rooms.routes";
import { router as search } from "@/modules/search/search.routes";
import { router as setup } from "@/modules/setup/setup.routes";
import { router as users } from "@/modules/users/users.routes";

/**
 * The Express application (docs/SERVER_SPLIT_PLAN.md section 3). Middleware
 * order: requestId, observe (metrics, in-flight tracking), helmet, CORS
 * allowlist (CLIENT_ORIGINS, credentials), JSON-only body limited to 1 MiB,
 * cookie-parser, global write limit (300/min per IP), routers under /api/v1,
 * health/metrics under /api, 404, errorHandler.
 */
export function createApp(): Express {
  const env = serverEnv();
  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);

  app.use(requestId);
  app.use(observe);
  // API responses are JSON/streams, never documents: the strictest CSP is fine.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"] } },
    }),
  );
  app.use(
    cors({
      origin: (origin, callback) => callback(null, !origin || isAllowedOrigin(origin, env)),
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Authorization",
        "Content-Type",
        "Idempotency-Key",
        "X-Client-Platform",
        "X-Request-Id",
      ],
      exposedHeaders: ["Content-Disposition", "X-Request-Id", "Retry-After"],
      maxAge: 600,
    }),
  );
  app.use(bodyLimit);
  app.use(express.json({ limit: MAX_JSON_BODY_BYTES, type: "application/json" }));
  app.use(cookieParser());
  app.use(globalWriteLimit);

  const v1 = express.Router();
  for (const router of [
    identity,
    businessDate,
    accounts,
    audit,
    availability,
    billing,
    frontDesk,
    groups,
    guests,
    housekeeping,
    jobs,
    loyalty,
    maintenance,
    nightAudit,
    organization,
    properties,
    rates,
    realtime,
    reports,
    reservations,
    rooms,
    search,
    setup,
    users,
  ]) {
    v1.use(router);
  }
  app.use("/api/v1", v1);
  app.use("/api", health);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
