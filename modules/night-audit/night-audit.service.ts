import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/lib/db/prisma";
import { databaseErrorCode, runInTransaction } from "@/lib/db/transaction";
import { auditActor, type IdempotencyRequest, type PropertyContext } from "@/lib/http/context";
import { AppError, notFound } from "@/lib/http/errors";
import { logServerError } from "@/lib/http/log";
import { hasPermission } from "@/lib/permissions/evaluate";
import { decodeCursor, encodeCursor } from "@/lib/utils/cursor";
import { formatMoney, parseMoney } from "@/lib/utils/money";
import { recordAudit, userDisplayNames } from "@/modules/audit/audit.service";
import { recordEvent } from "@/modules/integrations/outbox.service";
import type { AuditActor } from "@/modules/audit/audit.types";
import { reconcileInventoryInTx } from "@/modules/availability/availability.service";
import { postNightsInTx, postNoShowFeeInTx } from "@/modules/billing/billing.service";
import { addDays, localDateInZone, toDateOnly } from "@/modules/business-date/business-date.policy";
import { applyCutoffsInTx } from "@/modules/groups/groups.service";
import { rollTasksInTx } from "@/modules/housekeeping/housekeeping.service";
import { runIdempotent } from "@/modules/idempotency/idempotency.service";
import {
  lockReservationRoomById,
  releaseReservationInTx,
} from "@/modules/reservations/reservations.service";
import { rollOccupiedRoomsInTx, rollServiceBlocksInTx } from "@/modules/rooms/rooms.service";
import type { CursorPageMeta } from "@/types/api";
import {
  CHECK_ITEM_LIMIT,
  CHECK_STEPS,
  COMMIT_STEPS,
  type CheckOutcome,
  type CommitStep,
  STEP_LABELS,
  type StepCode,
  type StepStatus,
  closeDateProblem,
  isBlocking,
  isStaleRun,
  stepStatusOf,
} from "./night-audit.policy";
import {
  type StayCheckRow,
  countRoomTypesForNight,
  countRoomsForNight,
  findAuditConfiguration,
  findDueArrivals,
  findInHouseReservationRoomIds,
  findLastFinishedRun,
  findNoShowCandidateIds,
  findNoShowReasonCode,
  findOverdueDepartures,
  findPaymentMismatches,
  findRoomStatusDiscrepancies,
  findRun,
  findRunningRun,
  findRunsPage,
  findUnbalancedFolios,
  findUnpostedNights,
  finishRun,
  insertRun,
  insertSteps,
  lockCurrentBusinessDateForUpdate,
  lockCurrentBusinessDateNoWait,
  lockRun,
  nextAttempt,
  rollBusinessDate,
  setBusinessDateStatus,
  sumMoneyForDate,
  sumRoomRevenueByType,
} from "./night-audit.repository";
import type {
  NightAuditRunsQuery,
  RecoverNightAuditInput,
  StartNightAuditInput,
} from "./night-audit.schema";
import type {
  CheckItem,
  CheckResult,
  NightAuditSummary,
  ReadinessView,
  RunListItem,
  RunStepView,
  RunView,
} from "./night-audit.types";

/**
 * Night audit (docs/PMS_WORKFLOWS.md §26, ARCHITECTURE D7, D30–D34).
 *
 * Phase A (short transaction): the business date row FOR UPDATE, the
 *   Idempotency-Key, a RUNNING run, the date IN_AUDIT. From then on every
 *   posting command answers 423 BUSINESS_DATE_LOCKED.
 * Phase B (read-only): the checks. A blocking one fails the run; the date
 *   returns to OPEN and nothing was posted.
 * Phase C (one transaction): room/package/tax posting, no-shows, releases,
 *   room and task roll, inventory reconciliation, statistics, close D and
 *   open D+1, run COMPLETED. Any error rolls everything back; a separate
 *   transaction records the failed run and reopens the date.
 */

/** Test seam: throw from `beforeStep` to inject a failure at a Phase C step. */
export interface NightAuditHooks {
  beforeStep?: (code: CommitStep) => void | Promise<void>;
}

const COMMIT_TIMEOUT_MS = 300_000;
const SYSTEM_REASON = "Automatic no-show (night audit)";

function systemActor(ctx: PropertyContext): AuditActor {
  return { ...auditActor(ctx), actorType: "SYSTEM" };
}

function requireLive(ctx: PropertyContext): string {
  if (!ctx.businessDate) {
    throw new AppError("BUSINESS_RULE_VIOLATION", "The property is not live yet", {
      reason: "NOT_INITIALIZED",
    });
  }
  return ctx.businessDate;
}

