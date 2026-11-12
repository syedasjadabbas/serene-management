import { Router } from "express";
import { validateBody, validateParams, validateQuery } from "@/lib/validate";
import { requireAuth } from "@/middlewares/auth";
import { requireReasonForHighRisk } from "@/middlewares/highRiskReason";
import { idempotency } from "@/middlewares/idempotency";
import { requirePermission } from "@/middlewares/permission";
import { propertyScope } from "@/middlewares/propertyScope";
import { rateLimit } from "@/middlewares/rateLimit";
import * as controller from "./billing.controller";
import {
  adjustSchema,
  chargeEstimateParamsSchema,
  chargeSchema,
  folioListQuerySchema,
  folioParamsSchema,
  itemParamsSchema,
  ledgerQuerySchema,
  openWindowSchema,
  paymentParamsSchema,
  paymentSchema,
  propertyParamsSchema,
  refundSchema,
  reservationRoomParamsSchema,
  reverseSchema,
  roomChargesSchema,
  settleSchema,
  voidPaymentSchema,
} from "./billing.validators";

export const router = Router();

const billingWrite = rateLimit({ name: "billing.write", limit: 120, windowMs: 60_000 });
const P = "/properties/:propertyId";

router.get(
  `${P}/billing/options`,
  requireAuth,
  propertyScope,
  requirePermission("billing:read"),
  validateParams(propertyParamsSchema),
  controller.options,
);

router.get(
  `${P}/folios`,
  requireAuth,
  propertyScope,
  requirePermission("billing:read"),
  validateParams(propertyParamsSchema),
  validateQuery(folioListQuerySchema),
  controller.listFolios,
);

router.get(
  `${P}/folios/:folioId/items`,
  requireAuth,
  propertyScope,
  requirePermission("billing:read"),
  validateParams(folioParamsSchema),
  validateQuery(ledgerQuerySchema),
  controller.listLedger,
);

router.post(
  `${P}/folios/:folioId/charges`,
  requireAuth,
  propertyScope,
  requirePermission("billing:post"),
  billingWrite,
  validateParams(folioParamsSchema),
  validateBody(chargeSchema),
  idempotency({ required: true }),
  requireReasonForHighRisk("billing:post"),
  controller.postCharge,
);

router.post(
  `${P}/folios/:folioId/charges/preview`,
  requireAuth,
  propertyScope,
  requirePermission("billing:post"),
  validateParams(folioParamsSchema),
  validateBody(chargeSchema),
  requireReasonForHighRisk("billing:post"),
  controller.previewCharge,
);

router.post(
  `${P}/folios/:folioId/payments`,
  requireAuth,
  propertyScope,
  requirePermission("payments:create"),
  billingWrite,
  validateParams(folioParamsSchema),
  validateBody(paymentSchema),
  idempotency({ required: true }),
  requireReasonForHighRisk("payments:create"),
  controller.postPayment,
);

router.post(
  `${P}/folios/:folioId/settle`,
  requireAuth,
  propertyScope,
  requirePermission("payments:create"),
  validateParams(folioParamsSchema),
  validateBody(settleSchema),
  requireReasonForHighRisk("payments:create"),
  controller.settleFolio,
);

router.post(
  `${P}/folio-items/:itemId/adjust`,
  requireAuth,
  propertyScope,
  requirePermission("billing:adjust"),
  billingWrite,
  validateParams(itemParamsSchema),
  validateBody(adjustSchema),
  idempotency({ required: true }),
  requireReasonForHighRisk("billing:adjust"),
  controller.adjustItem,
);

router.post(
  `${P}/folio-items/:itemId/reverse`,
  requireAuth,
  propertyScope,
  requirePermission("billing:adjust"),
  billingWrite,
  validateParams(itemParamsSchema),
  validateBody(reverseSchema),
  idempotency({ required: true }),
  requireReasonForHighRisk("billing:adjust"),
  controller.reverseItem,
);

router.post(
  `${P}/payments/:paymentId/void`,
  requireAuth,
  propertyScope,
  requirePermission("payments:void"),
  billingWrite,
  validateParams(paymentParamsSchema),
  validateBody(voidPaymentSchema),
  idempotency({ required: true }),
  requireReasonForHighRisk("payments:void"),
  controller.voidPayment,
);

router.post(
  `${P}/payments/:paymentId/refund`,
  requireAuth,
  propertyScope,
  requirePermission("payments:refund"),
  billingWrite,
  validateParams(paymentParamsSchema),
  validateBody(refundSchema),
  idempotency({ required: true }),
  requireReasonForHighRisk("payments:refund"),
  controller.refundPayment,
);

router.get(
  `${P}/reservation-rooms/:reservationRoomId/charge-estimate`,
  requireAuth,
  propertyScope,
  requirePermission("reservations:read"),
  validateParams(chargeEstimateParamsSchema),
  controller.chargeEstimate,
);

router.get(
  `${P}/reservation-rooms/:reservationRoomId/folio`,
  requireAuth,
  propertyScope,
  requirePermission("billing:read"),
  validateParams(reservationRoomParamsSchema),
  controller.getFolioAccount,
);

router.post(
  `${P}/reservation-rooms/:reservationRoomId/folio`,
  requireAuth,
  propertyScope,
  requirePermission("billing:post"),
  validateParams(reservationRoomParamsSchema),
  validateBody(openWindowSchema),
  requireReasonForHighRisk("billing:post"),
  controller.openWindow,
);

router.get(
  `${P}/reservation-rooms/:reservationRoomId/folio/history`,
  requireAuth,
  propertyScope,
  requirePermission("billing:read"),
  validateParams(reservationRoomParamsSchema),
  controller.folioHistory,
);

router.post(
  `${P}/reservation-rooms/:reservationRoomId/room-charges`,
  requireAuth,
  propertyScope,
  requirePermission("billing:post"),
  billingWrite,
  validateParams(reservationRoomParamsSchema),
  validateBody(roomChargesSchema),
  idempotency({ required: true }),
  requireReasonForHighRisk("billing:post"),
  controller.postRoomCharges,
);
