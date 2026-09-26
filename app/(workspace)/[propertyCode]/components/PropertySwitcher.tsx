"use client";

import { WorkspaceSwitcher } from "@/components/workspace/WorkspaceSwitcher";
import { useProperty } from "@/hooks/useProperty";

/** The workspace switcher, anchored on the active property. */
export function PropertySwitcher() {
  const property = useProperty();
  return <WorkspaceSwitcher current={property} />;
}
