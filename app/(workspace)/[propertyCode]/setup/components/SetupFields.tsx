"use client";

import type { ReactNode } from "react";
import { TextArea } from "@/components/ui/TextArea";

/** The justification every setup change carries into the audit trail (settings:manage is high-risk). */
export function ReasonField({
  value,
  onChange,
  errors,
}: {
  value: string;
  onChange: (value: string) => void;
  errors?: string[];
}) {
  return (
    <TextArea
      label="Reason for the change (required)"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={1000}
      rows={2}
      errors={errors}
    />
  );
}

export function CheckboxField({
  checked,
  onChange,
  children,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-h-11 items-start gap-2.5 py-1 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="font-medium text-fg">{children}</span>
        {hint ? <span className="mt-0.5 block text-xs text-fg-secondary">{hint}</span> : null}
      </span>
    </label>
  );
}

export const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "In use" },
  { value: "INACTIVE", label: "Retired" },
];

/** "101-110, 115, 201-203" → ["101", …, "110", "115", "201", "202", "203"] (numeric ranges keep the width). */
export function parseRoomNumbers(text: string): { numbers: string[]; error: string | null } {
  const numbers: string[] = [];
  for (const raw of text.split(/[\s,;]+/).filter(Boolean)) {
    const range = /^(\d{1,6})-(\d{1,6})$/.exec(raw);
    if (range) {
      const [from, to] = [Number(range[1]), Number(range[2])];
      if (to < from)
        return { numbers: [], error: `${raw} counts down; write the lower number first` };
      if (to - from > 199) return { numbers: [], error: "At most 200 rooms at a time" };
      const width = range[1]!.length;
      for (let n = from; n <= to; n++) numbers.push(String(n).padStart(width, "0"));
    } else if (/^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/.test(raw)) {
      numbers.push(raw.toUpperCase());
    } else {
      return { numbers: [], error: `“${raw}” is not a room number` };
    }
  }
  if (numbers.length > 200) return { numbers: [], error: "At most 200 rooms at a time" };
  const duplicates = numbers.filter((n, i) => numbers.indexOf(n) !== i);
  if (duplicates.length > 0) return { numbers: [], error: `Room ${duplicates[0]} is listed twice` };
  return { numbers, error: null };
}
