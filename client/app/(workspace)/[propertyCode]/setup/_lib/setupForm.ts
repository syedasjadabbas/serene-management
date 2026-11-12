import { z } from "zod";

/** Every setup change carries an audit reason of at least 3 characters (settings:manage is high-risk). */
export const REASON_MESSAGE = "Enter a reason of at least 3 characters";

export function reasonIssue(ctx: z.RefinementCtx, reason: string) {
  if (reason.trim().length < 3) {
    ctx.addIssue({ code: "custom", path: ["reason"], message: REASON_MESSAGE });
  }
}

// --- Go live ---------------------------------------------------------------------------

/** Opening the first business date: a date (or today at the property) and a reason. */
export function goLiveFormSchema(today: string | null) {
  return z.object({ date: z.string(), reason: z.string() }).superRefine((v, ctx) => {
    if (!(v.date || today)) {
      ctx.addIssue({ code: "custom", path: ["date"], message: "Select the first business date" });
    }
    reasonIssue(ctx, v.reason);
  });
}

export function goLivePayload(values: { date: string; reason: string }, today: string | null) {
  return { date: values.date || today || "", reason: values.reason.trim() };
}

// --- Property settings -----------------------------------------------------------------

export const SETTING_FLAGS = [
  "requireInspectedForCheckIn",
  "usePickupStatus",
  "autoNoShowOnNightAudit",
  "postNoShowCharges",
  "requireZeroBalanceCheckout",
] as const;

export const settingsFormSchema = z
  .object({
    checkInTime: z.string(),
    checkOutTime: z.string(),
    maxFolioWindows: z.string(),
    timezone: z.string(),
    confirmationPrefix: z.string(),
    requireInspectedForCheckIn: z.boolean(),
    usePickupStatus: z.boolean(),
    autoNoShowOnNightAudit: z.boolean(),
    postNoShowCharges: z.boolean(),
    requireZeroBalanceCheckout: z.boolean(),
    reason: z.string(),
  })
  .superRefine((v, ctx) => reasonIssue(ctx, v.reason));

export type SettingsFormValues = z.input<typeof settingsFormSchema>;

interface ConfigLike {
  checkInTime: string;
  checkOutTime: string;
  maxFolioWindows: number;
  timezone: string;
  confirmationPrefix: string;
  requireInspectedForCheckIn: boolean;
  usePickupStatus: boolean;
  autoNoShowOnNightAudit: boolean;
  postNoShowCharges: boolean;
  requireZeroBalanceCheckout: boolean;
}

export function settingsDefaults(config: ConfigLike): SettingsFormValues {
  return {
    checkInTime: config.checkInTime,
    checkOutTime: config.checkOutTime,
    maxFolioWindows: String(config.maxFolioWindows),
    timezone: config.timezone,
    confirmationPrefix: config.confirmationPrefix,
    requireInspectedForCheckIn: config.requireInspectedForCheckIn,
    usePickupStatus: config.usePickupStatus,
    autoNoShowOnNightAudit: config.autoNoShowOnNightAudit,
    postNoShowCharges: config.postNoShowCharges,
    requireZeroBalanceCheckout: config.requireZeroBalanceCheckout,
    reason: "",
  };
}

/** Only what differs from the saved configuration (identity fields only before go-live). */
export function settingsChanges(
  v: SettingsFormValues,
  config: ConfigLike,
  live: boolean,
): Record<string, string | number | boolean> {
  const changes: Record<string, string | number | boolean> = {};
  if (v.checkInTime !== config.checkInTime) changes.checkInTime = v.checkInTime;
  if (v.checkOutTime !== config.checkOutTime) changes.checkOutTime = v.checkOutTime;
  if (Number(v.maxFolioWindows) !== config.maxFolioWindows)
    changes.maxFolioWindows = Number(v.maxFolioWindows);
  if (!live && v.timezone.trim() !== config.timezone) changes.timezone = v.timezone.trim();
  if (!live && v.confirmationPrefix.trim().toUpperCase() !== config.confirmationPrefix)
    changes.confirmationPrefix = v.confirmationPrefix.trim().toUpperCase();
  for (const key of SETTING_FLAGS) if (v[key] !== config[key]) changes[key] = v[key];
  return changes;
}

// --- Room types ------------------------------------------------------------------------

