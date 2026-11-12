"use client";

import {
  type Control,
  type FieldErrors,
  type UseFormSetValue,
  useFieldArray,
} from "react-hook-form";
import { Button } from "@/global/components/ui/Button";
import { FormCheckbox, FormSelect, FormTextField } from "@/global/components/ui/form";
import { ADDRESS_TYPES, CONTACT_TYPES } from "@serene/shared/modules/guests/guests.schema";
import { type EditProfileValues, newAddressRow, newContactRow } from "../_lib/guestDialogForms";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ctl = Control<EditProfileValues, any, any>;

const label = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace("_", " ");

function listError(errors: FieldErrors<EditProfileValues>, key: "contacts" | "addresses") {
  const entry = errors[key];
  return entry?.message ?? entry?.root?.message;
}

/** The "Additional contacts" fieldset of the profile editor. */
export function ContactsFieldset({
  control,
  errors,
}: {
  control: Ctl;
  errors: FieldErrors<EditProfileValues>;
}) {
  const { fields, append, remove } = useFieldArray({ control, name: "contacts" });
  const error = listError(errors, "contacts");
  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
      <legend className="px-1 text-sm">Additional contacts</legend>
      {fields.map((field, i) => (
        <div
          key={field.id}
          className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-end gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto_auto]"
        >
          <FormSelect
            control={control}
            name={`contacts.${i}.type`}
            label="Type"
            options={CONTACT_TYPES.map((t) => ({ value: t, label: label(t) }))}
          />
          <FormTextField control={control} name={`contacts.${i}.value`} label="Value" />
          <FormCheckbox
            control={control}
            name={`contacts.${i}.isPrimary`}
            className="flex min-h-11 items-center gap-1 text-sm"
            label="Primary"
          />
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 md:min-h-0"
            onClick={() => remove(i)}
          >
            Remove
          </Button>
        </div>
      ))}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Button
        size="sm"
        variant="secondary"
        className="min-h-11 self-start md:min-h-0"
        onClick={() => append(newContactRow())}
        disabled={fields.length >= 20}
      >
        Add contact
      </Button>
    </fieldset>
  );
}

/** The "Addresses" fieldset of the profile editor. */
export function AddressesFieldset({
  control,
  errors,
  setValue,
}: {
  control: Ctl;
  errors: FieldErrors<EditProfileValues>;
  setValue: UseFormSetValue<EditProfileValues>;
}) {
  const { fields, append, remove } = useFieldArray({ control, name: "addresses" });
  const error = listError(errors, "addresses");
  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
      <legend className="px-1 text-sm">Addresses</legend>
      {fields.map((field, i) => (
        <div
          key={field.id}
          className="grid gap-2 border-b border-border-subtle pb-2 sm:grid-cols-4"
        >
          <FormSelect
            control={control}
            name={`addresses.${i}.type`}
            label="Type"
            options={ADDRESS_TYPES.map((t) => ({ value: t, label: label(t) }))}
          />
          <FormTextField
            control={control}
            name={`addresses.${i}.line1`}
            label="Line 1"
            className="sm:col-span-3"
          />
          <FormTextField control={control} name={`addresses.${i}.city`} label="City" />
          <FormTextField control={control} name={`addresses.${i}.postalCode`} label="Postal code" />
          <FormTextField
            control={control}
            name={`addresses.${i}.countryCode`}
            label="Country"
            maxLength={2}
            onChange={(e) => setValue(`addresses.${i}.countryCode`, e.target.value.toUpperCase())}
          />
          <div className="flex items-end gap-2">
            <FormCheckbox
              control={control}
              name={`addresses.${i}.isPrimary`}
              className="flex min-h-11 items-center gap-1 text-sm"
              label="Primary"
            />
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11 md:min-h-0"
              onClick={() => remove(i)}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Button
        size="sm"
        variant="secondary"
        className="min-h-11 self-start md:min-h-0"
        onClick={() => append(newAddressRow(fields.length === 0))}
        disabled={fields.length >= 10}
      >
        Add address
      </Button>
    </fieldset>
  );
}
