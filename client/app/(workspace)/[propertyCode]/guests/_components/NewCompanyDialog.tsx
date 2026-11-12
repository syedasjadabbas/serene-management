"use client";

import { FormDialog } from "@/global/components/ui/FormDialog";
import {
  FormSelect,
  FormTextArea,
  FormTextField,
  applyServerError,
  useZodForm,
} from "@/global/components/ui/form";
import { useCreateAccountMutation } from "@/global/api/endpoints/accountsApi";
import { toClientApiError } from "@/global/api/errors";
import { newCompanyDefaults, newCompanyFormSchema } from "../_lib/companyForm";

const TYPE_OPTIONS = [
  { value: "COMPANY", label: "Company" },
  { value: "TRAVEL_AGENT", label: "Travel agent" },
];

export function NewCompanyDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [create, state] = useCreateAccountMutation();
  const { control, handleSubmit, setError, setValue, formState } = useZodForm(
    newCompanyFormSchema,
    newCompanyDefaults,
  );
  const error = toClientApiError(state.error);
  return (
    <FormDialog
      title="New company"
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const result = await create(values);
        if ("data" in result && result.data) {
          onClose();
          onCreated(result.data.id);
        } else if ("error" in result) {
          applyServerError(setError, toClientApiError(result.error));
        }
      })}
      submitLabel="Create company"
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormSelect control={control} name="type" label="Type" options={TYPE_OPTIONS} />
        <FormTextField
          control={control}
          name="code"
          label="Code"
          maxLength={20}
          onChange={(e) => setValue("code", e.target.value.toUpperCase())}
        />
        <FormTextField
          control={control}
          name="name"
          label="Name"
          maxLength={200}
          className="sm:col-span-2"
        />
        <FormTextField control={control} name="email" label="E-mail" type="email" />
        <FormTextField control={control} name="phone" label="Phone" inputMode="tel" />
        <FormTextField control={control} name="city" label="City" maxLength={100} />
        <FormTextField
          control={control}
          name="countryCode"
          label="Country (2 letters)"
          maxLength={2}
          onChange={(e) => setValue("countryCode", e.target.value.toUpperCase())}
        />
      </div>
      <FormTextArea control={control} name="notes" label="Notes (optional)" maxLength={4000} />
    </FormDialog>
  );
}
