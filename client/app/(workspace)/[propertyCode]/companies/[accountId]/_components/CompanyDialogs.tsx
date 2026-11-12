"use client";

import { GuestPicker } from "@/global/components/guests/GuestPicker";
import { FormDialog } from "@/global/components/ui/FormDialog";
import {
  FormCheckbox,
  FormSelect,
  FormTextArea,
  FormTextField,
  applyServerError,
  useZodForm,
} from "@/global/components/ui/form";
import {
  useSetAccountContactMutation,
  useUpdateAccountMutation,
} from "@/global/api/endpoints/accountsApi";
import { toClientApiError } from "@/global/api/errors";
import type {
  AccountContactView,
  AccountDetail,
} from "@serene/shared/modules/accounts/accounts.types";
import {
  type EditCompanyValues,
  type RelationshipValues,
  companyNeedsReason,
  editCompanyDefaults,
  editCompanyFormSchema,
  editCompanyPayload,
  relationshipFormSchema,
  relationshipPayload,
} from "../_lib/companyForms";

const KIND_LABELS = { EMPLOYEE: "Employee", CONTACT: "Contact", ASSOCIATE: "Associate" } as const;

export function EditCompanyDialog({
  company,
  onClose,
}: {
  company: AccountDetail;
  onClose: () => void;
}) {
  const [update, state] = useUpdateAccountMutation();
  const { control, handleSubmit, setError, setValue, watch, formState } = useZodForm(
    editCompanyFormSchema(company),
    editCompanyDefaults(company),
  );
  const values = watch();
  const needsReason = companyNeedsReason(values, company);

  async function submit(parsed: EditCompanyValues) {
    const result = await update({
      accountId: company.id,
      body: editCompanyPayload(parsed, company),
    });
    if ("data" in result) onClose();
    else applyServerError(setError, toClientApiError(result.error));
  }

  return (
    <FormDialog
      title={`Edit ${company.name}`}
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel="Save company"
      pending={state.isLoading || formState.isSubmitting}
      error={toClientApiError(state.error)}
      size="lg"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormTextField control={control} name="name" label="Name" maxLength={200} />
        <FormTextField control={control} name="legalName" label="Legal name" maxLength={200} />
        <FormTextField control={control} name="taxId" label="Tax id" maxLength={60} />
        <FormTextField control={control} name="iataNumber" label="IATA" maxLength={20} />
        <FormTextField control={control} name="email" label="E-mail" type="email" />
        <FormTextField control={control} name="phone" label="Phone" inputMode="tel" />
        <FormTextField control={control} name="addressLine1" label="Address" maxLength={200} />
        <FormTextField control={control} name="city" label="City" maxLength={100} />
        <FormTextField control={control} name="postalCode" label="Postal code" maxLength={20} />
        <FormTextField
          control={control}
          name="countryCode"
          label="Country (2 letters)"
          maxLength={2}
          onChange={(e) => setValue("countryCode", e.target.value.toUpperCase())}
        />
        <FormSelect
          control={control}
          name="status"
          label="Status"
          options={[
            { value: "ACTIVE", label: "Active" },
            { value: "INACTIVE", label: "Inactive" },
          ]}
        />
      </div>
      <FormTextArea control={control} name="notes" label="Notes" maxLength={4000} />
      <FormCheckbox
        control={control}
        name="isRestricted"
        className="flex min-h-11 items-center gap-2 text-sm"
        label="Restrict from booking (high-risk, audited)"
      />
      {values.isRestricted ? (
        <FormTextField
          control={control}
          name="restrictionReason"
          label="Why is it restricted?"
          maxLength={500}
        />
      ) : null}
      <FormTextArea
        control={control}
        name="reason"
        label={needsReason ? "Reason for the change (required)" : "Reason (optional)"}
        maxLength={1000}
      />
    </FormDialog>
  );
}

export function RelationshipDialog({
  company,
  contact,
  onClose,
}: {
  company: AccountDetail;
  contact: AccountContactView | null;
  onClose: () => void;
}) {
  const [save, state] = useSetAccountContactMutation();
  const { control, handleSubmit, setError, setValue, watch, formState } = useZodForm(
    relationshipFormSchema,
    {
      guest: contact ? { id: contact.guest.id, label: contact.guest.fullName } : null,
      kind: contact?.kind ?? "EMPLOYEE",
      role: contact?.role ?? "",
      isPrimary: contact?.isPrimary ?? false,
    },
  );
  const guest = watch("guest");

  async function submit(values: RelationshipValues) {
    if (!values.guest) return;
    const result = await save({
      accountId: company.id,
      guestId: values.guest.id,
      body: relationshipPayload(values),
    });
    if ("data" in result) onClose();
    else applyServerError(setError, toClientApiError(result.error));
  }

  return (
    <FormDialog
      title={contact ? `Relationship · ${contact.guest.fullName}` : "Add relationship"}
      description="One relationship per guest; making someone primary replaces the current primary contact."
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel="Save relationship"
      pending={state.isLoading || formState.isSubmitting}
      error={toClientApiError(state.error)}
    >
      <div className="flex flex-col gap-1">
        <GuestPicker
          value={guest}
          onChange={(picked) =>
            setValue("guest", picked, { shouldValidate: formState.isSubmitted })
          }
          disabled={Boolean(contact)}
          emptyText="No guest found. Create the profile in Guests first."
        />
        {formState.errors.guest?.message ? (
          <p role="alert" className="text-xs text-danger">
            {formState.errors.guest.message}
          </p>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormSelect
          control={control}
          name="kind"
          label="Relationship"
          options={Object.entries(KIND_LABELS).map(([value, labelText]) => ({
            value,
            label: labelText,
          }))}
        />
        <FormTextField control={control} name="role" label="Role / job title" maxLength={100} />
      </div>
      <FormCheckbox
        control={control}
        name="isPrimary"
        className="flex min-h-11 items-center gap-2 text-sm"
        label="Primary contact of the company"
      />
    </FormDialog>
  );
}
