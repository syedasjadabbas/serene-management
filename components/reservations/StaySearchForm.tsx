"use client";

import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { availabilityQuerySchema } from "@/modules/availability/availability.schema";
import { addDays, daysBetween, isDateOnly } from "@/modules/business-date/business-date.policy";

export interface StaySearchValues {
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  rooms: number;
}

/**
 * Stay criteria: arrival + nights (departure derived, exclusive), party and
 * room count. Validated with the same schema the API uses. The earliest
 * arrival is the hotel business date, never the browser's date.
 */
export function StaySearchForm({
  initial,
  businessDate,
  onSearch,
  pending,
  submitLabel = "Search availability",
}: {
  initial: StaySearchValues;
  businessDate: string;
  onSearch: (values: StaySearchValues) => void;
  pending?: boolean;
  submitLabel?: string;
}) {
  const [arrival, setArrival] = useState(initial.arrival);
  const [nights, setNights] = useState(
    String(Math.max(1, daysBetween(initial.arrival, initial.departure))),
  );
  const [adults, setAdults] = useState(String(initial.adults));
  const [children, setChildren] = useState(String(initial.children));
  const [rooms, setRooms] = useState(String(initial.rooms));
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const nightCount = Number.parseInt(nights, 10);
  const departure = isDateOnly(arrival) && nightCount > 0 ? addDays(arrival, nightCount) : "";

  function submit(event: FormEvent) {
    event.preventDefault();
    const fieldErrors: Record<string, string[]> = {};
    if (isDateOnly(arrival) && arrival < businessDate)
      fieldErrors.arrival = [`On or after ${businessDate}`];
    const parsed = availabilityQuerySchema.safeParse({
      arrival,
      departure,
      adults,
      children,
      rooms,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "arrival");
        fieldErrors[key === "departure" ? "nights" : key] = [issue.message];
      }
    }
    setErrors(fieldErrors);
    if (!parsed.success || Object.keys(fieldErrors).length > 0) return;
    onSearch({
      arrival: parsed.data.arrival,
      departure: parsed.data.departure,
      adults: parsed.data.adults,
      children: parsed.data.children,
      rooms: parsed.data.rooms,
    });
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="grid grid-cols-2 items-end gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(6,minmax(0,1fr))_auto]"
    >
      <TextField
        label="Arrival"
        type="date"
        value={arrival}
        min={businessDate}
        onChange={(e) => setArrival(e.target.value)}
        errors={errors.arrival}
        required
      />
      <TextField
        label="Nights"
        type="number"
        inputMode="numeric"
        min={1}
        max={90}
        value={nights}
        onChange={(e) => setNights(e.target.value)}
        errors={errors.nights}
        required
      />
      <TextField
        label="Departure"
        value={departure}
        readOnly
        tabIndex={-1}
        hint="Arrival + nights"
      />
      <TextField
        label="Adults"
        type="number"
        inputMode="numeric"
        min={1}
        max={12}
        value={adults}
        onChange={(e) => setAdults(e.target.value)}
        errors={errors.adults}
      />
      <TextField
        label="Children"
        type="number"
        inputMode="numeric"
        min={0}
        max={12}
        value={children}
        onChange={(e) => setChildren(e.target.value)}
        errors={errors.children}
      />
      <TextField
        label="Rooms"
        type="number"
        inputMode="numeric"
        min={1}
        max={20}
        value={rooms}
        onChange={(e) => setRooms(e.target.value)}
        errors={errors.rooms}
      />
      <Button type="submit" pending={pending} className="col-span-2 sm:col-span-1">
        {submitLabel}
      </Button>
    </form>
  );
}
