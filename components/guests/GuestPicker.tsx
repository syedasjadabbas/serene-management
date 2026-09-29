"use client";

import { Star, UserRound } from "lucide-react";
import { useState } from "react";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useSearchGuestsQuery } from "@/lib/api/endpoints/guests.api";

export interface PickedGuest {
  id: string;
  label: string;
}

/**
 * Guest selector: the SERENE searchable dropdown over the organization's
 * guest search (server-side, debounced, guests:read enforced by the API).
 * Each result shows the profile number and contact details; VIP guests get
 * a star. The chosen guest is `{ id, label }` ("Name · profile number").
 */
export function GuestPicker({
  value,
  onChange,
  label = "Guest",
  disabled = false,
  emptyText = "No guest found",
  className,
}: {
  value: PickedGuest | null;
  onChange: (guest: PickedGuest | null) => void;
  label?: string;
  disabled?: boolean;
  emptyText?: string;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query.trim(), 250);
  const results = useSearchGuestsQuery(debounced, { skip: debounced.length < 2 });
  const guests = debounced.length >= 2 ? (results.data ?? []) : [];

  return (
    <SearchableSelect
      label={label}
      className={className}
      items={guests.map((guest) => ({
        value: guest.id,
        label: guest.fullName,
        description: [guest.profileNumber, guest.email, guest.phone].filter(Boolean).join(" · "),
        icon: guest.vip ? Star : UserRound,
      }))}
      value={value?.id ?? ""}
      selectedLabel={value?.label}
      onChange={(id) => {
        const guest = guests.find((g) => g.id === id);
        onChange(
          guest ? { id: guest.id, label: `${guest.fullName} · ${guest.profileNumber}` } : null,
        );
      }}
      onSearchChange={setQuery}
      loading={results.isFetching || debounced !== query.trim()}
      minSearchLength={2}
      searchPlaceholder="Name, email, phone or profile number"
      searchPrompt="Type at least 2 characters of a name, email, phone or profile number"
      placeholder="Search for a guest"
      clearable={!disabled}
      disabled={disabled}
      emptyText={emptyText}
    />
  );
}