/** Room type form; `isEdit` drops the code requirement (the code never changes). */
export function roomTypeFormSchema(isEdit: boolean) {
  const count = (label: string) =>
    z.string().refine((v) => {
      const n = Number.parseInt(v, 10);
      return Number.isInteger(n) && n >= 0;
    }, `${label} must be a whole number`);
  return z
    .object({
      code: z.string(),
      name: z.string(),
      description: z.string(),
      maxOccupancy: count("Max guests"),
      maxAdults: count("Max adults"),
      maxChildren: count("Max children"),
      defaultOccupancy: count("Usual guests"),
      status: z.enum(["ACTIVE", "INACTIVE"]),
      reason: z.string(),
    })
    .superRefine((v, ctx) => {
      if (v.name.trim().length === 0)
        ctx.addIssue({ code: "custom", path: ["name"], message: "Enter a name" });
      if (!isEdit && v.code.trim().length === 0)
        ctx.addIssue({ code: "custom", path: ["code"], message: "Enter a code" });
      reasonIssue(ctx, v.reason);
    });
}

export type RoomTypeFormValues = z.input<ReturnType<typeof roomTypeFormSchema>>;

interface RoomTypeLike {
  code: string;
  name: string;
  description?: string | null;
  maxOccupancy: number;
  maxAdults: number;
  maxChildren: number;
  defaultOccupancy: number;
  status: "ACTIVE" | "INACTIVE";
}

export function roomTypeDefaults(type: RoomTypeLike | null): RoomTypeFormValues {
  return {
    code: type?.code ?? "",
    name: type?.name ?? "",
    description: type?.description ?? "",
    maxOccupancy: String(type?.maxOccupancy ?? 2),
    maxAdults: String(type?.maxAdults ?? 2),
    maxChildren: String(type?.maxChildren ?? 0),
    defaultOccupancy: String(type?.defaultOccupancy ?? 2),
    status: type?.status ?? "ACTIVE",
    reason: "",
  };
}

export function roomTypeFields(v: RoomTypeFormValues) {
  const num = (value: string) => Number.parseInt(value, 10);
  return {
    name: v.name.trim(),
    description: v.description.trim() || undefined,
    maxOccupancy: num(v.maxOccupancy),
    maxAdults: num(v.maxAdults),
    maxChildren: num(v.maxChildren),
    defaultOccupancy: num(v.defaultOccupancy),
    reason: v.reason.trim(),
  };
}

// --- Floors and rooms ------------------------------------------------------------------

/** Floor form; `isEdit` drops the code requirement. The level is a whole number. */
export function floorFormSchema(isEdit: boolean) {
  return z
    .object({
      code: z.string(),
      name: z.string(),
      level: z.string(),
      status: z.enum(["ACTIVE", "INACTIVE"]),
      reason: z.string(),
    })
    .superRefine((v, ctx) => {
      if (!v.name.trim()) ctx.addIssue({ code: "custom", path: ["name"], message: "Enter a name" });
      if (!Number.isInteger(Number.parseInt(v.level, 10)))
        ctx.addIssue({ code: "custom", path: ["level"], message: "Enter a whole number" });
      if (!isEdit && !v.code.trim())
        ctx.addIssue({ code: "custom", path: ["code"], message: "Enter a code" });
      reasonIssue(ctx, v.reason);
    });
}

export type FloorFormValues = z.input<ReturnType<typeof floorFormSchema>>;

export function floorDefaults(
  floor: { code: string; name: string; level: number; status: "ACTIVE" | "INACTIVE" } | null,
): FloorFormValues {
  return {
    code: floor?.code ?? "",
    name: floor?.name ?? "",
    level: String(floor?.level ?? 1),
    status: floor?.status ?? "ACTIVE",
    reason: "",
  };
}

export function floorFields(v: FloorFormValues) {
  return { name: v.name.trim(), level: Number.parseInt(v.level, 10), reason: v.reason.trim() };
}

/** "101-110, 115" → the room numbers; `parse` is SetupFields' parseRoomNumbers. */
export function addRoomsFormSchema(
  parse: (text: string) => { numbers: string[]; error: string | null },
) {
  return z
    .object({
      numbers: z.string(),
      roomTypeId: z.string(),
      floorId: z.string(),
      housekeepingStatus: z.enum(["DIRTY", "CLEAN", "INSPECTED"]),
      isAccessible: z.boolean(),
      isSmoking: z.boolean(),
      reason: z.string(),
    })
    .superRefine((v, ctx) => {
      const parsed = parse(v.numbers);
      if (parsed.error) ctx.addIssue({ code: "custom", path: ["numbers"], message: parsed.error });
      else if (parsed.numbers.length === 0)
        ctx.addIssue({
          code: "custom",
          path: ["numbers"],
          message: "Enter at least one room number",
        });
      if (!v.roomTypeId)
        ctx.addIssue({ code: "custom", path: ["roomTypeId"], message: "Select a room type" });
      reasonIssue(ctx, v.reason);
    });
}

export type AddRoomsFormValues = z.input<ReturnType<typeof addRoomsFormSchema>>;

