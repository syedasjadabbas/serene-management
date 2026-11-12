/**
 * Offline mode rules (docs/OFFLINE_ARCHITECTURE.md). Pure functions only:
 * no browser APIs, so every rule is unit-tested.
 *
 * The offline snapshot is a read-only picture of one property's front
 * office for one signed-in user. It is keyed by user AND property, holds
 * only what the front desk needs to keep working during an outage, expires,
 * and is dropped as soon as the user, their property access or their
 * permissions no longer justify it.
 */

/** A snapshot older than this is never shown (a shift plus an overnight outage). */
export const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** How often an online workspace refreshes its snapshot (only while visible). */
export const SNAPSHOT_REFRESH_MS = 10 * 60 * 1000;
/** Rows per list kept offline (the API page maximum); larger lists keep the first page. */
export const SNAPSHOT_LIST_LIMIT = 200;

/**
 * Each snapshot section exists only if the user held its read permission
 * when it was taken; the snapshot records those permissions and is deleted
 * as soon as any of them is no longer held.
 */
export const SNAPSHOT_SECTIONS = {
  frontDesk: "frontdesk:read",
  rooms: "rooms:read",
} as const;
export type SnapshotPermission = (typeof SNAPSHOT_SECTIONS)[keyof typeof SNAPSHOT_SECTIONS];

/** Which sections a user may have offline at a property (none: no snapshot at all). */
export function snapshotPermissions(
  isSuperAdmin: boolean,
  granted: readonly string[],
): SnapshotPermission[] {
  return Object.values(SNAPSHOT_SECTIONS).filter((p) => isSuperAdmin || granted.includes(p));
}

export const snapshotKey = (userId: string, propertyId: string) => `${userId}:${propertyId}`;

// --- Minimised records (what is stored) ------------------------------------

export interface OfflineArrival {
  reservationRoomId: string;
  confirmation: string;
  guestName: string;
  vip: string | null;
  arrival: string;
  departure: string;
  nights: number;
  adults: number;
  children: number;
  eta: string | null;
  roomType: string;
  room: string | null;
  state: string;
}

export interface OfflineStay {
  stayId: string;
  confirmation: string;
  guestName: string;
  vip: string | null;
  room: string;
  roomType: string;
  arrival: string;
  departure: string;
  status: string;
  checkoutTiming: string | null;
}

export interface OfflineRoom {
  id: string;
  number: string;
  roomType: string;
  floor: string | null;
  status: string;
  frontOfficeStatus: string;
  housekeepingStatus: string;
  /** Guest names only when the server sent them (frontdesk:read). */
  guest: string | null;
}

export interface OfflineSnapshot {
  key: string;
  userId: string;
  propertyId: string;
  propertyCode: string;
  propertyName: string;
  timezone: string;
  businessDate: string | null;
  /** Epoch ms when the data was fetched from the server. */
  savedAt: number;
  /** Permissions the sections below were fetched under. */
  permissions: SnapshotPermission[];
  arrivals: OfflineArrival[] | null;
  inHouse: OfflineStay[] | null;
  departures: OfflineStay[] | null;
  rooms: OfflineRoom[] | null;
}

// Source shapes (a subset of the API types, so this module stays pure).
interface ArrivalSource {
  reservationRoomId: string;
  confirmation: string;
  guest: { name: string; vip: string | null };
  arrival: string;
  departure: string;
  nights: number;
  adults: number;
  children: number;
  eta: string | null;
  roomType: { code: string };
  room: { number: string } | null;
  state: string;
}
interface StaySource {
  stayId: string;
  confirmation: string;
  guest: { name: string; vip: string | null };
  room: { number: string };
  roomType: { code: string };
  arrival: string;
  departure: string;
  stayStatus: string;
  checkoutTiming: string | null;
}
interface RoomSource {
  id: string;
  number: string;
  roomType: { code: string };
  floor: { name: string } | null;
  status: string;
  frontOfficeStatus: string;
  housekeepingStatus: string;
  inHouse: { guestName: string | null } | null;
}

/**
 * Data minimisation: identifiers, names, dates and statuses only. Never
 * e-mail, phone, notes, rates, balances or documents: the free-text
 * `latestNote` in particular is deliberately dropped.
 */
export function minimiseArrival(row: ArrivalSource): OfflineArrival {
  return {
    reservationRoomId: row.reservationRoomId,
    confirmation: row.confirmation,
    guestName: row.guest.name,
    vip: row.guest.vip,
    arrival: row.arrival,
    departure: row.departure,
    nights: row.nights,
    adults: row.adults,
    children: row.children,
    eta: row.eta,
    roomType: row.roomType.code,
    room: row.room?.number ?? null,
    state: row.state,
  };
}

export function minimiseStay(row: StaySource): OfflineStay {
  return {
    stayId: row.stayId,
    confirmation: row.confirmation,
    guestName: row.guest.name,
    vip: row.guest.vip,
    room: row.room.number,
    roomType: row.roomType.code,
    arrival: row.arrival,
    departure: row.departure,
    status: row.stayStatus,
    checkoutTiming: row.checkoutTiming,
  };
}

