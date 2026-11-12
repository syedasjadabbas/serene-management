import type { BusinessDateSyncState } from "./business-date.policy";

export interface BusinessDateView {
  propertyId: string;
  timezone: string;
  /** Null until the property goes live (first business date initialized). */
  businessDate: string | null;
  status: "OPEN" | "IN_AUDIT" | "NOT_INITIALIZED";
  /** Property calendar date and time right now, in the property's time zone. */
  propertyLocalDate: string;
  propertyLocalTime: string;
  sync: { state: BusinessDateSyncState; lagDays: number } | null;
}
