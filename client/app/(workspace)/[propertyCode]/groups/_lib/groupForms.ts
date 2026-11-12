import { z } from "zod";
import type { ClientApiError } from "@/global/api/errors";
import { addDays } from "@serene/shared/modules/business-date/business-date.policy";

export const digits = (value: string) => value.replace(/\D/g, "");
export const toInt = (value: string) => Number.parseInt(value || "0", 10);

const REASON_MESSAGE = "Enter a reason of at least 3 characters";
const picked = z.object({ id: z.string(), label: z.string() }).nullable();
export type PickedValue = z.infer<typeof picked>;

/** The audited-reason rule: required (3+ characters) while the override box is ticked. */
function overrideReason(value: { override: boolean; reason: string }, ctx: z.RefinementCtx) {
  if (value.override && value.reason.trim().length < 3) {
    ctx.addIssue({ code: "custom", path: ["reason"], message: REASON_MESSAGE });
  }
}

/** Renames server field keys to the form's own (e.g. `allocations` to `rooms`). */
export function renameServerFields(
  error: ClientApiError | null,
  map: Record<string, string>,
): ClientApiError | null {
  if (!error) return null;
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(error.fieldErrors)) {
    fieldErrors[map[key] ?? key] = value;
  }
  return { ...error, fieldErrors };
}

// --- New group -----------------------------------------------------------------------------

export const newGroupFormSchema = z.object({
  code: z.string().refine((v) => v.trim().length > 0, "Enter a code"),
  name: z.string().refine((v) => v.trim().length > 0, "Enter a name"),
  notes: z.string(),
});
export const newGroupDefaults = { code: "", name: "", notes: "" };
export const newGroupBody = (v: { code: string; name: string; notes: string }) => ({
  code: v.code.trim(),
  name: v.name.trim(),
  notes: v.notes.trim() || null,
});

// --- New block -----------------------------------------------------------------------------

/** Room types with at least one room, as the API wants them. */
export function blockAllocations(rooms: Record<string, string>) {
  return Object.entries(rooms)
    .filter(([, v]) => toInt(v) > 0)
    .map(([roomTypeId, v]) => ({ roomTypeId, rooms: toInt(v) }));
}

export const newBlockFormSchema = z
  .object({
    code: z.string().refine((v) => v.trim().length > 0, "Enter a code"),
    name: z.string().refine((v) => v.trim().length > 0, "Enter a name"),
    statusId: z.string().min(1, "Choose a status"),
    ratePlanId: z.string().min(1, "Choose a rate plan"),
    startDate: z.string().min(1, "Choose the first night"),
    endDate: z.string().min(1, "Choose the departure date"),
    cutoffDate: z.string(),
    isElastic: z.boolean(),
    rooms: z.record(z.string(), z.string()),
    override: z.boolean(),
    reason: z.string(),
  })
  .superRefine((v, ctx) => {
    if (blockAllocations(v.rooms).length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["rooms"],
        message: "Enter the rooms per night for at least one room type",
      });
    }
    overrideReason(v, ctx);
  });

export function newBlockDefaults(start: string) {
  return {
    code: "",
    name: "",
    statusId: "",
    ratePlanId: "",
    startDate: start,
    endDate: start ? addDays(start, 1) : "",
    cutoffDate: "",
    isElastic: false,
    rooms: {} as Record<string, string>,
    override: false,
    reason: "",
  };
}

export function newBlockBody(v: z.output<typeof newBlockFormSchema>) {
  return {
    code: v.code.trim(),
    name: v.name.trim(),
    statusId: v.statusId,
    ratePlanId: v.ratePlanId,
    startDate: v.startDate,
    endDate: v.endDate,
    cutoffDate: v.cutoffDate || null,
    isElastic: v.isElastic,
    allocations: blockAllocations(v.rooms),
    override: v.override,
    reason: v.reason.trim() || undefined,
  };
}

// --- Allocation ----------------------------------------------------------------------------