// --- Phase B: checks ----------------------------------------------------------------------------

function stayItem(row: StayCheckRow, detail: string): CheckItem {
  return {
    label: `${row.confirmation_number}-${row.line_number} · ${row.guest_name}${row.room_number ? ` · Room ${row.room_number}` : ""}`,
    detail,
    link: row.stay_id
      ? { kind: "stay", id: row.stay_id }
      : { kind: "reservation", id: row.reservation_id },
  };
}

function check(
  code: CheckResult["code"],
  outcome: CheckOutcome,
  message: string,
  items: CheckItem[],
  count = items.length,
): CheckResult {
  return {
    code,
    label: STEP_LABELS[code],
    outcome,
    message,
    count,
    items: items.slice(0, CHECK_ITEM_LIMIT),
  };
}

/** Phase B, read-only: the checks for closing `businessDate`. */
export async function runChecks(propertyId: string, businessDate: string): Promise<CheckResult[]> {
  const config = await findAuditConfiguration(prisma, propertyId);
  const results: CheckResult[] = [];

  const departures = await findOverdueDepartures(prisma, propertyId, businessDate);
  results.push(
    departures.length === 0
      ? check("VALIDATE_DEPARTURES", "PASSED", "Every guest due out has left", [])
      : check(
          "VALIDATE_DEPARTURES",
          "BLOCKING",
          "Guests due out are still in house. Check them out or extend their stay.",
          departures.map((row) => stayItem(row, `Due out ${row.departure}`)),
        ),
  );

  const arrivals = await findDueArrivals(prisma, propertyId, businessDate);
  if (arrivals.length === 0) {
    results.push(check("VALIDATE_ARRIVALS", "PASSED", "Every arrival has checked in", []));
  } else if (!config.autoNoShowOnNightAudit) {
    results.push(
      check(
        "VALIDATE_ARRIVALS",
        "BLOCKING",
        "Arrivals have not checked in and automatic no-shows are off. Check them in, cancel them or mark them as no-shows.",
        arrivals.map((row) => stayItem(row, `Arrival ${row.arrival}`)),
      ),
    );
  } else if (!(await findNoShowReasonCode(prisma, propertyId, config.noShowReasonCodeId))) {
    results.push(
      check(
        "VALIDATE_ARRIVALS",
        "BLOCKING",
        "Arrivals would become no-shows, but the property has no active no-show reason code.",
        arrivals.map((row) => stayItem(row, `Arrival ${row.arrival}`)),
      ),
    );
  } else {
    results.push(
      check(
        "VALIDATE_ARRIVALS",
        "WARNING",
        `${arrivals.length} arrival${arrivals.length === 1 ? "" : "s"} will become no-show${arrivals.length === 1 ? "" : "s"}.`,
        arrivals.map((row) =>
          stayItem(row, `Arrival ${row.arrival}${row.guaranteed ? " · guaranteed" : ""}`),
        ),
      ),
    );
  }

  const folios = await findUnbalancedFolios(prisma, propertyId);
  results.push(
    folios.length === 0
      ? check("VALIDATE_BALANCES", "PASSED", "Every folio balance equals its ledger", [])
      : check(
          "VALIDATE_BALANCES",
          "BLOCKING",
          "Folio totals disagree with their ledger. Contact support before closing the day.",
          folios.map((row) => ({
            label: `Folio window ${row.window}`,
            detail: `Stored ${row.balance}, ledger ${row.ledger}`,
            link: row.reservation_room_id
              ? { kind: "folio" as const, id: row.reservation_room_id }
              : null,
          })),
        ),
  );

  const payments = await findPaymentMismatches(prisma, propertyId, businessDate);
  results.push(
    payments.length === 0
      ? check("VALIDATE_PAYMENTS", "PASSED", "Every payment, void and refund is in the ledger", [])
      : check(
          "VALIDATE_PAYMENTS",
          "BLOCKING",
          "Payments and the ledger disagree. Contact support before closing the day.",
          payments.map((row) => ({
            label: `Receipt ${row.receipt_number}`,
            detail: row.problem.replaceAll("_", " ").toLowerCase(),
            link: null,
          })),
        ),
  );

  const rooms = await findRoomStatusDiscrepancies(prisma, propertyId);
  results.push(
    rooms.length === 0
      ? check("VALIDATE_ROOM_STATUS", "PASSED", "Room status matches the in-house guests", [])
      : check(
          "VALIDATE_ROOM_STATUS",
          "WARNING",
          "Some rooms disagree with the in-house list. Review them on the room board.",
          rooms.map((row) => ({
            label: `Room ${row.room_number}`,
            detail:
              row.problem === "OCCUPIED_WITHOUT_STAY"
                ? "Occupied, but no guest is in house"
                : "A guest is in house, but the room is vacant",
            link: row.stay_id
              ? { kind: "stay" as const, id: row.stay_id }
              : { kind: "room" as const, id: row.room_id },
          })),
        ),
  );

  const unposted = await findUnpostedNights(prisma, propertyId, businessDate);
  const inHouse = unposted.filter((row) => row.status === "IN_HOUSE");
  const departed = unposted.filter((row) => row.status !== "IN_HOUSE");
  results.push(
    unposted.length === 0
      ? check("VALIDATE_POSTING", "PASSED", "Every earlier night carries its room charge", [])
      : check(
          "VALIDATE_POSTING",
          "WARNING",
          [
            inHouse.length > 0
              ? `${inHouse.length} in-house stay${inHouse.length === 1 ? " has" : "s have"} earlier nights without a room charge; the audit posts them now.`
              : null,
            departed.length > 0
              ? `${departed.length} departed stay${departed.length === 1 ? " has" : "s have"} nights without a room charge; post them from the folio.`
              : null,
          ]
            .filter(Boolean)
            .join(" "),
          unposted.map((row) => ({
            label: `${row.confirmation_number}-${row.line_number} · ${row.guest_name}`,
            detail: `${row.nights} night${row.nights === 1 ? "" : "s"} · ${row.status === "IN_HOUSE" ? "in house" : "checked out"}`,
            link: { kind: "folio" as const, id: row.reservation_room_id },
          })),
        ),
  );

  results.push(
    check(
      "VALIDATE_CASHIERS",
      "SKIPPED",
      "Cashier shifts are not enabled; payments are checked against the ledger instead.",
      [],
    ),
  );
  return results;
}

