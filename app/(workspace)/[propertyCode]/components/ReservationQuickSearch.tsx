"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";

/**
 * Top-bar search: opens the reservation search (`/reservations?q=`) of the
 * current property, which matches guest names, confirmation numbers and
 * more on the server. Shown only to users who can read reservations. Below
 * xl, where the top bar has no room for a field, it is an icon link to the
 * reservation search page.
 */
export function ReservationQuickSearch() {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const router = useRouter();
  const [text, setText] = useState("");
  const id = useId();

  if (!can("reservations:read")) return null;

  function submit(event: FormEvent) {
    event.preventDefault();
    const q = text.trim();
    const base = `/${property.code}/reservations`;
    router.push((q ? `${base}?q=${encodeURIComponent(q)}` : base) as Route);
  }

  return (
    <>
      <Link
        href={`/${property.code}/reservations` as Route}
        aria-label="Find a reservation"
        title="Find a reservation"
        className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-fg-secondary shadow-card hover:bg-surface-sunken hover:text-fg xl:hidden"
      >
        <Search aria-hidden="true" className="size-[1.125rem]" />
      </Link>
      <form role="search" onSubmit={submit} className="relative hidden w-full max-w-sm xl:block">
        <label htmlFor={id} className="sr-only">
          Find a reservation by guest or confirmation number
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted"
        />
        <input
          id={id}
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Find reservation or guest"
          className="h-10 w-full rounded-md border border-border bg-surface ps-9 pe-3 text-sm text-fg shadow-card transition-[border-color,box-shadow] duration-150 placeholder:text-fg-muted hover:border-border-strong/60 focus-visible:border-brand focus-visible:shadow-[0_0_0_3px_rgb(16_124_65/0.14)] focus-visible:outline-none"
        />
      </form>
    </>
  );
}