export const allocationFormSchema = z
  .object({
    roomTypeId: z.string().min(1, "Choose a room type"),
    from: z.string().min(1, "Choose the first night"),
    to: z.string().min(1, "Choose the last night"),
    rooms: z.string().min(1, "Enter the rooms per night"),
    override: z.boolean(),
    reason: z.string(),
  })
  .superRefine(overrideReason);

export function allocationDefaults(roomTypeId: string, startDate: string, endDate: string) {
  return {
    roomTypeId,
    from: startDate,
    to: addDays(endDate, -1),
    rooms: "",
    override: false,
    reason: "",
  };
}

export const allocationBody = (v: z.output<typeof allocationFormSchema>, version: number) => ({
  version,
  roomTypeId: v.roomTypeId,
  from: v.from,
  to: v.to,
  rooms: toInt(v.rooms),
  override: v.override,
  reason: v.reason.trim() || undefined,
});

// --- Block status --------------------------------------------------------------------------

export const blockStatusFormSchema = z
  .object({
    statusId: z.string().min(1, "Choose a status"),
    override: z.boolean(),
    reason: z.string(),
  })
  .superRefine(overrideReason);
export const blockStatusDefaults = { statusId: "", override: false, reason: "" };

// --- Release -------------------------------------------------------------------------------

export const releaseFormSchema = z.object({
  roomTypeId: z.string(),
  from: z.string().min(1, "Choose the first night"),
  to: z.string().min(1, "Choose the last night"),
  reason: z.string().refine((v) => v.trim().length >= 3, REASON_MESSAGE),
});

export function releaseDefaults(startDate: string, endDate: string) {
  return { roomTypeId: "", from: startDate, to: addDays(endDate, -1), reason: "" };
}

export const releaseBody = (v: z.output<typeof releaseFormSchema>, version: number) => ({
  version,
  roomTypeId: v.roomTypeId || undefined,
  from: v.from,
  to: v.to,
  reason: v.reason.trim(),
});

// --- Pickup --------------------------------------------------------------------------------

export const pickupFormSchema = z
  .object({
    guest: picked,
    roomTypeId: z.string().min(1, "Choose a room type"),
    arrival: z.string().min(1, "Choose the arrival date"),
    departure: z.string().min(1, "Choose the departure date"),
    adults: z.string().refine((v) => toInt(v) >= 1, "Enter at least 1 adult"),
    rooms: z.string().refine((v) => toInt(v) >= 1, "Enter at least 1 room"),
    override: z.boolean(),
    reason: z.string(),
  })
  .superRefine((v, ctx) => {
    if (!v.guest) ctx.addIssue({ code: "custom", path: ["guest"], message: "Choose a guest" });
    overrideReason(v, ctx);
  });

export function pickupDefaults(roomTypeId: string, startDate: string, endDate: string) {
  return {
    guest: null as PickedValue,
    roomTypeId,
    arrival: startDate,
    departure: endDate,
    adults: "2",
    rooms: "1",
    override: false,
    reason: "",
  };
}

export const pickupBody = (v: z.output<typeof pickupFormSchema>, guestId: string) => ({
  guestId,
  roomTypeId: v.roomTypeId,
  arrival: v.arrival,
  departure: v.departure,
  adults: toInt(v.adults),
  children: 0,
  rooms: toInt(v.rooms),
  override: v.override,
  reason: v.reason.trim() || undefined,
});

// --- Close / cancel group ------------------------------------------------------------------

export const groupStatusFormSchema = z.object({
  status: z.enum(["CLOSED", "CANCELLED"]),
  reason: z.string().refine((v) => v.trim().length >= 3, REASON_MESSAGE),
});
export const groupStatusDefaults = { status: "CLOSED" as "CLOSED" | "CANCELLED", reason: "" };

// --- Edit group ----------------------------------------------------------------------------

export const editGroupFormSchema = z.object({
  name: z.string().refine((v) => v.trim().length > 0, "Enter a name"),
  company: picked,
  contact: picked,
  notes: z.string(),
});