/** The pre-audit checklist for the current business date (read-only). */
export async function getReadiness(
  ctx: PropertyContext,
  now: Date = new Date(),
): Promise<ReadinessView> {
  const propertyLocalDate = localDateInZone(now, ctx.timezone);
  const current = await prisma.businessDate.findFirst({
    where: { propertyId: ctx.propertyId, isCurrent: true },
    select: { date: true, status: true },
  });
  const running = await findRunningRun(prisma, ctx.propertyId);
  const last = await findLastFinishedRun(prisma, ctx.propertyId);
  const names = await userDisplayNames(
    prisma,
    ctx.organizationId,
    [running?.startedById, last?.startedById].filter((id): id is string => Boolean(id)),
  );
  const canRun = hasPermission(ctx.access, ctx.propertyId, "nightaudit:run");
  if (!current) {
    return {
      businessDate: null,
      status: "NOT_INITIALIZED",
      propertyLocalDate,
      startProblem: "The property is not live yet",
      canStart: false,
      checks: [],
      running: null,
      lastRun: last ? runListItem(last, names) : null,
      actions: { run: false },
    };
  }
  const businessDate = toDateOnly(current.date);
  const status = current.status === "IN_AUDIT" ? "IN_AUDIT" : "OPEN";
  const checks = await runChecks(ctx.propertyId, businessDate);
  const startProblem =
    status === "IN_AUDIT"
      ? "Night audit is running"
      : (closeDateProblem(businessDate, propertyLocalDate) ??
        (isBlocking(checks) ? "Resolve the blocking checks first" : null));
  return {
    businessDate,
    status,
    propertyLocalDate,
    startProblem,
    canStart: startProblem === null,
    checks,
    running: running ? runListItem(running, names) : null,
    lastRun: last ? runListItem(last, names) : null,
    actions: { run: canRun },
  };
}

// --- The run -----------------------------------------------------------------------------------

interface StepRecord {
  code: StepCode;
  status: StepStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  result: Prisma.InputJsonValue | null;
  error: string | null;
}

function stepRows(runId: string, steps: StepRecord[]): Prisma.NightAuditStepCreateManyInput[] {
  const all: StepCode[] = [...CHECK_STEPS, ...COMMIT_STEPS];
  return all.map((code, index) => {
    const step = steps.find((s) => s.code === code);
    return {
      runId,
      sequence: index + 1,
      code,
      status: step?.status ?? "PENDING",
      startedAt: step?.startedAt ?? null,
      finishedAt: step?.finishedAt ?? null,
      result: step?.result ?? undefined,
      error: step?.error?.slice(0, 2000) ?? null,
    };
  });
}

