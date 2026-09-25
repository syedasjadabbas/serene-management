"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { TextField } from "@/components/ui/TextField";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { toClientApiError } from "@/lib/api/errors";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useSearchGuestsQuery } from "@/lib/api/endpoints/guests.api";
import { useBookingDraft } from "../store/bookingDraft.store";
import { NewGuestForm } from "./NewGuestForm";

/** Step 2: find the guest (debounced server search) or create a profile. */
export function StepGuest() {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const { guest, setGuest, setStep } = useBookingDraft();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const debounced = useDebouncedValue(query.trim(), 300);
  const search = useSearchGuestsQuery(debounced, { skip: debounced.length < 2 });
  const error = toClientApiError(search.error);

  function choose(id: string, label: string) {
    setGuest({ id, label });
    setStep(3);
  }

  if (creating) {
    return (
      <NewGuestForm
        initialName={query}
        onCancel={() => setCreating(false)}
        onCreated={(created) =>
          choose(created.id, `${created.fullName} · ${created.profileNumber}`)
        }
      />
    );
  }

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4"
      aria-label="Guest"
    >
      {guest ? (
        <p className="text-sm">
          Selected: <span className="font-medium">{guest.label}</span>{" "}
          <Button size="sm" variant="ghost" onClick={() => setStep(3)}>
            Continue
          </Button>
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <TextField
          label="Find guest"
          placeholder="Name, email, phone or profile number"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          className="min-w-72 flex-1"
          hint="Searches all guest profiles of the organization"
        />
        {can("guests:create") ? (
          <Button variant="secondary" onClick={() => setCreating(true)}>
            New guest profile
          </Button>
        ) : null}
      </div>
      <div aria-live="polite">
        {debounced.length < 2 ? (
          <p className="text-sm text-fg-muted">Type at least 2 characters.</p>
        ) : search.isFetching && !search.data ? (
          <Spinner label="Searching guests" />
        ) : error ? (
          <p className="text-sm text-danger">{error.message}</p>
        ) : search.data && search.data.length === 0 ? (
          <p className="text-sm text-fg-secondary">No guest found. Create a new profile instead.</p>
        ) : (
          <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
            {search.data?.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
                <span className="min-w-48 font-medium">
                  {g.fullName}
                  {g.vip ? (
                    <span className="ms-1 text-2xs font-semibold text-accent">{g.vip.code}</span>
                  ) : null}
                  {g.isRestricted ? (
                    <span className="ms-1 text-2xs font-semibold text-danger">RESTRICTED</span>
                  ) : null}
                </span>
                <span className="font-mono text-xs text-fg-muted">{g.profileNumber}</span>
                <span className="text-xs text-fg-secondary">
                  {[g.email, g.phone, g.nationalityCode].filter(Boolean).join(" · ")}
                </span>
                <Button
                  size="sm"
                  className="ms-auto"
                  disabled={g.isRestricted}
                  onClick={() => choose(g.id, `${g.fullName} · ${g.profileNumber}`)}
                >
                  Select
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
