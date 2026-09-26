/**
 * Integration event catalog (D35, D40). Events describe committed facts of
 * the PMS for future integrations (channel managers, accounting, messaging),
 * independent of any provider. Payloads carry identifiers and the names of
 * changed fields only — never guest data, amounts, card data or free text —
 * so an event is safe to hand to any consumer, which reads current state
 * through the API.
 */
export const INTEGRATION_EVENT_TYPES = [
  "reservation.created",
  "reservation.modified",
  "reservation.cancelled",
  "stay.checked_in",
  "stay.checked_out",
  "payment.posted",
  "payment.voided",
  "payment.refunded",
  "business_date.rolled",
] as const;

export type IntegrationEventType = (typeof INTEGRATION_EVENT_TYPES)[number];

interface EventShapes {
  "reservation.created": { reservationId: string; reservationRoomIds: string[] };
  "reservation.modified": {
    reservationId: string;
    reservationRoomId: string;
    changedFields: string[];
  };
  "reservation.cancelled": { reservationId: string; reservationRoomId: string };
  "stay.checked_in": { stayId: string; reservationId: string; reservationRoomId: string };
  "stay.checked_out": { stayId: string; reservationId: string; reservationRoomId: string };
  "payment.posted": { paymentId: string; folioId: string };
  "payment.voided": { paymentId: string; folioId: string };
  "payment.refunded": { paymentId: string; refundId: string; folioId: string };
  /** Business dates are "YYYY-MM-DD" in the property's calendar. */
  "business_date.rolled": { nightAuditRunId: string; closedDate: string; openedDate: string };
}

export type IntegrationEventPayload<T extends IntegrationEventType> = EventShapes[T];

/** Aggregate each event belongs to (outbox `aggregate_type` / `aggregate_id`). */
export const EVENT_AGGREGATES: {
  [T in IntegrationEventType]: { type: string; id: (payload: EventShapes[T]) => string };
} = {
  "reservation.created": { type: "Reservation", id: (p) => p.reservationId },
  "reservation.modified": { type: "Reservation", id: (p) => p.reservationId },
  "reservation.cancelled": { type: "Reservation", id: (p) => p.reservationId },
  "stay.checked_in": { type: "Stay", id: (p) => p.stayId },
  "stay.checked_out": { type: "Stay", id: (p) => p.stayId },
  "payment.posted": { type: "Payment", id: (p) => p.paymentId },
  "payment.voided": { type: "Payment", id: (p) => p.paymentId },
  "payment.refunded": { type: "Payment", id: (p) => p.paymentId },
  "business_date.rolled": { type: "BusinessDate", id: (p) => p.nightAuditRunId },
};

/**
 * What a future publisher receives (D40). Delivery is at-least-once, so
 * consumers deduplicate by `id`. No publisher runs in this release (D6):
 * events stay PENDING in the outbox until a dispatcher is introduced.
 */
export interface IntegrationEventEnvelope<T extends IntegrationEventType = IntegrationEventType> {
  id: string;
  type: T;
  organizationId: string;
  propertyId: string | null;
  occurredAt: string;
  payload: EventShapes[T];
}

/** Contract for provider adapters (not implemented yet: D1 foundation only). */
export interface IntegrationPublisher {
  readonly name: string;
  publish(event: IntegrationEventEnvelope): Promise<void>;
}
