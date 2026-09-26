import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";

/**
 * Reservation data access. Every query is scoped by property (and the
 * composite foreign keys make cross-property rows impossible).
 */

const codeSelect = { id: true, code: true, name: true } as const;

// --- Reference data -----------------------------------------------------------

export function findRoomType(tx: Tx, propertyId: string, id: string) {
  return tx.roomType.findFirst({
    where: { id, propertyId, status: "ACTIVE", isSellable: true, isPseudo: false },
    select: { ...codeSelect, maxOccupancy: true, maxAdults: true, maxChildren: true },
  });
}

export function findReservationType(tx: Tx, propertyId: string, id: string) {
  return tx.reservationType.findFirst({
    where: { id, propertyId, status: "ACTIVE" },
    select: { ...codeSelect, deductsInventory: true, isGuaranteed: true },
  });
}

export function findRatePlanDefaults(tx: Tx, propertyId: string, id: string) {
  return tx.ratePlan.findFirst({
    where: { id, propertyId, status: "ACTIVE" },
    select: {
      ...codeSelect,
      defaultMarketCodeId: true,
      defaultSourceCodeId: true,
      cancellationPolicyId: true,
      depositPolicyId: true,
    },
  });
}

export function findMarketCode(tx: Tx, propertyId: string, id: string) {
  return tx.marketCode.findFirst({
    where: { id, propertyId, status: "ACTIVE" },
    select: codeSelect,
  });
}

export function findSourceCode(tx: Tx, propertyId: string, id: string) {
  return tx.sourceCode.findFirst({
    where: { id, propertyId, status: "ACTIVE" },
    select: codeSelect,
  });
}

export function findChannel(tx: Tx, propertyId: string, id: string) {
  return tx.channel.findFirst({ where: { id, propertyId, status: "ACTIVE" }, select: codeSelect });
}

export function findReasonCode(
  tx: Tx,
  propertyId: string,
  id: string,
  category: "CANCELLATION" | "NO_SHOW" | "ROOM_MOVE" | "EARLY_DEPARTURE",
) {
  return tx.reasonCode.findFirst({
    where: { id, propertyId, category, status: "ACTIVE" },
    select: { ...codeSelect, requiresComment: true },
  });
}

/** Row-locks a room of the property (FOR UPDATE); a missing room is reported by findRoom. */
export async function lockRoomRow(tx: Tx, propertyId: string, id: string) {
  await tx.$queryRaw`
    SELECT "id" FROM "rooms"
    WHERE "id" = ${id}::uuid AND "property_id" = ${propertyId}::uuid
    FOR UPDATE`;
}

export function findRoom(tx: Tx, propertyId: string, id: string) {
  return tx.room.findFirst({
    where: { id, propertyId, status: "ACTIVE" },
    select: { id: true, number: true, roomTypeId: true },
  });
}

/** Out-of-order periods of a room overlapping [arrival, departure). */
export function countRoomOutOfOrder(tx: Tx, roomId: string, arrival: Date, departure: Date) {
  return tx.roomServiceBlock.count({
    where: {
      roomId,
      kind: "OUT_OF_ORDER",
      status: { in: ["SCHEDULED", "ACTIVE"] },
      fromDate: { lt: departure },
      toDate: { gt: arrival },
    },
  });
}

// --- Writes ---------------------------------------------------------------------

export function insertReservation(tx: Tx, data: Prisma.ReservationUncheckedCreateInput) {
  return tx.reservation.create({ data, select: { id: true, confirmationNumber: true } });
}

export function insertReservationRoom(tx: Tx, data: Prisma.ReservationRoomUncheckedCreateInput) {
  return tx.reservationRoom.create({ data, select: { id: true, lineNumber: true } });
}

export function insertNights(tx: Tx, rows: Prisma.ReservationRoomNightCreateManyInput[]) {
  return tx.reservationRoomNight.createMany({ data: rows });
}

export function deleteNights(tx: Tx, reservationRoomId: string) {
  return tx.reservationRoomNight.deleteMany({ where: { reservationRoomId } });
}

export function insertReservationPackage(
  tx: Tx,
  data: Prisma.ReservationPackageUncheckedCreateInput,
) {
  return tx.reservationPackage.create({ data, select: { id: true } });
}

