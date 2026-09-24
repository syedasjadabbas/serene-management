import "server-only";
import { prisma } from "@/lib/db/prisma";
import { runInTransaction } from "@/lib/db/transaction";
import { auditActor, type PropertyContext } from "@/lib/http/context";
import { recordAudit } from "@/modules/audit/audit.service";
import { requireOpenBusinessDate } from "@/modules/business-date/business-date.service";
import { queueCleaningInTx } from "@/modules/housekeeping/housekeeping.service";
import { findServiceReasonCodes } from "./rooms.repository";
import type { PlaceBlockInput, ReleaseBlockInput } from "./rooms.schema";
import { getRoom, placeServiceBlock, releaseServiceBlock } from "./rooms.service";
import type { RoomDetail } from "./rooms.types";

/**
 * Out-of-order / out-of-service commands (`rooms:out_of_order`, high-risk).
 * They orchestrate the rooms primitives and the housekeeping queue: a room
 * returned to service comes back dirty with a priority cleaning task, so it
 * is not ready until cleaned (and inspected where required).
 */

export async function placeRoomBlock(
  ctx: PropertyContext,
  roomId: string,
  input: PlaceBlockInput,
): Promise<RoomDetail> {
  await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const from = input.from ?? businessDate;
    const placed = await placeServiceBlock(tx, ctx, businessDate, {
      roomId,
      kind: input.kind,
      from,
      to: input.to,
      reasonCodeId: input.reasonCodeId,
      notes: input.notes ?? null,
      reason: input.reason,
    });
    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: input.kind === "OUT_OF_ORDER" ? "room.out_of_order" : "room.out_of_service",
        resourceType: "Room",
        resourceId: roomId,
        risk: "HIGH",
        after: {
          blockId: placed.blockId,
          roomNumber: placed.roomNumber,
          kind: input.kind,
          from,
          to: input.to,
        },
        reason: input.reason,
        reasonCodeId: input.reasonCodeId,
        permission: "rooms:out_of_order",
      },
    );
  });
  return getRoom(ctx, roomId);
}

export async function returnRoomToService(
  ctx: PropertyContext,
  blockId: string,
  input: ReleaseBlockInput,
): Promise<RoomDetail> {
  const roomId = await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const released = await releaseServiceBlock(tx, ctx, businessDate, blockId, input.reason);
    const cleaning = released.started
      ? await queueCleaningInTx(tx, ctx, businessDate, {
          roomId: released.roomId,
          afterMaintenance: true,
          note: `Back in service (${released.kind === "OUT_OF_ORDER" ? "out of order" : "out of service"})`,
        })
      : null;
    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: "room.return_to_service",
        resourceType: "Room",
        resourceId: released.roomId,
        risk: "HIGH",
        before: { kind: released.kind, blockId },
        after: {
          roomNumber: released.roomNumber,
          serviceStatus: "IN_SERVICE",
          housekeepingStatus: released.started ? "DIRTY" : undefined,
          cleaningTaskId: cleaning?.taskId ?? null,
        },
        reason: input.reason,
        permission: "rooms:out_of_order",
      },
    );
    return released.roomId;
  });
  return getRoom(ctx, roomId);
}

/** Room reason codes for the block dialog. */
export function serviceReasonCodes(ctx: PropertyContext) {
  return findServiceReasonCodes(prisma, ctx.propertyId);
}