export function addRoomsDefaults(firstTypeId: string): AddRoomsFormValues {
  return {
    numbers: "",
    roomTypeId: firstTypeId,
    floorId: "",
    housekeepingStatus: "INSPECTED",
    isAccessible: false,
    isSmoking: false,
    reason: "",
  };
}

export function addRoomsPayload(v: AddRoomsFormValues, numbers: string[]) {
  return {
    numbers,
    roomTypeId: v.roomTypeId,
    floorId: v.floorId || null,
    housekeepingStatus: v.housekeepingStatus,
    isAccessible: v.isAccessible,
    isSmoking: v.isSmoking,
    reason: v.reason.trim(),
  };
}

export const editRoomFormSchema = z
  .object({
    number: z.string(),
    roomTypeId: z.string(),
    floorId: z.string(),
    isAccessible: z.boolean(),
    isSmoking: z.boolean(),
    status: z.enum(["ACTIVE", "INACTIVE"]),
    reason: z.string(),
  })
  .superRefine((v, ctx) => {
    if (!v.number.trim())
      ctx.addIssue({ code: "custom", path: ["number"], message: "Enter a room number" });
    reasonIssue(ctx, v.reason);
  });

export type EditRoomFormValues = z.input<typeof editRoomFormSchema>;

export function editRoomDefaults(room: {
  number: string;
  roomTypeId: string;
  floorId: string | null;
  isAccessible: boolean;
  isSmoking: boolean;
  status: "ACTIVE" | "INACTIVE";
}): EditRoomFormValues {
  return {
    number: room.number,
    roomTypeId: room.roomTypeId,
    floorId: room.floorId ?? "",
    isAccessible: room.isAccessible,
    isSmoking: room.isSmoking,
    status: room.status,
    reason: "",
  };
}

// --- Taxes -----------------------------------------------------------------------------

const TAX_RATE = /^\d{1,13}(\.\d{1,4})?$/;

/** "16.0000" → "16"; "12.5000" → "12.5". */
export const trimRate = (rate: string) => rate.replace(/\.?0+$/, "");

/** Tax form; `startDefault` (the business date) stands in for an empty "in force from". */
export function taxFormSchema(isEdit: boolean, startDefault: string) {
  return z
    .object({
      code: z.string(),
      name: z.string(),
      calculation: z.enum(["PERCENT", "FLAT_PER_UNIT"]),
      basis: z.enum(["NET", "COMPOUND"]),
      rate: z.string(),
      effectiveFrom: z.string(),
      effectiveTo: z.string(),
      appliesTo: z.array(z.string()),
      status: z.enum(["ACTIVE", "INACTIVE"]),
      reason: z.string(),
    })
    .superRefine((v, ctx) => {
      const add = (path: string, message: string) =>
        ctx.addIssue({ code: "custom", path: [path], message });
      if (!v.name.trim()) add("name", "Enter a name");
      if (!TAX_RATE.test(v.rate.trim()))
        add("rate", "Enter a number with at most 4 decimals, e.g. 16 or 12.5");
      if (!(v.effectiveFrom || startDefault)) add("effectiveFrom", "Select the first date");
      if (!isEdit && !v.code.trim()) add("code", "Enter a code");
      reasonIssue(ctx, v.reason);
    });
}

export type TaxFormValues = z.input<ReturnType<typeof taxFormSchema>>;

export function taxDefaults(
  tax: {
    code: string;
    name: string;
    calculation: "PERCENT" | "FLAT_PER_UNIT";
    basis: "NET" | "COMPOUND";
    rate: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    appliesTo: { id: string }[];
    status: "ACTIVE" | "INACTIVE";
  } | null,
  startDefault: string,
): TaxFormValues {
  return {
    code: tax?.code ?? "",
    name: tax?.name ?? "",
    calculation: tax?.calculation ?? "PERCENT",
    basis: tax?.basis ?? "NET",
    rate: tax ? trimRate(tax.rate) : "",
    effectiveFrom: tax?.effectiveFrom ?? startDefault,
    effectiveTo: tax?.effectiveTo ?? "",
    appliesTo: tax?.appliesTo.map((c) => c.id) ?? [],
    status: tax?.status ?? "ACTIVE",
    reason: "",
  };
}

export function taxFields(v: TaxFormValues, startDefault: string) {
  return {
    name: v.name.trim(),
    calculation: v.calculation,
    basis: v.basis,
    rate: v.rate.trim(),
    effectiveFrom: v.effectiveFrom || startDefault,
    effectiveTo: v.effectiveTo || null,
    appliesTo: v.appliesTo,
    reason: v.reason.trim(),
  };
}