export function findReservationPackage(tx: Tx, reservationRoomId: string, id: string) {
  return tx.reservationPackage.findFirst({
    where: { id, reservationRoomId },
    select: {
      id: true,
      quantity: true,
      startDate: true,
      endDate: true,
      package: { select: { code: true } },
    },
  });
}

export function deleteReservationPackage(tx: Tx, id: string) {
  return tx.reservationPackage.delete({ where: { id } });
}

/** A reservation room's stay nights, for room-charge posting (billing). */
export function findNightsForPosting(tx: Tx, propertyId: string, reservationRoomId: string) {
  return tx.reservationRoomNight.findMany({
    where: { propertyId, reservationRoomId },
    orderBy: { stayDate: "asc" },
    select: {
      stayDate: true,
      rateAmount: true,
      currencyCode: true,
      adults: true,
      children: true,
      ratePlanId: true,
      postedAt: true,
    },
  });
}

/** Marks a night posted / unposted; 0 rows when it already was (the caller treats that as a race). */
export function setNightPosted(tx: Tx, reservationRoomId: string, stayDate: Date, posted: boolean) {
  return tx.reservationRoomNight.updateMany({
    where: { reservationRoomId, stayDate, postedAt: posted ? null : { not: null } },
    data: { postedAt: posted ? new Date() : null },
  });
}

export function insertAssignment(tx: Tx, data: Prisma.RoomAssignmentUncheckedCreateInput) {
  return tx.roomAssignment.create({ data, select: { id: true } });
}

export function releaseActiveAssignments(
  tx: Tx,
  reservationRoomId: string,
  userId: string,
  at: Date,
) {
  return tx.roomAssignment.updateMany({
    where: { reservationRoomId, status: "ACTIVE" },
    data: { status: "RELEASED", releasedAt: at, releasedById: userId },
  });
}

/**
 * Ends the active assignment at `until` (a room move or check-out): the row
 * is released and its range truncated to the nights actually spent in the
 * room, so the assignment history shows where the guest slept.
 */
export function closeActiveAssignments(
  tx: Tx,
  reservationRoomId: string,
  userId: string,
  at: Date,
  until: string,
) {
  return tx.$executeRaw`
    UPDATE "room_assignments"
    SET "status" = 'RELEASED', "released_at" = ${at}, "released_by_id" = ${userId}::uuid,
        "to_date" = GREATEST("from_date", LEAST("to_date", ${until}::date))
    WHERE "reservation_room_id" = ${reservationRoomId}::uuid AND "status" = 'ACTIVE'`;
}

export function countActiveAssignments(tx: Tx, reservationRoomId: string, roomId: string) {
  return tx.roomAssignment.count({ where: { reservationRoomId, roomId, status: "ACTIVE" } });
}

/** Nights on or after `from` (early departure releases them). */
export function deleteNightsFrom(tx: Tx, reservationRoomId: string, from: Date) {
  return tx.reservationRoomNight.deleteMany({
    where: { reservationRoomId, stayDate: { gte: from } },
  });
}

/** Nights before `before` (a reinstated no-show starts on the business date). */
export function deleteNightsBefore(tx: Tx, reservationRoomId: string, before: Date) {
  return tx.reservationRoomNight.deleteMany({
    where: { reservationRoomId, stayDate: { lt: before } },
  });
}

/** Unposted nights before `before` (check-out and night-audit posting checks). */
export function countUnpostedNightsBefore(tx: Tx, reservationRoomId: string, before: Date) {
  return tx.reservationRoomNight.count({
    where: { reservationRoomId, stayDate: { lt: before }, postedAt: null },
  });
}

/**
 * Extends the active assignment(s) of an in-house room to a later departure.
 * The exclusion constraint on room assignments rejects the extension when
 * the room is taken for any of the added nights.
 */
export function extendActiveAssignments(tx: Tx, reservationRoomId: string, toDate: string) {
  return tx.$executeRaw`
    UPDATE "room_assignments" SET "to_date" = ${toDate}::date
    WHERE "reservation_room_id" = ${reservationRoomId}::uuid AND "status" = 'ACTIVE'`;
}

export function insertNote(tx: Tx, data: Prisma.ReservationNoteUncheckedCreateInput) {
  return tx.reservationNote.create({ data, select: { id: true } });
}

