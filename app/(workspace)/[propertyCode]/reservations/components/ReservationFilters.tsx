"use client";

import { useState } from "react";
import { BOOKING_STATE_LABELS } from "@/components/reservations/BookingStateBadge";
import { FilterBar } from "@/components/ui/FilterBar";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { useBookingOptionsQuery } from "@/lib/api/endpoints/reservations.api";

export interface ReservationFilterValues {
  q?: string;
  state?: string;
  arrivalFrom?: string;
  arrivalTo?: string;
  departureFrom?: string;
  departureTo?: string;
  createdFrom?: string;
  createdTo?: string;
  roomTypeId?: string;
  sourceCodeId?: string;
  sort?: string;
}

/** Every key the reservation search accepts from the URL (API: GET /reservations). */
export const RESERVATION_FILTER_KEYS = [
  "q",
  "state",
  "arrivalFrom",
  "arrivalTo",
  "departureFrom",
  "departureTo",
  "createdFrom",
  "createdTo",
  "roomTypeId",
  "sourceCodeId",
  "sort",
] as const satisfies readonly (keyof ReservationFilterValues)[];

const ADVANCED_KEYS = [
  "arrivalFrom",
  "arrivalTo",
  "departureFrom",
  "departureTo",
  "createdFrom",
  "createdTo",
  "roomTypeId",
  "sourceCodeId",
] as const;

const ACTIVE = "WAITLISTED,TENTATIVE,CONFIRMED";
const STATE_OPTIONS = [
  { value: "", label: "All" },
  { value: ACTIVE, label: "Active" },
  ...(
    [
      "CONFIRMED",
      "TENTATIVE",
      "IN_HOUSE",
      "CHECKED_OUT",
      "CANCELLED",
      "NO_SHOW",
      "WAITLISTED",
    ] as const
  ).map((value) => ({ value, label: BOOKING_STATE_LABELS[value] })),
];

const SORT_OPTIONS = [
  { value: "arrival", label: "Arrival (earliest first)" },
  { value: "-arrival", label: "Arrival (latest first)" },
  { value: "-created", label: "Recently created" },
];

/**
 * Reservation search: free text (confirmation, guest, room), state as a
 * segmented control that applies at once, and dates, room type, source and
 * sort in the advanced panel. Values live in the URL (see ReservationSearch).
 */
export function ReservationFilters({
  propertyId,
  initial,
  onApply,
}: {
  propertyId: string;
  initial: ReservationFilterValues;
  onApply: (values: ReservationFilterValues) => void;
}) {
  const options = useBookingOptionsQuery(propertyId);
  const [values, setValues] = useState<ReservationFilterValues>(initial);
  const [tooShort, setTooShort] = useState(false);
  const set = (key: keyof ReservationFilterValues) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value || undefined }));

  function apply(next: ReservationFilterValues) {
    const q = next.q?.trim() || undefined;
    // The server needs at least two characters; say so instead of failing.
    if (q && q.length < 2) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    onApply({ ...next, q });
  }

  const advancedCount =
    ADVANCED_KEYS.filter((key) => initial[key]).length +
    (initial.sort && initial.sort !== "arrival" ? 1 : 0);
  const anyApplied = Object.values(initial).some(Boolean);
  const roomTypes = options.data?.roomTypes ?? [];
  const sources = options.data?.sourceCodes ?? [];

  return (
    <FilterBar
      label="Search reservations"
      onSubmit={() => apply(values)}
      onClear={
        anyApplied
          ? () => {
              setValues({});
              setTooShort(false);
              onApply({});
            }
          : undefined
      }
      search={
        <SearchInput
          label="Search reservations"
          hideLabel
          placeholder="Confirmation number, guest name or room"
          value={values.q ?? ""}
          onChange={set("q")}
          hint={tooShort ? "Type at least 2 characters" : undefined}
        />
      }
      quick={
        <ToggleGroup
          label="Reservation state"
          options={STATE_OPTIONS}
          value={values.state ?? ""}
          onChange={(state) => {
            const next = { ...values, state: state || undefined };
            setValues(next);
            apply(next);
          }}
        />
      }
      advancedCount={advancedCount}
      advanced={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
            label="Departure from"
            type="date"
            value={values.departureFrom ?? ""}
            onChange={set("departureFrom")}
          />
          <TextField
            label="Departure to"
            type="date"
            value={values.departureTo ?? ""}
            onChange={set("departureTo")}
          />
          <TextField
            label="Booked from"
            type="date"
            value={values.createdFrom ?? ""}
            onChange={set("createdFrom")}
          />
          <TextField
            label="Booked to"
            type="date"
            value={values.createdTo ?? ""}
            onChange={set("createdTo")}
          />
          <Select
            label="Room type"
            placeholder={options.isLoading ? "Loading…" : "All room types"}
            options={roomTypes.map((rt) => ({ value: rt.id, label: `${rt.code} · ${rt.name}` }))}
            value={values.roomTypeId ?? ""}
            onChange={set("roomTypeId")}
          />
          <Select
            label="Source"
            placeholder={options.isLoading ? "Loading…" : "All sources"}
            options={sources.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))}
            value={values.sourceCodeId ?? ""}
            onChange={set("sourceCodeId")}
          />
          <Select
            label="Sort"
            options={SORT_OPTIONS}
            value={values.sort ?? "arrival"}
            onChange={set("sort")}
          />
        </div>
      }
    />
  );
}
