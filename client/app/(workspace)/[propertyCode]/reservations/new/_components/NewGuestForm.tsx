"use client";

import { Alert } from "@/global/components/ui/Alert";
import { Button } from "@/global/components/ui/Button";
import { FormTextField, applyServerError, useZodForm } from "@/global/components/ui/form";
import { toClientApiError } from "@/global/api/errors";
import type { CreateGuestInput } from "@serene/shared/modules/guests/guests.schema";
import type {
  GuestSummaryView,
  PossibleDuplicate,
} from "@serene/shared/modules/guests/guests.types";
import { useCreateGuestMutation } from "@/global/api/endpoints/guestsApi";
import {
  guestPayload,
  newGuestFormSchema,
  newGuestInlineDefaults,
} from "../../../guests/_lib/guestForm";

/** Minimal guest profile for booking; the full profile lives in Guests (Phase 7). */
export function NewGuestForm({
  initialName,
  onCancel,
  onCreated,
}: {
  initialName: string;
  onCancel: () => void;
  onCreated: (guest: Pick<GuestSummaryView, "id" | "fullName" | "profileNumber">) => void;
}) {
  const { control, handleSubmit, setError, formState } = useZodForm(
    newGuestFormSchema,
    newGuestInlineDefaults(initialName),
  );
  const [createGuest, { isLoading, error }] = useCreateGuestMutation();
  const apiError = toClientApiError(error);

  const duplicates =
    apiError?.details.reason === "POSSIBLE_DUPLICATE"
      ? ((apiError.details.matches as PossibleDuplicate[] | undefined) ?? [])
      : [];

  async function submit(values: CreateGuestInput) {
    const result = await createGuest(guestPayload(values, duplicates.length > 0));
    if ("data" in result && result.data) onCreated(result.data);
    else if ("error" in result) applyServerError(setError, toClientApiError(result.error));
  }

  return (
    <form
      onSubmit={handleSubmit(submit)}
      noValidate
      className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-5 shadow-card"
      aria-label="New guest profile"
    >
      <h2 className="text-lg font-semibold tracking-[-0.01em]">New guest profile</h2>
      {duplicates.length > 0 ? (
        <Alert tone="warning">
          <p>
            A profile with this e-mail or phone already exists. Use it, or create a new one anyway:
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {duplicates.map((d) => (
              <li key={d.id}>
                <Button size="sm" variant="secondary" onClick={() => onCreated(d)}>
                  Use {d.fullName} · {d.profileNumber}
                </Button>
              </li>
            ))}
          </ul>
        </Alert>
      ) : apiError && Object.keys(apiError.fieldErrors).length === 0 ? (
        <Alert tone="danger">{apiError.message}</Alert>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[6rem_1fr_1fr]">
        <FormTextField control={control} name="title" label="Title" />
        <FormTextField control={control} name="firstName" label="First name" required autoFocus />
        <FormTextField control={control} name="lastName" label="Last name" required />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormTextField control={control} name="email" label="Email" type="email" />
        <FormTextField control={control} name="phone" label="Phone" type="tel" />
        <FormTextField
          control={control}
          name="nationalityCode"
          label="Nationality"
          hint="Two-letter code, e.g. PK"
          maxLength={2}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" pending={isLoading || formState.isSubmitting}>
          {duplicates.length > 0 ? "Create new anyway" : "Create and select"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Back to search
        </Button>
      </div>
    </form>
  );
}