/**
 * Starts and runs night audit for the property's current business date.
 * Returns the run: COMPLETED, or FAILED with the step and reason (nothing
 * posted, date OPEN). A retried request with the same Idempotency-Key
 * returns the same run.
 */
export async function startNightAudit(
  ctx: PropertyContext,
  input: StartNightAuditInput,
  idempotency: IdempotencyRequest | null,
  options: { now?: Date; hooks?: NightAuditHooks } = {},
): Promise<RunView> {
  const now = options.now ?? new Date();
  const requested = requireLive(ctx);

  // Phase A — lock the date and create the run.
  const started = await runInTransaction(async (tx) => {
    const current = await lockCurrentBusinessDateForUpdate(tx, ctx.propertyId);
    const { result, replayed } = await runIdempotent(tx, ctx.userId, idempotency, async () => {
      // No current row after the lock wait, or another date than the one the
      // request was made for: a concurrent audit has just closed it (D33).
      // Never close a date the user did not choose.
      if (!current || current.date !== requested) {
        throw new AppError(
          "CONFLICT",
          "Night audit has just closed this business date. Refresh to see the new date",
          { reason: "BUSINESS_DATE_CHANGED" },
        );
      }
      if (current.status !== "OPEN") {
        throw new AppError("CONFLICT", "Night audit is already running for this property", {
          reason: "NIGHT_AUDIT_RUNNING",
        });
      }
      const problem = closeDateProblem(current.date, localDateInZone(now, ctx.timezone));
      if (problem) {
        throw new AppError("BUSINESS_RULE_VIOLATION", problem, { reason: "DATE_AHEAD" });
      }
      const attempt = await nextAttempt(tx, ctx.propertyId, current.date);
      const run = await insertRun(tx, {
        propertyId: ctx.propertyId,
        businessDate: current.date,
        attempt,
        startedById: ctx.userId,
      });
      await setBusinessDateStatus(tx, current.id, "IN_AUDIT");
      await recordAudit(
        tx,
        { ...auditActor(ctx), businessDate: current.date },
        {
          action: "nightaudit.start",
          resourceType: "NightAuditRun",
          resourceId: run.id,
          risk: "HIGH",
          before: { businessDateStatus: "OPEN" },
          after: { businessDate: current.date, attempt, businessDateStatus: "IN_AUDIT" },
          reason: input.reason,
          reasonCodeId: input.reasonCodeId ?? null,
          permission: "nightaudit:run",
        },
      );
      return { runId: run.id, businessDate: current.date };
    });
    return { ...result, replayed };
  });
  if (started.replayed) return getRun(ctx, started.runId);

  const { runId, businessDate } = started;
  const steps: StepRecord[] = [];

  // Phase B — read-only checks.
  let checks: CheckResult[];
  try {
    checks = await runChecks(ctx.propertyId, businessDate);
  } catch (error) {
    await failRun(ctx, runId, businessDate, steps, error, input.reason);
    return getRun(ctx, runId);
  }
  for (const result of checks) {
    steps.push({
      code: result.code,
      status: stepStatusOf(result.outcome),
      startedAt: now,
      finishedAt: new Date(),
      result: {
        outcome: result.outcome,
        message: result.message,
        count: result.count,
        items: result.items,
      } as unknown as Prisma.InputJsonValue,
      error: result.outcome === "BLOCKING" ? result.message : null,
    });
  }
  if (isBlocking(checks)) {
    const blocking = checks.filter((c) => c.outcome === "BLOCKING");
    await failRun(
      ctx,
      runId,
      businessDate,
      steps,
      new AppError(
        "BUSINESS_RULE_VIOLATION",
        `Blocking checks: ${blocking.map((c) => c.label).join(", ")}`,
        { reason: "PRE_CHECK_FAILED" },
      ),
      input.reason,
    );
    return getRun(ctx, runId);
  }

  // Phase C — one transaction.
  try {
    await runInTransaction(
      (tx) => commitNightAudit(tx, ctx, runId, businessDate, steps, input.reason, options.hooks),
      { timeoutMs: COMMIT_TIMEOUT_MS, retry: false },
    );
  } catch (error) {
    await failRun(ctx, runId, businessDate, steps, error, input.reason);
  }
  return getRun(ctx, runId);
}

