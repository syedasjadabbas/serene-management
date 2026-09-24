import "server-only";
import type { Tx } from "@/lib/db/prisma";
import { notFound, staleVersion } from "@/lib/http/errors";
import { fromDateOnly, toDateOnly } from "@/modules/business-date/business-date.policy";
import type {
  FrontOfficeStatus,
  HousekeepingStatus,
  RoomStatusSnapshot,
  RoomStatusSource,
} from "./rooms.policy";
import {
  findStatusHistory,
  insertStatusHistory,
  lockRooms,
  updateRoomStatusVersioned,
} from "./rooms.repository";

/**
 * Room status changes made by front-office commands (check-in, check-out,
 * room move). Front office status is never set manually
 * (docs/DOMAIN_MODEL.md §6.2); every change writes room_status_history in
 * the caller's transaction. Housekeeping workflows arrive with Phase 4.
 */

export interface LockedRoom extends RoomStatusSnapshot {
  id: string;
  number: string;
  roomTypeId: string;
  active: boolean;
  version: number;
}

/**
 * Locks the rooms FOR UPDATE in id order. Lock order (docs/ARCHITECTURE.md
 * §5): business date → reservation room → inventory → sequence → rooms.
 * Unknown ids (or rooms of another property) raise NOT_FOUND.
 */
export async function lockRoomsForUpdate(
  tx: Tx,
  propertyId: string,
  businessDate: string,
  ids: string[],
): Promise<Map<string, LockedRoom>> {
  const rows = await lockRooms(tx, propertyId, ids, businessDate);
  const rooms = new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        number: row.number,
        roomTypeId: row.room_type_id,
        active: row.status === "ACTIVE",
        housekeepingStatus: row.housekeeping_status as HousekeepingStatus,
        frontOfficeStatus: row.front_office_status as FrontOfficeStatus,
        outOfOrder: row.out_of_order,
        version: row.version,
      },
    ]),
  );
  for (const id of ids) if (!rooms.has(id)) throw notFound("Room");
  return rooms;
}

/** Applies the changed fields to a locked room and records each change in the history. */
export async function changeRoomStatus(
  tx: Tx,
  actor: { propertyId: string; userId: string },
  room: LockedRoom,
  change: { frontOfficeStatus?: FrontOfficeStatus; housekeepingStatus?: HousekeepingStatus },
  source: RoomStatusSource,
  businessDate: string,
): Promise<LockedRoom> {
  const history: { field: "FRONT_OFFICE" | "HOUSEKEEPING"; from: string; to: string }[] = [];
  if (change.frontOfficeStatus && change.frontOfficeStatus !== room.frontOfficeStatus)
    history.push({
      field: "FRONT_OFFICE",
      from: room.frontOfficeStatus,
      to: change.frontOfficeStatus,
    });
  if (change.housekeepingStatus && change.housekeepingStatus !== room.housekeepingStatus)
    history.push({
      field: "HOUSEKEEPING",
      from: room.housekeepingStatus,
      to: change.housekeepingStatus,
    });
  if (history.length === 0) return room;

  const { count } = await updateRoomStatusVersioned(tx, room.id, room.version, {
    ...(change.frontOfficeStatus ? { frontOfficeStatus: change.frontOfficeStatus } : {}),
    ...(change.housekeepingStatus ? { housekeepingStatus: change.housekeepingStatus } : {}),
  });
  if (count !== 1) throw staleVersion("Room");
  await insertStatusHistory(
    tx,
    history.map((h) => ({
      propertyId: actor.propertyId,
      roomId: room.id,
      field: h.field,
      fromValue: h.from,
      toValue: h.to,
      businessDate: fromDateOnly(businessDate),
      source,
      changedById: actor.userId,
    })),
  );
  return {
    ...room,
    frontOfficeStatus: change.frontOfficeStatus ?? room.frontOfficeStatus,
    housekeepingStatus: change.housekeepingStatus ?? room.housekeepingStatus,
    version: room.version + 1,
  };
}

export interface RoomStatusChangeView {
  id: string;
  roomNumber: string;
  field: string;
  from: string | null;
  to: string | null;
  businessDate: string;
  source: string;
  changedById: string | null;
  at: string;
}

export async function roomStatusHistory(
  tx: Tx,
  propertyId: string,
  roomIds: string[],
  take = 50,
): Promise<RoomStatusChangeView[]> {
  if (roomIds.length === 0) return [];
  const rows = await findStatusHistory(tx, propertyId, roomIds, take);
  return rows.map((row) => ({
    id: row.id,
    roomNumber: row.room.number,
    field: row.field,
    from: row.fromValue,
    to: row.toValue,
    businessDate: toDateOnly(row.businessDate),
    source: row.source,
    changedById: row.changedById,
    at: row.createdAt.toISOString(),
  }));
}
