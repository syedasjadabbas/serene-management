import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";

export function insertOutboxEvent(tx: Tx, data: Prisma.OutboxEventUncheckedCreateInput) {
  return tx.outboxEvent.create({ data, select: { id: true } });
}