/** Phase C: everything that closes the day, in one transaction. */
async function commitNightAudit(
  tx: Tx,
  ctx: PropertyContext,
  runId: string,
  businessDate: string,
  steps: StepRecord[],
  reason: string,
  hooks: NightAuditHooks | undefined,
): Promise<void> {
  const current = await lockCurrentBusinessDateForUpdate(tx, ctx.propertyId);
  if (!current || current.status !== "IN_AUDIT" || current.date !== businessDate) {
    throw new AppError("CONFLICT", "The business date is no longer in audit", {
      reason: "NOT_IN_AUDIT",
    });
  }
  const run = await lockRun(tx, ctx.propertyId, runId);
  if (!run || run.status !== "RUNNING") {
    throw new AppError("CONFLICT", "This night audit run was recovered or finished", {
      reason: "RUN_NOT_RUNNING",
    });
  }
  const nextDate = addDays(businessDate, 1);
  const actor = systemActor(ctx);
  const config = await findAuditConfiguration(tx, ctx.propertyId);
  const summary: NightAuditSummary = {
    businessDate,
    nextBusinessDate: nextDate,
    roomsPosted: 0,
    nightsPosted: 0,
    linesPosted: 0,
    chargesPosted: "0.0000",
    taxesPosted: "0.0000",
    noShows: 0,
    noShowFees: 0,
    noShowFeeTotal: "0.0000",
    blocksReleased: 0,
    blocksActivated: 0,
    groupCutoffs: 0,
    roomsRolledToDirty: 0,
    tasksCancelled: 0,
    tasksCreated: 0,
    inventoryRepairs: 0,
  };

  const step = async (code: CommitStep, work: () => Promise<Prisma.InputJsonValue>) => {
    const record: StepRecord = {
      code,
      status: "RUNNING",
      startedAt: new Date(),
      finishedAt: null,
      result: null,
      error: null,
    };
    steps.push(record);
    await hooks?.beforeStep?.(code);
    record.result = await work();
    record.status = "SUCCEEDED";
    record.finishedAt = new Date();
  };

  await step("POST_ROOM_AND_TAX", async () => {
    let charges = 0n;
    let taxes = 0n;
    for (const id of await findInHouseReservationRoomIds(tx, ctx.propertyId)) {
      const room = await lockReservationRoomById(tx, ctx, id);
      const posted = await postNightsInTx(tx, ctx, businessDate, room, businessDate, {
        source: "NIGHT_AUDIT",
        actor,
        permission: "nightaudit:run",
      });
      if (posted.postedNights.length === 0) continue;
      summary.roomsPosted += 1;
      summary.nightsPosted += posted.postedNights.length;
      summary.linesPosted += posted.itemIds.length;
      charges += posted.total;
      taxes += posted.taxes;
    }
    summary.chargesPosted = formatMoney(charges);
    summary.taxesPosted = formatMoney(taxes);
    return {
      rooms: summary.roomsPosted,
      nights: summary.nightsPosted,
      lines: summary.linesPosted,
      total: summary.chargesPosted,
      taxes: summary.taxesPosted,
    };
  });

  await step("PROCESS_NO_SHOWS", async () => {
    const candidates = await findNoShowCandidateIds(tx, ctx.propertyId, businessDate);
    if (candidates.length === 0 || !config.autoNoShowOnNightAudit) {
      return { noShows: 0, fees: 0, feeTotal: "0.0000" };
    }
    const reasonCode = await findNoShowReasonCode(tx, ctx.propertyId, config.noShowReasonCodeId);
    if (!reasonCode) {
      throw new AppError("BUSINESS_RULE_VIOLATION", "No active no-show reason code", {
        reason: "NO_SHOW_REASON_MISSING",
      });
    }
    let feeTotal = 0n;
    const rooms: string[] = [];
    for (const id of candidates) {
      const room = await lockReservationRoomById(tx, ctx, id);
      await releaseReservationInTx(
        tx,
        ctx,
        businessDate,
        room,
        "no_show",
        { reason: SYSTEM_REASON, reasonCode, permission: "nightaudit:run" },
        actor,
      );
      summary.noShows += 1;
      rooms.push(`${room.reservation.confirmationNumber}-${room.lineNumber}`);
      const chargeable =
        config.postNoShowCharges &&
        config.noShowTransactionCodeId !== null &&
        room.reservationType.deductsInventory &&
        room.reservationType.isGuaranteed &&
        room.reservationType.postNoShowCharge;
      if (!chargeable) continue;
      const fee = await postNoShowFeeInTx(
        tx,
        ctx,
        businessDate,
        room,
        config.noShowTransactionCodeId!,
        actor,
      );
      if (fee) {
        summary.noShowFees += 1;
        feeTotal += fee.total;
      }
    }
    summary.noShowFeeTotal = formatMoney(feeTotal);
    return {
      noShows: summary.noShows,
      fees: summary.noShowFees,
      feeTotal: summary.noShowFeeTotal,
      rooms,
    };
  });

  // Room counts for night D, before the block roll (a block ending tonight
  // still held its room for night D).
  const roomCounts = await countRoomsForNight(tx, ctx.propertyId, businessDate);
  const roomTypeCounts = await countRoomTypesForNight(tx, ctx.propertyId, businessDate);

  await step("RELEASE", async () => {
    const blocks = await rollServiceBlocksInTx(
      tx,
      { propertyId: ctx.propertyId, userId: ctx.userId },
      businessDate,
      nextDate,
    );
    const cutoffs = await applyCutoffsInTx(tx, ctx, businessDate, nextDate, actor);
    summary.blocksReleased = blocks.released.length;
    summary.blocksActivated = blocks.activated.length;
    summary.groupCutoffs = cutoffs.length;
    return { ...blocks, groupCutoffs: cutoffs } as unknown as Prisma.InputJsonValue;
  });

  await step("ROOM_STATUS_ROLL", async () => {
    const rolled = await rollOccupiedRoomsInTx(
      tx,
      { propertyId: ctx.propertyId, userId: ctx.userId },
      businessDate,
    );
    const tasks = await rollTasksInTx(tx, ctx, businessDate, nextDate);
    summary.roomsRolledToDirty = rolled.length;
    summary.tasksCancelled = tasks.cancelled;
    summary.tasksCreated = tasks.cleaning + tasks.stayovers;
    return { roomsToDirty: rolled, ...tasks };
  });

  await step("RECONCILE_INVENTORY", async () => {
    const repairs = await reconcileInventoryInTx(tx, ctx.propertyId, businessDate);
    summary.inventoryRepairs = repairs.length;
    return {
      repairs: repairs.slice(0, CHECK_ITEM_LIMIT),
      count: repairs.length,
    } as unknown as Prisma.InputJsonValue;
  });

  await step("STATISTICS", async () => {
    const money = await sumMoneyForDate(
      tx,
      ctx.propertyId,
      businessDate,
      config.noShowTransactionCodeId,
    );
    const date = new Date(`${businessDate}T00:00:00.000Z`);
    await tx.dailyStatistic.create({
      data: {
        propertyId: ctx.propertyId,
        businessDate: date,
        physicalRooms: roomCounts.physical_rooms,
        outOfOrderRooms: roomCounts.out_of_order_rooms,
        outOfServiceRooms: roomCounts.out_of_service_rooms,
        roomsSold: roomCounts.rooms_sold,
        complimentaryRooms: roomCounts.complimentary_rooms,
        houseUseRooms: roomCounts.house_use_rooms,
        dayUseRooms: roomCounts.day_use_rooms,
        arrivals: roomCounts.arrivals,
        departures: roomCounts.departures,
        stayovers: roomCounts.stayovers,
        noShows: roomCounts.no_shows,
        cancellations: roomCounts.cancellations,
        walkIns: roomCounts.walk_ins,
        adults: roomCounts.adults,
        children: roomCounts.children,
        currencyCode: ctx.currencyCode,
        roomRevenue: money.room_revenue,
        packageRevenue: money.package_revenue,
        otherRevenue: money.other_revenue,
        taxTotal: money.tax_total,
        noShowRevenue: money.no_show_revenue,
        paymentsTotal: money.payments_total,
        voidsTotal: money.voids_total,
        refundsTotal: money.refunds_total,
        adjustmentsTotal: money.adjustments_total,
        ledgerOpening: money.ledger_opening,
        ledgerClosing: money.ledger_closing,
      },
    });
    const revenueByType = new Map(
      (
        await sumRoomRevenueByType(tx, ctx.propertyId, businessDate, config.noShowTransactionCodeId)
      ).map((row) => [row.room_type_id, row.room_revenue]),
    );
    if (roomTypeCounts.length > 0) {
      await tx.dailyRoomTypeStatistic.createMany({
        data: roomTypeCounts.map((row) => ({
          propertyId: ctx.propertyId,
          businessDate: date,
          roomTypeId: row.room_type_id,
          physicalRooms: row.physical_rooms,
          outOfOrderRooms: row.out_of_order_rooms,
          roomsSold: row.rooms_sold,
          arrivals: row.arrivals,
          departures: row.departures,
          roomRevenue: revenueByType.get(row.room_type_id) ?? "0",
        })),
      });
    }
    // The roll-forward must hold: closing = opening + the day's ledger lines.
    const opening = parseMoney(money.ledger_opening);
    const closing = parseMoney(money.ledger_closing);
    return {
      roomsSold: roomCounts.rooms_sold,
      physicalRooms: roomCounts.physical_rooms,
      roomRevenue: money.room_revenue,
      taxTotal: money.tax_total,
      paymentsTotal: money.payments_total,
      ledgerOpening: money.ledger_opening,
      ledgerClosing: money.ledger_closing,
      ledgerMovement: formatMoney(closing - opening),
    };
  });

  await step("CLOSE_DATE", async () => {
    await rollBusinessDate(tx, {
      propertyId: ctx.propertyId,
      currentId: current.id,
      nextDate,
      userId: ctx.userId,
    });
    return { closed: businessDate, opened: nextDate };
  });

  await insertSteps(tx, stepRows(runId, steps));
  await finishRun(tx, runId, {
    status: "COMPLETED",
    summary: summary as unknown as Prisma.InputJsonValue,
  });
  await recordAudit(
    tx,
    { ...auditActor(ctx), businessDate },
    {
      action: "nightaudit.run",
      resourceType: "NightAuditRun",
      resourceId: runId,
      risk: "HIGH",
      after: { outcome: "COMPLETED", ...summary },
      reason,
      permission: "nightaudit:run",
    },
  );
  await recordAudit(
    tx,
    { ...auditActor(ctx), businessDate },
    {
      action: "business_date.close",
      resourceType: "BusinessDate",
      resourceId: current.id,
      risk: "HIGH",
      before: { date: businessDate, status: "IN_AUDIT" },
      after: { date: businessDate, status: "CLOSED", nextBusinessDate: nextDate },
      reason,
      permission: "nightaudit:run",
    },
  );
  await recordEvent(
    tx,
    { organizationId: ctx.organizationId, propertyId: ctx.propertyId },
    "business_date.rolled",
    {
      nightAuditRunId: runId,
      closedDate: businessDate,
      openedDate: nextDate,
    },
  );
}

