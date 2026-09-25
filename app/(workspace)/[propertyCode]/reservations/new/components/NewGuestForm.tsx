"use client";

import { type FormEvent, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { toClientApiError } from "@/lib/api/errors";
import { createGuestSchema } from "@/modules/guests/guests.schema";
import type { GuestSummaryView, PossibleDuplicate } from "@/modules/guests/guests.types";
import { useCreateGuestMutation } from "@/lib/api/endpoints/guests.api";

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
  const [firstGuess, ...rest] = initialName.trim().split(/\s+/);
  const [values, setValues] = useState({
    title: "",
    firstName: firstGuess ?? "",
    lastName: rest.join(" "),
    email: "",
    phone: "",
    nationalityCode: "",
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [createGuest, { isLoading, error }] = useCreateGuestMutation();
  const apiError = toClientApiError(error);
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  const duplicates =
    apiError?.details.reason === "POSSIBLE_DUPLICATE"
      ? ((apiError.details.matches as PossibleDuplicate[] | undefined) ?? [])
      : [];

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = createGuestSchema.safeParse({
      ...values,
      allowDuplicate: duplicates.length > 0,
    });
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = [issue.message];
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    const result = await createGuest(parsed.data);
    if ("data" in result && result.data) onCreated(result.data);
  }

  const fieldErrors = { ...apiError?.fieldErrors, ...errors };
  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4"
      aria-label="New guest profile"
    >
      <h2 className="text-lg font-semibold">New guest profile</h2>
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
        <TextField label="Title" value={values.title} onChange={set("title")} />
        <TextField
          label="First name"
          value={values.firstName}
          onChange={set("firstName")}
          errors={fieldErrors.firstName}
          required
          autoFocus
        />
        <TextField
          label="Last name"
          value={values.lastName}
          onChange={set("lastName")}
          errors={fieldErrors.lastName}
          required
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TextField
          label="Email"
          type="email"
          value={values.email}
          onChange={set("email")}
          errors={fieldErrors.email}
        />
        <TextField
          label="Phone"
          type="tel"
          value={values.phone}
          onChange={set("phone")}
          errors={fieldErrors.phone}
        />
        <TextField
          label="Nationality"
          value={values.nationalityCode}
          onChange={set("nationalityCode")}
          errors={fieldErrors.nationalityCode}
          hint="Two-letter code, e.g. PK"
          maxLength={2}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" pending={isLoading}>
          {duplicates.length > 0 ? "Create new anyway" : "Create and select"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Back to search
        </Button>
      </div>
    </form>
  );
}
