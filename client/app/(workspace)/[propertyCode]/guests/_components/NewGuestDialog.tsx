"use client";

import Link from "next/link";
import type { Route } from "next";
import { FormDialog } from "@/global/components/ui/FormDialog";
import { FormTextField, applyServerError, useZodForm } from "@/global/components/ui/form";
import { useProperty } from "@/global/hooks/useProperty";
import { useCreateGuestMutation } from "@/global/api/endpoints/guestsApi";
import { toClientApiError } from "@/global/api/errors";
import type { CreateGuestInput } from "@serene/shared/modules/guests/guests.schema";
import type { PossibleDuplicate } from "@serene/shared/modules/guests/guests.types";
import { guestPayload, newGuestDialogDefaults, newGuestFormSchema } from "../_lib/guestForm";

export function NewGuestDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const property = useProperty();
  const [create, state] = useCreateGuestMutation();
  const { control, handleSubmit, setError, setValue, formState } = useZodForm(
    newGuestFormSchema,
    newGuestDialogDefaults,
  );
  const error = toClientApiError(state.error);
  const duplicates =
    error?.details.reason === "POSSIBLE_DUPLICATE"
      ? ((error.details.matches as PossibleDuplicate[] | undefined) ?? [])
      : [];

  async function submit(values: CreateGuestInput) {
    const result = await create(guestPayload(values, duplicates.length > 0));
    if ("data" in result && result.data) {
      onClose();
      onCreated(result.data.id);
    } else if ("error" in result) {
      applyServerError(setError, toClientApiError(result.error));
    }
  }

  return (
    <FormDialog
      title="New guest profile"
      description="Shared by every property of the organization."
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel={duplicates.length > 0 ? "Create anyway" : "Create guest"}
      pending={state.isLoading || formState.isSubmitting}
      error={duplicates.length > 0 ? null : error}
      size="lg"
    >
      {duplicates.length > 0 ? (
        <div
          className="rounded-md border border-warning/40 bg-warning-subtle p-3 text-sm"
          role="alert"
        >
          <p className="font-medium">A profile with this e-mail or phone already exists:</p>
          <ul className="mt-1 flex flex-col gap-1">
            {duplicates.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/${property.code}/guests/${d.id}` as Route}
                  className="text-brand hover:underline"
                >
                  {d.fullName} · {d.profileNumber}
                </Link>{" "}
                <span className="text-fg-muted">
                  {[d.email, d.phone].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-fg-secondary">
            Open the existing profile, or create a new one anyway.
          </p>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)]">
        <FormTextField control={control} name="title" label="Title" maxLength={20} />
        <FormTextField control={control} name="firstName" label="First name" maxLength={100} />
        <FormTextField control={control} name="lastName" label="Last name" maxLength={100} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormTextField
          control={control}
          name="preferredName"
          label="Preferred name (optional)"
          maxLength={100}
        />
        <FormTextField
          control={control}
          name="nationalityCode"
          label="Nationality (2 letters)"
          maxLength={2}
          onChange={(e) => setValue("nationalityCode", e.target.value.toUpperCase())}
        />
        <FormTextField control={control} name="email" label="E-mail" type="email" />
        <FormTextField control={control} name="phone" label="Phone" inputMode="tel" />
      </div>
    </FormDialog>
  );
}