/**
 * Records a failed run in its own transaction: steps as far as they got
 * (Phase C steps that finished before the error were rolled back with it),
 * the run FAILED, the business date OPEN again, a HIGH audit row.
 */
async function failRun(
  ctx: PropertyContext,
  runId: string,
  businessDate: string,
  steps: StepRecord[],
  error: unknown,
  reason: string,
): Promise<void> {
  const code =
    error instanceof AppError
      ? String((error.details as { reason?: string } | undefined)?.reason ?? error.code)
      : (databaseErrorCode(error) ?? "INTERNAL_ERROR");
  const message =
    error instanceof AppError ? error.message : "The audit failed unexpectedly; nothing was posted";
  if (!(error instanceof AppError)) logServerError("Night audit failed", error);
  for (const step of steps) {
    if (step.status === "RUNNING") {
      step.status = "FAILED";
      step.finishedAt = new Date();
      step.error = message;
    } else if (COMMIT_STEPS.includes(step.code as CommitStep) && step.status === "SUCCEEDED") {
      step.result = { rolledBack: true, result: step.result } as Prisma.InputJsonValue;
    }
  }
  await runInTransaction(async (tx) => {
    const current = await lockCurrentBusinessDateForUpdate(tx, ctx.propertyId);
    const run = await lockRun(tx, ctx.propertyId, runId);
    if (!run || run.status !== "RUNNING") return;
    await insertSteps(tx, stepRows(runId, steps));
    await finishRun(tx, runId, {
      status: "FAILED",
      errorCode: code.slice(0, 60),
      errorMessage: message,
    });
    if (current && current.status === "IN_AUDIT" && current.date === businessDate) {
      await setBusinessDateStatus(tx, current.id, "OPEN");
    }
    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: "nightaudit.run",
        resourceType: "NightAuditRun",
        resourceId: runId,
        risk: "HIGH",
        after: { outcome: "FAILED", errorCode: code, errorMessage: message },
        reason,
        permission: "nightaudit:run",
      },
    );
  });
}

