"use client";

import { useState } from "react";
import { type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { FormSelect, FormTextArea } from "@/global/components/ui/form";
import { useBillingOptionsQuery } from "@/global/api/endpoints/billingApi";
import { useProperty } from "@/global/hooks/useProperty";
import { randomId } from "@serene/shared/lib/utils/random-id";

/** One Idempotency-Key per dialog: a double press or a retry replays the first result. */
export function useIdempotencyKey() {
  const [key] = useState(randomId);
  return key;
}

export function Summary({ rows }: { rows: [string, string, boolean?][] }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-md bg-surface-sunken px-3 py-2 text-sm">
      {rows.map(([term, value, strong]) => (
        <div key={term} className="contents">
          <dt className={strong ? "font-semibold" : "text-fg-secondary"}>{term}</dt>
          <dd className={`text-right tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Reason code select + free-text reason, bound to `reasonCodeId` / `reason` of the form. */
export function ReasonFields<T extends FieldValues>({
  control,
  categories,
  requireCode,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<T, any, any>;
  categories: string[];
  requireCode: boolean;
}) {
  const property = useProperty();
  const options = useBillingOptionsQuery(property.id);
  return (
    <>
      <FormSelect
        control={control}
        name={"reasonCodeId" as FieldPath<T>}
        label={requireCode ? "Reason code" : "Reason code (optional)"}
        placeholder="Select"
        options={(options.data?.reasonCodes ?? [])
          .filter((r) => categories.includes(r.category))
          .map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }))}
      />
      <FormTextArea
        control={control}
        name={"reason" as FieldPath<T>}
        label="Reason (recorded in the audit trail)"
        maxLength={1000}
      />
    </>
  );
}
