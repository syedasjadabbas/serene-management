import "server-only";
import { Prisma, type ReservationStatus } from "@/generated/prisma/client";
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

/** Stay nights of many reservation rooms for posting (night audit batch, M8). */
export function findNightsForPostingMany(tx: Tx, propertyId: string, reservationRoomIds: string[]) {
  return tx.reservationRoomNight.findMany({
    where: { propertyId, reservationRoomId: { in: reservationRoomIds } },
    orderBy: [{ reservationRoomId: "asc" }, { stayDate: "asc" }],
    select: {
      reservationRoomId: true,
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

/**
 * Marks many (reservation room, night) pairs posted in one statement; returns
 * how many were still unposted (the caller treats a shortfall as a race).
 */
export function setNightsPosted(
  tx: Tx,
  pairs: { reservationRoomId: string; stayDate: string }[],
  at: Date,
) {
  return tx.$executeRaw`
    UPDATE "reservation_room_nights" n SET "posted_at" = ${at}
    FROM unnest(${pairs.map((p) => p.reservationRoomId)}::uuid[],
                ${pairs.map((p) => p.stayDate)}::date[]) AS u("reservation_room_id", "stay_date")
    WHERE n."reservation_room_id" = u."reservation_room_id" AND n."stay_date" = u."stay_date"
      AND n."posted_at" IS NULL`;
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
const lockedRoomSelect = {
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
} as const satisfies Prisma.ReservationRoomSelect;

export async function lockReservationRoom(tx: Tx, propertyId: string, id: string) {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "reservation_rooms"
    WHERE "id" = ${id}::uuid AND "property_id" = ${propertyId}::uuid
    FOR UPDATE`;
  if (locked.length === 0) return null;
  return tx.reservationRoom.findUnique({ where: { id }, select: lockedRoomSelect });
}

/**
 * Locks many reservation rooms FOR UPDATE in one statement, in id order (the
 * same order concurrent lockers use), and loads them (night audit, M8).
 */
export async function lockReservationRooms(tx: Tx, propertyId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "reservation_rooms"
    WHERE "property_id" = ${propertyId}::uuid AND "id" = ANY(${ids}::uuid[])
    ORDER BY "id"
    FOR UPDATE`;
  return tx.reservationRoom.findMany({
    where: { id: { in: locked.map((row) => row.id) } },
    orderBy: { id: "asc" },
    select: lockedRoomSelect,
  });
}

export type LockedReservationRoom = NonNullable<Awaited<ReturnType<typeof lockReservationRoom>>>;

// --- Queries -------------------------------------------------------------------------

/** The sort keys of a reservation list page (the page is loaded by id afterwards). */
const pageKeySelect = { id: true, arrivalDate: true, createdAt: true } as const;
export type ReservationPageKey = { id: string; arrivalDate: Date; createdAt: Date };
type ListSort = { field: "arrivalDate" | "createdAt"; direction: "asc" | "desc" };

/** The first `take` reservation rooms matching `where`, in `orderBy`: their sort keys only. */
export function findReservationRoomPageKeys(
  tx: Tx,
  where: Prisma.ReservationRoomWhereInput,
  orderBy: Prisma.ReservationRoomOrderByWithRelationInput[],
  take: number,
): Promise<ReservationPageKey[]> {
  return tx.reservationRoom.findMany({ where, orderBy, take, select: pageKeySelect });
}

export interface ReservationListRow {
  id: string;
  reservation_id: string;
  line_number: number;
  status: ReservationStatus;
  arrival_date: Date;
  departure_date: Date;
  adults: number;
  children: number;
  currency_code: string;
  deducts_inventory: boolean;
  confirmation_number: string;
  booked_at: Date;
  channel_code: string | null;
  reservation_rooms: number;
  guest_id: string;
  first_name: string;
  last_name: string;
  vip_level_id: string | null;
  room_type_code: string;
  room_type_name: string;
  room_number: string | null;
  rate_plan_code: string;
  source_code: string;
  /** Sum of the stay's night rates; null when it has no nights. */
  total: string | null;
  /** Minor units of `currencyCode` (2 when the currency is not configured). */
  minor_units: number;
}

/**
 * The reservation list rows with these ids (a page, at most one per id), in
 * `sort` order then id, with everything the list shows: the booking, guest,
 * room type, room, rate plan, source and channel codes, the reservation's
 * room count, the stay total and the currency's minor units. One statement:
 * relation selects sent one per relation plus the totals and the currency
 * (12 per page, docs/SCALABILITY.md §30). Each lookup follows its relation
 * (property and id); the property filter repeats the page's scope. Codes are
 * scalar subqueries rather than joins: a nine-table join took ≈11 ms to plan
 * on every request (statements are not prepared), the subqueries ≈1.3 ms.
 */
export function findReservationListRows(
  tx: Tx,
  propertyId: string,
  ids: string[],
  sort: ListSort,
  currencyCode: string,
): Promise<ReservationListRow[]> {
  const key =
    sort.field === "arrivalDate" ? Prisma.sql`rr."arrival_date"` : Prisma.sql`rr."created_at"`;
  const direction = sort.direction === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  return tx.$queryRaw<ReservationListRow[]>`
    SELECT rr."id", rr."reservation_id", rr."line_number", rr."status"::text AS "status",
           rr."arrival_date", rr."departure_date", rr."adults", rr."children", rr."currency_code",
           (SELECT t."deducts_inventory" FROM "reservation_types" t
             WHERE t."property_id" = rr."property_id" AND t."id" = rr."reservation_type_id") AS "deducts_inventory",
           res."confirmation_number", res."booked_at",
           (SELECT ch."code" FROM "channels" ch
             WHERE ch."property_id" = res."property_id" AND ch."id" = res."channel_id") AS "channel_code",
           (SELECT count(*)::int FROM "reservation_rooms" x
             WHERE x."property_id" = res."property_id" AND x."reservation_id" = res."id") AS "reservation_rooms",
           g."id" AS "guest_id", g."first_name", g."last_name", g."vip_level_id",
           (SELECT ty."code" FROM "room_types" ty
             WHERE ty."property_id" = rr."property_id" AND ty."id" = rr."room_type_id") AS "room_type_code",
           (SELECT ty."name" FROM "room_types" ty
             WHERE ty."property_id" = rr."property_id" AND ty."id" = rr."room_type_id") AS "room_type_name",
           (SELECT rm."number" FROM "rooms" rm
             WHERE rm."property_id" = rr."property_id" AND rm."id" = rr."room_id") AS "room_number",
           (SELECT rp."code" FROM "rate_plans" rp
             WHERE rp."property_id" = rr."property_id" AND rp."id" = rr."rate_plan_id") AS "rate_plan_code",
           (SELECT sc."code" FROM "source_codes" sc
             WHERE sc."property_id" = rr."property_id" AND sc."id" = rr."source_code_id") AS "source_code",
           (SELECT sum(n."rate_amount")::text FROM "reservation_room_nights" n
             WHERE n."reservation_room_id" = rr."id") AS "total",
           COALESCE((SELECT c."minor_units" FROM "currencies" c WHERE c."code" = ${currencyCode}), 2)::int
             AS "minor_units"
    FROM "reservation_rooms" rr
    JOIN "reservations" res ON res."property_id" = rr."property_id" AND res."id" = rr."reservation_id"
    JOIN "guests" g ON g."id" = rr."primary_guest_id"
    WHERE rr."property_id" = ${propertyId}::uuid
      AND rr."id" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY ${key} ${direction}, rr."id" ${direction}`;
}

/** Ids of guests passing every name filter, at most `take` (reservation search candidates). */
export function findGuestIdsByName(tx: Tx, filters: Prisma.GuestWhereInput[], take: number) {
  return tx.guest.findMany({ where: { AND: filters }, select: { id: true }, take });
}

/** The property's room with exactly this number (unique per property), if any. */
export function findRoomByNumber(tx: Tx, propertyId: string, number: string) {
  return tx.room.findUnique({
    where: { propertyId_number: { propertyId, number } },
    select: { id: true },
  });
}

/**
 * The sort keys of the reservation rooms that pass `filters` and match ANY of `branches`
 * (the text search: confirmation, cancellation number, external reference,
 * room, guest name), in `sort` order then id, at most `take`.
 *
 * Each branch is its own query with the same filters, order and limit, and
 * the page is cut from their union. This returns the same rows as one query
 * on "filters AND (b1 OR b2 …)": the first `take` rows of a union are always
 * among the first `take` rows of its parts, and (sort key, id) is a total
 * order. The single OR spans four joined tables, so no index can serve it:
 * PostgreSQL walked the property's whole history in sort order, joining each
 * row, until the page filled — seconds for a text that matches little or
 * nothing (docs/SCALABILITY.md §29). Alone, each branch uses its own index.
 */
export async function findReservationRoomPageKeysMatching(
  tx: Tx,
  filters: Prisma.ReservationRoomWhereInput[],
  branches: Prisma.ReservationRoomWhereInput[],
  sort: ListSort,
  take: number,
): Promise<ReservationPageKey[]> {
  const orderBy: Prisma.ReservationRoomOrderByWithRelationInput[] = [
    { [sort.field]: sort.direction },
    { id: sort.direction },
  ];
  const candidates = new Map<string, { row: ReservationPageKey; key: number }>();
  // One after another: each is a short indexed read, and one search should not
  // take several pool connections (running them at once was measured: no gain
  // under load, docs/SCALABILITY.md §29).
  for (const branch of branches) {
    const rows = await tx.reservationRoom.findMany({
      where: { AND: [...filters, branch] },
      orderBy,
      take,
      select: pageKeySelect,
    });
    for (const row of rows) {
      candidates.set(row.id, { row, key: row[sort.field].getTime() });
    }
  }
  // The query's order: the sort key, then the id (uuid order is the order of its
  // lowercase hex text).
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...candidates.values()]
    .sort(
      (a, b) => sign * (a.key - b.key || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0)),
    )
    .slice(0, take)
    .map((candidate) => candidate.row);
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