/**
 * Recovers a run left RUNNING by a crash between the phases: the run is
 * marked FAILED and the date reopened. The business date is taken with
 * NOWAIT, so a commit in progress (which holds it) is never interrupted,
 * and the run must be older than the stale threshold.
 */
export async function recoverRun(
  ctx: PropertyContext,
  runId: string,
  input: RecoverNightAuditInput,
  now: Date = new Date(),
): Promise<RunView> {
  await runInTransaction(
    async (tx) => {
      let current;
      try {
        current = await lockCurrentBusinessDateNoWait(tx, ctx.propertyId);
      } catch (error) {
        if (databaseErrorCode(error) === "55P03") {
          throw new AppError(
            "CONFLICT",
            "The audit is committing right now; wait for it to finish",
            {
              reason: "NIGHT_AUDIT_COMMITTING",
            },
          );
        }
        throw error;
      }
      const run = await lockRun(tx, ctx.propertyId, runId);
      if (!run) throw notFound("Night audit run");
      if (run.status !== "RUNNING") {
        throw new AppError("CONFLICT", "This run has already finished", {
          reason: "RUN_NOT_RUNNING",
        });
      }
      if (!isStaleRun(run.started_at, now)) {
        throw new AppError(
          "CONFLICT",
          "This run started moments ago and may still be working; try again in a few minutes",
          { reason: "RUN_NOT_STALE" },
        );
      }
      await insertSteps(tx, stepRows(runId, []));
      await finishRun(tx, runId, {
        status: "FAILED",
        errorCode: "RECOVERED",
        errorMessage: "Recovered after an interruption; nothing was posted",
      });
      if (current && current.status === "IN_AUDIT" && current.date === run.business_date) {
        await setBusinessDateStatus(tx, current.id, "OPEN");
      }
      await recordAudit(
        tx,
        { ...auditActor(ctx), businessDate: run.business_date },
        {
          action: "nightaudit.recover",
          resourceType: "NightAuditRun",
          resourceId: runId,
          risk: "HIGH",
          before: { status: "RUNNING", businessDateStatus: current?.status ?? null },
          after: { status: "FAILED", businessDateStatus: "OPEN" },
          reason: input.reason,
          reasonCodeId: input.reasonCodeId ?? null,
          permission: "nightaudit:run",
        },
      );
    },
    { retry: false },
  );
  return getRun(ctx, runId, now);
}

