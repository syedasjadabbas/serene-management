"use client";

import { useBusinessDateQuery } from "@/lib/api/endpoints/properties.api";
import { useProperty } from "./useProperty";

/**
 * The hotel business date of the current property, from the server. Never
 * derive it from the browser clock. Refreshed every minute so the local
 * time and "awaiting audit" state stay current.
 */
export function useBusinessDate() {
  const property = useProperty();
  // Paused while the tab is hidden or unfocused, refreshed on return (B10).
  return useBusinessDateQuery(property.id, {
    pollingInterval: 60_000,
    skipPollingIfUnfocused: true,
    refetchOnFocus: true,
  });
}