export function minimiseRoom(row: RoomSource): OfflineRoom {
  return {
    id: row.id,
    number: row.number,
    roomType: row.roomType.code,
    floor: row.floor?.name ?? null,
    status: row.status,
    frontOfficeStatus: row.frontOfficeStatus,
    housekeepingStatus: row.housekeepingStatus,
    guest: row.inHouse?.guestName ?? null,
  };
}

// --- When a snapshot may be shown ------------------------------------------

export type SnapshotUsability = "usable" | "stale-business-date" | "expired" | "other-user";

/**
 * A snapshot is shown only to the user it was taken for (the last user
 * signed in on this browser) and never after SNAPSHOT_MAX_AGE_MS. A newer
 * business date known to the app marks it stale (still shown, with a
 * warning: night audit ran after it was taken).
 */
export function snapshotUsability(
  snapshot: Pick<OfflineSnapshot, "userId" | "savedAt" | "businessDate">,
  context: { userId: string | null; now: number; latestBusinessDate?: string | null },
): SnapshotUsability {
  if (!context.userId || snapshot.userId !== context.userId) return "other-user";
  if (
    context.now - snapshot.savedAt > SNAPSHOT_MAX_AGE_MS ||
    snapshot.savedAt > context.now + 60_000
  ) {
    return "expired";
  }
  if (
    context.latestBusinessDate &&
    snapshot.businessDate &&
    context.latestBusinessDate > snapshot.businessDate
  ) {
    return "stale-business-date";
  }
  return "usable";
}

/**
 * Which stored snapshots must be deleted given the signed-in user's live
 * access (checked every time the app loads online): other users' data,
 * properties no longer accessible, and properties where the user lost any
 * permission a stored section was fetched under.
 */
export function snapshotsToDelete(
  stored: Pick<OfflineSnapshot, "key" | "userId" | "propertyId" | "permissions">[],
  me: {
    userId: string;
    isSuperAdmin: boolean;
    properties: { id: string; permissions: readonly string[] }[];
  },
): string[] {
  const live = new Map(
    me.properties.map((p) => [p.id, snapshotPermissions(me.isSuperAdmin, p.permissions)]),
  );
  return stored
    .filter((s) => {
      if (s.userId !== me.userId) return true;
      const held = live.get(s.propertyId);
      return !held || held.length === 0 || s.permissions.some((p) => !held.includes(p));
    })
    .map((s) => s.key);
}

// --- Queued operations (design contract for phase 2; see the architecture doc) ---

export type QueuedOperationType =
  | "reservationRoom.assignRoom"
  | "reservationRoom.checkIn"
  | "stay.checkOut"
  | "room.markClean"
  | "room.markDirty";

export type QueuedOperationStatus =
  "pending" | "syncing" | "synced" | "conflict" | "rejected" | "failed";

export interface QueuedOperation {
  /** Client-generated UUID; also sent as Idempotency-Key once the server supports it for the operation. */
  id: string;
  type: QueuedOperationType;
  userId: string;
  propertyId: string;
  entityId: string;
  /** The entity version the user saw: the server rejects the change if it moved on. */
  baseVersion: number;
  payload: Record<string, unknown>;
  createdAt: number;
  /** Per-property sequence: operations replay in the order they were made. */
  sequence: number;
  retries: number;
  status: QueuedOperationStatus;
  error: { code: string; message: string; reason?: string } | null;
}

export type SyncOutcome =
  | { kind: "synced" }
  | { kind: "conflict"; reason: string }
  | { kind: "rejected"; reason: string }
  | { kind: "reauthenticate" }
  | { kind: "retry"; delayMs: number };

/**
 * How the queue treats the server's answer to a replayed operation. The
 * server is authoritative: a stale version or a broken business rule is a
 * conflict for a person to resolve, never retried automatically; only
 * transport failures, rate limits and server errors are retried.
 */
export function classifySyncResponse(
  status: number | null,
  error: { code?: string; details?: { reason?: string } } | null,
  retries: number,
): SyncOutcome {
  if (status !== null && status >= 200 && status < 300) return { kind: "synced" };
  if (status === 401) return { kind: "reauthenticate" };
  if (status === 409 || status === 422 || status === 423) {
    return { kind: "conflict", reason: error?.details?.reason ?? error?.code ?? `HTTP_${status}` };
  }
  if (status === 400 || status === 403 || status === 404) {
    return { kind: "rejected", reason: error?.code ?? `HTTP_${status}` };
  }
  return { kind: "retry", delayMs: retryDelayMs(retries) };
}

/** Exponential backoff with a cap: 2 s, 4 s, 8 s … up to 5 minutes. */
export function retryDelayMs(retries: number): number {
  return Math.min(5 * 60_000, 2_000 * 2 ** Math.max(0, retries));
}
