"use client";

import { createContext, type ReactNode, useContext } from "react";

/**
 * The property of the current URL (/[propertyCode]/…), resolved and
 * authorized by the server layout. Read-only context, not a store: switching
 * property is navigation.
 */
export interface CurrentProperty {
  id: string;
  code: string;
  name: string;
  timezone: string;
  currencyCode: string;
}

const PropertyContext = createContext<CurrentProperty | null>(null);

export function PropertyProvider({
  property,
  children,
}: {
  property: CurrentProperty;
  children: ReactNode;
}) {
  return <PropertyContext.Provider value={property}>{children}</PropertyContext.Provider>;
}

export function useProperty(): CurrentProperty {
  const property = useContext(PropertyContext);
  if (!property) throw new Error("useProperty must be used inside a property workspace");
  return property;
}
