import { Router } from "express";
import { validateParams } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import * as controller from "./jobs.controller";
import { jobParamsSchema } from "./jobs.validators";

export const router = Router();

router.get("/jobs/:jobId", requireAuth, validateParams(jobParamsSchema), controller.get);