// --- Reads -------------------------------------------------------------------------------------

type RunRow = NonNullable<Awaited<ReturnType<typeof findRunningRun>>>;

function runListItem(row: RunRow, names: Map<string, string>): RunListItem {
  return {
    id: row.id,
    businessDate: toDateOnly(row.businessDate),
    attempt: row.attempt,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    startedBy: { id: row.startedById, name: names.get(row.startedById) ?? "Unknown user" },
    errorCode: row.errorCode,
  };
}

export async function getRun(
  ctx: PropertyContext,
  runId: string,
  now: Date = new Date(),
): Promise<RunView> {
  const row = await findRun(prisma, ctx.propertyId, runId);
  if (!row) throw notFound("Night audit run");
  const names = await userDisplayNames(prisma, ctx.organizationId, [row.startedById]);
  const steps: RunStepView[] = row.steps.map((s) => ({
    sequence: s.sequence,
    code: s.code as StepCode,
    label: STEP_LABELS[s.code as StepCode] ?? s.code,
    status: s.status,
    startedAt: s.startedAt?.toISOString() ?? null,
    finishedAt: s.finishedAt?.toISOString() ?? null,
    result: s.result,
    error: s.error,
  }));
  return {
    ...runListItem(row, names),
    errorMessage: row.errorMessage,
    summary: (row.summary as NightAuditSummary | null) ?? null,
    steps,
    actions: {
      recover:
        row.status === "RUNNING" &&
        isStaleRun(row.startedAt, now) &&
        hasPermission(ctx.access, ctx.propertyId, "nightaudit:run"),
    },
  };
}

export async function listRuns(
  ctx: PropertyContext,
  query: NightAuditRunsQuery,
): Promise<{ items: RunListItem[]; meta: CursorPageMeta }> {
  let cursor: { c: string; i: string } | null = null;
  if (query.cursor) {
    cursor = decodeCursor(query.cursor, ["c", "i"]) as { c: string; i: string } | null;
    if (!cursor) {
      throw new AppError("VALIDATION_FAILED", "Invalid cursor", {
        fields: { cursor: ["Invalid cursor"] },
      });
    }
  }
  const rows = await findRunsPage(prisma, ctx.propertyId, query.limit + 1, cursor);
  const page = rows.slice(0, query.limit);
  const names = await userDisplayNames(prisma, ctx.organizationId, [
    ...new Set(page.map((row) => row.startedById)),
  ]);
  const last = page.at(-1);
  return {
    items: page.map((row) => runListItem(row, names)),
    meta: {
      limit: query.limit,
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ c: last.startedAt.toISOString(), i: last.id })
          : null,
    },
  };
}
