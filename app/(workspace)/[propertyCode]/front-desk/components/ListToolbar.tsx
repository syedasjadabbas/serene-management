"use client";

import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";

/** Filter chips and a server-side search (guest name, confirmation or room number). */
export function ListToolbar({
  filters,
  filter,
  q,
  searchable,
  onFilter,
  onSearch,
}: {
  filters: { value: string; label: string }[];
  filter: string;
  q: string;
  searchable: boolean;
  onFilter: (value: string) => void;
  onSearch: (value: string) => void;
}) {
  const [text, setText] = useState(q);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (value.length === 1) {
      setError("Type at least 2 characters");
      return;
    }
    setError(null);
    onSearch(value);
  }

  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div role="group" aria-label="Filter" className="flex flex-wrap gap-1.5">
        {filters.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            onClick={() => onFilter(option.value)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              filter === option.value
                ? "border-brand bg-brand-subtle font-medium text-brand"
                : "border-border-subtle text-fg-secondary hover:bg-surface-sunken",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {searchable ? (
        <form onSubmit={submit} role="search" className="flex items-start gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="front-desk-search" className="sr-only">
              Search by guest, confirmation or room
            </label>
            <input
              id="front-desk-search"
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Guest, confirmation or room"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "front-desk-search-error" : undefined}
              className="h-control w-64 max-w-full rounded-md border border-border bg-surface px-2 text-sm"
            />
            {error ? (
              <p id="front-desk-search-error" className="text-xs text-danger">
                {error}
              </p>
            ) : null}
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
          {q ? (
            <Button
              variant="ghost"
              onClick={() => {
                setText("");
                onSearch("");
              }}
            >
              Clear
            </Button>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
