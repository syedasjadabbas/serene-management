"use client";

import { FormDialog } from "@/global/components/ui/FormDialog";
import {
  FormCheckbox,
  FormSelect,
  FormTextArea,
  FormTextField,
  applyServerError,
  useZodForm,
} from "@/global/components/ui/form";
import { useGuestOptionsQuery, useUpdateGuestMutation } from "@/global/api/endpoints/guestsApi";
import { toClientApiError } from "@/global/api/errors";
import { CONTACT_TYPES } from "@serene/shared/modules/guests/guests.schema";
import type { GuestProfileView } from "@serene/shared/modules/guests/guests.types";
import {
  type EditProfileValues,
  editProfileDefaults,
  editProfileFormSchema,
  editProfilePayload,
  profileChanges,
} from "../_lib/guestDialogForms";
import { AddressesFieldset, ContactsFieldset } from "./ProfileListFields";

const label = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace("_", " ");

export function EditProfileDialog({
  guest,
  onClose,
}: {
  guest: GuestProfileView;
  onClose: () => void;
}) {
  const options = useGuestOptionsQuery();
  const [update, state] = useUpdateGuestMutation();
  const original = {
    status: guest.status,
    isRestricted: guest.isRestricted,
    dateOfBirth: guest.dateOfBirth,
    readSensitive: guest.access.readSensitive,
  };
  const { control, handleSubmit, setError, setValue, watch, formState } = useZodForm(
    editProfileFormSchema(original),
    editProfileDefaults(guest),
  );
  const values = watch();
  const manageRestrictions = guest.access.manageRestrictions;
  const { needsReason } = profileChanges(values, original);

  async function submit(parsed: EditProfileValues) {
    const result = await update({
      guestId: guest.id,
      body: editProfilePayload(parsed, {
        ...original,
        version: guest.version,
        restrictionReason: guest.restrictionReason,
        manageRestrictions,
      }),
    });
    if ("data" in result) onClose();
    else applyServerError(setError, toClientApiError(result.error));
  }

  return (
    <FormDialog
      title={`Edit ${guest.fullName}`}
      description="Changes are audited. The profile is shared by every property."
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel="Save profile"
      pending={state.isLoading || formState.isSubmitting}
      error={toClientApiError(state.error)}
      size="lg"
    >
      <div className="grid gap-3 sm:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)]">
        <FormTextField control={control} name="title" label="Title" maxLength={20} />
        <FormTextField control={control} name="firstName" label="First name" maxLength={100} />
        <FormTextField control={control} name="lastName" label="Last name" maxLength={100} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormTextField control={control} name="middleName" label="Middle name" maxLength={100} />
        <FormTextField
          control={control}
          name="preferredName"
          label="Preferred name"
          maxLength={100}
        />
        <FormTextField control={control} name="gender" label="Gender" maxLength={20} />
        <FormTextField control={control} name="email" label="E-mail" type="email" />
        <FormTextField control={control} name="phone" label="Phone" inputMode="tel" />
        <FormSelect
          control={control}
          name="preferredContact"
          label="Preferred contact"
          placeholder="Not set"
          options={CONTACT_TYPES.map((t) => ({ value: t, label: label(t) }))}
        />
        <FormTextField
          control={control}
          name="nationalityCode"
          label="Nationality (2 letters)"
          maxLength={2}
          onChange={(e) => setValue("nationalityCode", e.target.value.toUpperCase())}
        />
        <FormTextField control={control} name="languageCode" label="Language" maxLength={10} />
        <FormSelect
          control={control}
          name="vipLevelId"
          label="VIP level"
          placeholder="None"
          options={(options.data?.vipLevels ?? []).map((v) => ({ value: v.id, label: v.name }))}
        />
        {guest.access.readSensitive ? (
          <FormTextField
            control={control}
            name="dateOfBirth"
            label="Date of birth (sensitive)"
            type="date"
          />
        ) : null}
        {manageRestrictions ? (
          <FormSelect
            control={control}
            name="status"
            label="Status"
            options={[
              { value: "ACTIVE", label: "Active" },
              { value: "INACTIVE", label: "Inactive" },
            ]}
          />
        ) : null}
      </div>
      <FormCheckbox
        control={control}
        name="marketingOptIn"
        className="flex min-h-11 items-center gap-2 text-sm"
        label="Agrees to marketing communication"
      />

      <ContactsFieldset control={control} errors={formState.errors} />
      <AddressesFieldset control={control} errors={formState.errors} setValue={setValue} />

      {manageRestrictions ? (
        <fieldset className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
          <legend className="px-1 text-sm">Restriction</legend>
          <FormCheckbox
            control={control}
            name="isRestricted"
            className="flex min-h-11 items-center gap-2 text-sm"
            label="Restrict this profile from booking (high-risk, audited)"
          />
          {values.isRestricted ? (
            <FormTextField
              control={control}
              name="restrictionReason"
              label="Why is the profile restricted?"
              maxLength={500}
            />
          ) : null}
        </fieldset>
      ) : (
        <p className="text-sm text-fg-secondary">
          Status and booking restriction apply to every property and are changed by an organization
          administrator.
        </p>
      )}
      <FormTextArea
        control={control}
        name="reason"
        label={needsReason ? "Reason for the change (required)" : "Reason (optional)"}
        maxLength={1000}
      />
    </FormDialog>
  );
}
