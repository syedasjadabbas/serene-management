"use client";

import { type Control, type FieldValues, useController } from "react-hook-form";
import { usePermissions } from "@/global/hooks/usePermissions";
import { useProperty } from "@/global/hooks/useProperty";

/**
 * Overbooking past house availability is a separate, audited permission; the
 * checkbox (form field `override`) is only offered to users who hold it (the
 * server checks again).
 */
export function OverrideField<T extends FieldValues>({
  control,
  label,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<T, any, any>;
  label: string;
}) {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const {
    field: { ref, value, onChange },
  } = useController({ control, name: "override" as never });
  if (!can("reservations:override_availability")) return null;
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm">
      <input
        type="checkbox"
        ref={ref}
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