export async function replacePrimaryGuest(tx: Tx, reservationRoomId: string, guestId: string) {
  await tx.reservationGuest.deleteMany({ where: { reservationRoomId, isPrimary: true } });
  await tx.reservationGuest.deleteMany({ where: { reservationRoomId, guestId } });
  await tx.reservationGuest.create({
    data: { reservationRoomId, guestId, isPrimary: true, sequence: 1 },
  });
}

/** Optimistic concurrency: succeeds only if the row still has the version the client saw. */
export function updateReservationRoomVersioned(
  tx: Tx,
  id: string,
  expectedVersion: number,
  data: Prisma.ReservationRoomUncheckedUpdateManyInput,
) {
  return tx.reservationRoom.updateMany({
    where: { id, version: expectedVersion },
    data: { ...data, version: { increment: 1 } },
  });
}

// --- Loading for commands ----------------------------------------------------------

/**
 * Row-locks a reservation room for the rest of the transaction, then loads
 * what state transitions need. Scoped by property: another property's id
 * finds nothing.
 */
export async function lockReservationRoom(tx: Tx, propertyId: string, id: string) {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "reservation_rooms"
    WHERE "id" = ${id}::uuid AND "property_id" = ${propertyId}::uuid
    FOR UPDATE`;
  if (locked.length === 0) return null;
  return tx.reservationRoom.findUnique({
    where: { id },
    select: {
      id: true,
      reservationId: true,
      lineNumber: true,
      version: true,
      status: true,
      primaryGuestId: true,
      arrivalDate: true,
      departureDate: true,
      adults: true,
      children: true,
      eta: true,
      roomTypeId: true,
      rateRoomTypeId: true,
      roomId: true,
      ratePlanId: true,
      reservationTypeId: true,
      marketCodeId: true,
      sourceCodeId: true,
      shareGroupId: true,
      blockId: true,
      currencyCode: true,
      cancellationNumber: true,
      reservationType: {
        select: { code: true, deductsInventory: true, isGuaranteed: true, postNoShowCharge: true },
      },
      reservation: { select: { confirmationNumber: true, companyId: true } },
    },
  });
}

export type LockedReservationRoom = NonNullable<Awaited<ReturnType<typeof lockReservationRoom>>>;

// --- Queries -------------------------------------------------------------------------

const listSelect = {
  id: true,
  reservationId: true,
  lineNumber: true,
  status: true,
  arrivalDate: true,
  departureDate: true,
  adults: true,
  children: true,
  currencyCode: true,
  createdAt: true,
  reservationType: { select: { deductsInventory: true } },
  reservation: {
    select: {
      confirmationNumber: true,
      bookedAt: true,
      channel: { select: { code: true } },
      _count: { select: { rooms: true } },
    },
  },
  primaryGuest: {
    select: { id: true, firstName: true, lastName: true, title: true, vipLevelId: true },
  },
  roomType: { select: { code: true, name: true } },
  room: { select: { number: true } },
  ratePlan: { select: { code: true } },
  sourceCode: { select: { code: true } },
} as const satisfies Prisma.ReservationRoomSelect;

export type ReservationListRow = Prisma.ReservationRoomGetPayload<{ select: typeof listSelect }>;

export function findReservationRoomsPage(
  tx: Tx,
  where: Prisma.ReservationRoomWhereInput,
  orderBy: Prisma.ReservationRoomOrderByWithRelationInput[],
  take: number,
) {
  return tx.reservationRoom.findMany({ where, orderBy, take, select: listSelect });
}

/** Stay totals for a page of reservation rooms, aggregated in PostgreSQL. */
export async function sumNightAmounts(tx: Tx, reservationRoomIds: string[]) {
  if (reservationRoomIds.length === 0) return new Map<string, string>();
  const rows = await tx.reservationRoomNight.groupBy({
    by: ["reservationRoomId"],
    where: { reservationRoomId: { in: reservationRoomIds } },
    _sum: { rateAmount: true },
  });
  return new Map(rows.map((r) => [r.reservationRoomId, r._sum.rateAmount?.toFixed(4) ?? "0.0000"]));
}

export function findReservationDetail(tx: Tx, propertyId: string, reservationId: string) {
  return tx.reservation.findFirst({
    where: { id: reservationId, propertyId },
    select: {
      id: true,
      confirmationNumber: true,
      bookedAt: true,
      bookedById: true,
      externalReference: true,
      version: true,
      company: { select: { id: true, code: true, name: true } },
      bookerGuest: {
        select: { id: true, profileNumber: true, title: true, firstName: true, lastName: true },
      },
      channel: { select: codeSelect },
      notes: {
        where: { deletedAt: null },
        select: { id: true, body: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 50,
      },
      rooms: {
        orderBy: { lineNumber: "asc" },
        select: {
          id: true,
          lineNumber: true,
          version: true,
          status: true,
          arrivalDate: true,
          departureDate: true,
          adults: true,
          children: true,
          eta: true,
          currencyCode: true,
          cancellationNumber: true,
          cancelledAt: true,
          noShowAt: true,
          primaryGuest: {
            select: {
              id: true,
              title: true,
              firstName: true,
              lastName: true,
              profileNumber: true,
              primaryEmail: true,
              primaryPhone: true,
            },
          },
          roomType: { select: codeSelect },
          room: { select: { id: true, number: true } },
          ratePlan: { select: codeSelect },
          reservationType: {
            select: { ...codeSelect, deductsInventory: true, isGuaranteed: true },
          },
          marketCode: { select: codeSelect },
          sourceCode: { select: codeSelect },
          cancellationPolicy: { select: { ...codeSelect, description: true } },
          cancelReason: { select: codeSelect },
          stay: { select: { id: true, status: true, checkedInAt: true, checkedOutAt: true } },
          block: {
            select: {
              id: true,
              code: true,
              name: true,
              group: { select: { id: true, code: true, name: true } },
            },
          },
          packages: {
            orderBy: { startDate: "asc" },
            select: {
              id: true,
              quantity: true,
              startDate: true,
              endDate: true,
              package: { select: { id: true, code: true, name: true, postingType: true } },
            },
          },
          nights: {
            orderBy: { stayDate: "asc" },
            select: {
              stayDate: true,
              rateAmount: true,
              roomType: { select: { code: true } },
              ratePlan: { select: { code: true } },
            },
          },
        },
      },
    },
  });
}

/** History rows written at this property only (G3): never another property's rows. */
export function findAuditHistory(
  tx: Tx,
  organizationId: string,
  propertyId: string,
  resourceIds: string[],
) {
  return tx.auditLog.findMany({
    where: { organizationId, propertyId, resourceId: { in: resourceIds } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
    select: {
      id: true,
      createdAt: true,
      action: true,
      userId: true,
      risk: true,
      reason: true,
      before: true,
      after: true,
    },
  });
}

export function findUserNames(tx: Tx, organizationId: string, ids: string[]) {
  if (ids.length === 0) return Promise.resolve([]);
  return tx.user.findMany({
    where: { organizationId, id: { in: ids } },
    select: { id: true, displayName: true },
  });
}

export async function findBookingOptions(tx: Tx, propertyId: string) {
  const active = { propertyId, status: "ACTIVE" } as const;
  const orderByCode = { code: "asc" } as const;
  const roomTypes = await tx.roomType.findMany({
    where: { ...active, isSellable: true, isPseudo: false },
    select: { ...codeSelect, maxOccupancy: true, maxAdults: true, maxChildren: true },
    orderBy: [{ sortOrder: "asc" }, orderByCode],
  });
  // Negotiated plans are listed for labels and defaults (a company booking
  // selects them); whether they may be sold is decided by the pricing engine.
  const ratePlans = await tx.ratePlan.findMany({
    where: { ...active, requiresMembership: false, isDayUse: false },
    select: { ...codeSelect, defaultMarketCodeId: true, defaultSourceCodeId: true },
    orderBy: [{ displayOrder: "asc" }, orderByCode],
  });
  const reservationTypes = await tx.reservationType.findMany({
    where: active,
    select: { ...codeSelect, deductsInventory: true, isGuaranteed: true },
    orderBy: orderByCode,
  });
  const marketCodes = await tx.marketCode.findMany({
    where: active,
    select: codeSelect,
    orderBy: orderByCode,
  });
  const sourceCodes = await tx.sourceCode.findMany({
    where: active,
    select: codeSelect,
    orderBy: orderByCode,
  });
  const channels = await tx.channel.findMany({
    where: active,
    select: codeSelect,
    orderBy: orderByCode,
  });
  const reasons = await tx.reasonCode.findMany({
    where: { ...active, category: { in: ["CANCELLATION", "NO_SHOW"] } },
    select: { ...codeSelect, category: true },
    orderBy: orderByCode,
  });
  return { roomTypes, ratePlans, reservationTypes, marketCodes, sourceCodes, channels, reasons };
}

/**
 * Rooms of a type free for [arrival, departure): active, no overlapping
 * active assignment, no overlapping out-of-order block. Bounded by the
 * property's room count.
 */
export function findAvailableRooms(
  tx: Tx,
  propertyId: string,
  roomTypeId: string,
  arrival: string,
  departure: string,
  excludeReservationRoomId: string | null,
) {
  return tx.$queryRaw<
    {
      id: string;
      number: string;
      floor: string | null;
      housekeeping_status: string;
      front_office_status: string;
      out_of_service: boolean;
      is_accessible: boolean;
      is_smoking: boolean;
    }[]
  >`
    SELECT r."id", r."number", f."name" AS "floor", r."housekeeping_status"::text AS "housekeeping_status",
           r."front_office_status"::text AS "front_office_status",
           EXISTS (
             SELECT 1 FROM "room_service_blocks" s
             WHERE s."room_id" = r."id" AND s."kind" = 'OUT_OF_SERVICE' AND s."status" IN ('SCHEDULED', 'ACTIVE')
               AND s."from_date" < ${departure}::date AND s."to_date" > ${arrival}::date
           ) AS "out_of_service", r."is_accessible", r."is_smoking"
    FROM "rooms" r
    LEFT JOIN "floors" f ON f."id" = r."floor_id"
    WHERE r."property_id" = ${propertyId}::uuid
      AND r."room_type_id" = ${roomTypeId}::uuid
      AND r."status" = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1 FROM "room_assignments" a
        WHERE a."room_id" = r."id" AND a."status" = 'ACTIVE'
          AND a."from_date" < ${departure}::date AND a."to_date" > ${arrival}::date
          AND a."reservation_room_id" IS DISTINCT FROM ${excludeReservationRoomId}::uuid
      )
      AND NOT EXISTS (
        SELECT 1 FROM "room_service_blocks" b
        WHERE b."room_id" = r."id" AND b."kind" = 'OUT_OF_ORDER' AND b."status" IN ('SCHEDULED', 'ACTIVE')
          AND b."from_date" < ${departure}::date AND b."to_date" > ${arrival}::date
      )
    ORDER BY r."sort_order", r."number"
    LIMIT 500`;
}

/** Locks the reservation header (company / booker commands, Phase 7). */
export async function lockReservation(tx: Tx, propertyId: string, id: string) {
  const rows = await tx.$queryRaw<
    { id: string; version: number; company_id: string | null; booker_guest_id: string | null }[]
  >`
    SELECT "id", "version", "company_id", "booker_guest_id" FROM "reservations"
    WHERE "id" = ${id}::uuid AND "property_id" = ${propertyId}::uuid
    FOR UPDATE`;
  return rows[0] ?? null;
}

/** Active rooms of a reservation with their stay window and rate plan's negotiation flag. */
export function findActiveRoomsForCompany(tx: Tx, propertyId: string, reservationId: string) {
  return tx.reservationRoom.findMany({
    where: {
      propertyId,
      reservationId,
      status: { in: ["RESERVED", "WAITLISTED", "IN_HOUSE"] },
    },
    select: {
      id: true,
      arrivalDate: true,
      departureDate: true,
      ratePlan: {
        select: {
          code: true,
          requiresNegotiation: true,
          negotiated: { select: { accountProfileId: true, validFrom: true, validTo: true } },
        },
      },
    },
  });
}

export function updateReservationHeaderVersioned(
  tx: Tx,
  id: string,
  version: number,
  data: { companyId: string | null; bookerGuestId: string | null },
) {
  return tx.reservation.updateMany({
    where: { id, version },
    data: { ...data, version: { increment: 1 } },
  });
}

/** The group's account when it is an active, unrestricted company (pickup default). */
export async function findGroupCompanyId(tx: Tx, groupId: string): Promise<string | null> {
  const group = await tx.group.findUnique({
    where: { id: groupId },
    select: {
      account: { select: { id: true, type: true, status: true, isRestricted: true } },
    },
  });
  const account = group?.account;
  return account &&
    account.type === "COMPANY" &&
    account.status === "ACTIVE" &&
    !account.isRestricted
    ? account.id
    : null;
}
