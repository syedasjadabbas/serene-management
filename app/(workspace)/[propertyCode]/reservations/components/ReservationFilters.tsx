"use client";

import { type FormEvent, useState } from "react";
import { BOOKING_STATE_LABELS } from "@/components/reservations/BookingStateBadge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";

export interface ReservationFilterValues {
  q?: string;
  state?: string;
  arrivalFrom?: string;
  arrivalTo?: string;
  createdFrom?: string;
  createdTo?: string;
  sort?: string;
}

const STATE_OPTIONS = [
  { value: "WAITLISTED,TENTATIVE,CONFIRMED", label: "Active (not cancelled)" },
  ...Object.entries(BOOKING_STATE_LABELS).map(([value, label]) => ({ value, label })),
];

const SORT_OPTIONS = [
  { value: "arrival", label: "Arrival (earliest first)" },
  { value: "-arrival", label: "Arrival (latest first)" },
  { value: "-created", label: "Recently created" },
];

export function ReservationFilters({
  initial,
  onApply,
}: {
  initial: ReservationFilterValues;
  onApply: (values: ReservationFilterValues) => void;
}) {
  const [values, setValues] = useState<ReservationFilterValues>(initial);
  const set = (key: keyof ReservationFilterValues) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value || undefined }));

  function submit(event: FormEvent) {
    event.preventDefault();
    onApply({ ...values, q: values.q?.trim() || undefined });
  }

  return (
    <form
      onSubmit={submit}
      role="search"
      className="grid grid-cols-2 items-end gap-3 rounded-lg border border-border-subtle bg-surface p-3 md:grid-cols-4 xl:grid-cols-[2fr_repeat(6,minmax(0,1fr))_auto]"
    >
      <TextField
        label="Search"
        placeholder="Confirmation, guest, room"
        value={values.q ?? ""}
        onChange={set("q")}
        className="col-span-2 md:col-span-1"
        hint="At least 2 characters"
      />
      <Select
        label="State"
        placeholder="All"
        options={STATE_OPTIONS}
        value={values.state ?? ""}
        onChange={set("state")}
      />
      <TextField
        label="Arrival from"
        type="date"
        value={values.arrivalFrom ?? ""}
        onChange={set("arrivalFrom")}
      />
      <TextField
        label="Arrival to"
        type="date"
        value={values.arrivalTo ?? ""}
        onChange={set("arrivalTo")}
      />
      <TextField
        label="Created from"
        type="date"
        value={values.createdFrom ?? ""}
        onChange={set("createdFrom")}
      />
      <TextField
        label="Created to"
        type="date"
        value={values.createdTo ?? ""}
        onChange={set("createdTo")}
      />
      <Select
        label="Sort"
        options={SORT_OPTIONS}
        value={values.sort ?? "arrival"}
        onChange={set("sort")}
      />
      <div className="flex gap-2">
        <Button type="submit">Search</Button>
        <Button
          variant="ghost"
          onClick={() => {
            setValues({});
            onApply({});
          }}
        >
          Clear
        </Button>
      </div>
    </form>
  );
}
