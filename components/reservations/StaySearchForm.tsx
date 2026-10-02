"use client";

import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { availabilityQuerySchema } from "@/modules/availability/availability.schema";
import { addDays, daysBetween, isDateOnly } from "@/modules/business-date/business-date.policy";
import { MAX_STAY_NIGHTS } from "@/modules/reservations/reservations.policy";

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
  walkIn = false,
}: {
  initial: StaySearchValues;
  businessDate: string;
  onSearch: (values: StaySearchValues) => void;
  pending?: boolean;
  submitLabel?: string;
  /** Walk-in: arrival fixed to the business date, one room. */
  walkIn?: boolean;
}) {
  const [arrival, setArrival] = useState(walkIn ? businessDate : initial.arrival);
  const [nights, setNights] = useState(
    String(Math.max(1, daysBetween(initial.arrival, initial.departure))),
  );
  const [adults, setAdults] = useState(String(initial.adults));
  const [children, setChildren] = useState(String(initial.children));
  const [rooms, setRooms] = useState(walkIn ? "1" : String(initial.rooms));
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const nightCount = Number.parseInt(nights, 10);
  const departure = isDateOnly(arrival) && nightCount > 0 ? addDays(arrival, nightCount) : "";

  function submit(event: FormEvent) {
    event.preventDefault();
    const fieldErrors: Record<string, string[]> = {};
    // Plain-language messages for the fields staff type; the schema's own
    // messages ("Invalid ISO date" for a missing departure) are a fallback.
    if (!isDateOnly(arrival)) fieldErrors.arrival = ["Enter the arrival date"];
    else if (arrival < businessDate) fieldErrors.arrival = [`On or after ${businessDate}`];
    if (!/^\d+$/.test(nights.trim()) || nightCount < 1 || nightCount > MAX_STAY_NIGHTS)
      fieldErrors.nights = [`Enter 1 to ${MAX_STAY_NIGHTS} nights`];
    const parsed = availabilityQuerySchema.safeParse({
      arrival,
      departure,
      adults,
      children,
      rooms,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const raw = String(issue.path[0] ?? "arrival");
        const key = raw === "departure" ? "nights" : raw;
        fieldErrors[key] ??= [issue.message];
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
      // One row from xl; the date columns get room for a full mm/dd/yyyy
      // value and the picker button, the counters stay compact. Fields align
      // at the top so a hint under one field does not lift it; the button
      // steps down by one label height to sit on the field line.
      className="grid grid-cols-2 items-start gap-3 sm:grid-cols-3 xl:grid-cols-[minmax(10.5rem,1.5fr)_minmax(4.5rem,0.8fr)_minmax(8.5rem,1.3fr)_repeat(3,minmax(4.5rem,0.8fr))_auto]"
    >
      <TextField
        label="Arrival"
        type="date"
        value={arrival}
        min={businessDate}
        onChange={(e) => setArrival(e.target.value)}
        errors={errors.arrival}
        readOnly={walkIn}
        hint={walkIn ? "Walk-ins arrive today" : undefined}
        required
      />
      <TextField
        label="Nights"
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_STAY_NIGHTS}
        value={nights}
        onChange={(e) => setNights(e.target.value)}
        errors={errors.nights}
        required
      />
      <TextField label="Departure" type="date" value={departure} readOnly hint="Arrival + nights" />
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
        readOnly={walkIn}
      />
      <Button type="submit" pending={pending} className="col-span-2 sm:col-span-1 sm:mt-5">
        {submitLabel}
      </Button>
    </form>
  );
}
