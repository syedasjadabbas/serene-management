"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useAccountsQuery } from "@/lib/api/endpoints/accounts.api";

export interface PickedCompany {
  id: string;
  label: string;
}

/**
 * Debounced server-side company search (active companies only). The server
 * re-validates the chosen company wherever it is used.
 */
export function CompanyPicker({
  value,
  onChange,
  label = "Company (optional)",
}: {
  value: PickedCompany | null;
  onChange: (company: PickedCompany | null) => void;
  label?: string;
}) {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim(), 300);
  const results = useAccountsQuery(
    { q: debounced, type: "COMPANY", status: "ACTIVE", limit: 8 },
    { skip: debounced.length < 2 || value !== null },
  );
  if (value) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-secondary">{label}</span>
        <p className="flex min-h-11 flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{value.label}</span>
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            Remove
          </Button>
        </p>
      </div>
    );
  }
  return (
    <div className="relative flex flex-col gap-1">
      <TextField
        label={label}
        placeholder="Search by name or code"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {debounced.length >= 2 && results.data ? (
        <ul
          className="max-h-56 overflow-y-auto rounded-md border border-border-subtle bg-surface"
          aria-label="Matching companies"
        >
          {results.data.items.length === 0 ? (
            <li className="px-3 py-2 text-sm text-fg-secondary">No company found.</li>
          ) : null}
          {results.data.items.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                disabled={a.isRestricted}
                className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-sunken disabled:opacity-60"
                onClick={() => {
                  onChange({ id: a.id, label: `${a.name}${a.code ? ` (${a.code})` : ""}` });
                  setSearch("");
                }}
              >
                <span>
                  {a.name} <span className="text-xs text-fg-muted">{a.code}</span>
                </span>
                {a.isRestricted ? <span className="text-xs text-danger">Restricted</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
