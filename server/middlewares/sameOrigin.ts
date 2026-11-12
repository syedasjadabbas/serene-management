import type { RequestHandler } from "express";
import { serverEnv } from "@/config/env";
import { appError } from "@/lib/customError";
import { isAllowedOrigin } from "@/lib/origin";

/**
 * CSRF defence for the cookie endpoints (/auth/refresh, /auth/logout): the
 * Origin header must be one of CLIENT_ORIGINS (plus loopback/LAN origins
 * outside production, lib/origin.ts). Bearer requests need no Origin check.
 */
export const sameOrigin: RequestHandler = (req, _res, next) => {
  if (!isAllowedOrigin(req.get("origin"), serverEnv())) {
    throw appError("FORBIDDEN", "Cross-origin request rejected");
  }
  next();
};
