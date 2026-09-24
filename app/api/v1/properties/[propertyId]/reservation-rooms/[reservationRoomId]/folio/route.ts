import { definePropertyRoute } from "@/lib/http/route";
import { openWindowSchema, reservationRoomParamsSchema } from "@/modules/billing/billing.schema";
import { getFolioAccount, openWindow } from "@/modules/billing/billing.service";

/** The stay's account: windows with ledger-maintained balances, room-night posting state. */
export const GET = definePropertyRoute({
  permission: "billing:read",
  params: reservationRoomParamsSchema,
  handler: ({ ctx, params }) => getFolioAccount(ctx, params.reservationRoomId),
});

/** Opens the next billing window (window 1: billing:post; later windows: billing:transfer). */
export const POST = definePropertyRoute({
  permission: "billing:post",
  params: reservationRoomParamsSchema,
  body: openWindowSchema,
  status: 201,
  handler: ({ ctx, params }) => openWindow(ctx, params.reservationRoomId),
});
