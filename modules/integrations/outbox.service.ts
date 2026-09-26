import "server-only";
import type { Tx } from "@/lib/db/prisma";
import {
  EVENT_AGGREGATES,
  type IntegrationEventPayload,
  type IntegrationEventType,
} from "./events";
import { insertOutboxEvent } from "./outbox.repository";

/**
 * Transactional outbox writer (D35). Called inside the command's own
 * transaction, so the event exists exactly when the change commits and
 * disappears with a rollback. It only writes: nothing is published in this
 * release (D6), rows stay PENDING for a future dispatcher.
 */
export async function recordEvent<T extends IntegrationEventType>(
  tx: Tx,
  scope: { organizationId: string; propertyId: string | null },
  type: T,
  payload: IntegrationEventPayload<T>,
): Promise<void> {
  const aggregate = EVENT_AGGREGATES[type];
  await insertOutboxEvent(tx, {
    propertyId: scope.propertyId,
    aggregateType: aggregate.type,
    aggregateId: aggregate.id(payload),
    eventType: type,
    payload: {
      version: 1,
      organizationId: scope.organizationId,
      propertyId: scope.propertyId,
      ...payload,
    },
  });
}
