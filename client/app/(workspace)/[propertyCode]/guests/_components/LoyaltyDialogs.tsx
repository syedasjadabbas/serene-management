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
import {
  useCreateProgramMutation,
  useCreateTierMutation,
  useUpdateProgramMutation,
  useUpdateTierMutation,
} from "@/global/api/endpoints/loyaltyApi";
import { toClientApiError } from "@/global/api/errors";
import type {
  LoyaltyProgramView,
  LoyaltyTierView,
} from "@serene/shared/modules/loyalty/loyalty.types";
import {
  programFormDefaults,
  programFormSchema,
  programStatusFormSchema,
  tierFormDefaults,
  tierFormSchema,
} from "../_lib/loyaltyForm";

const digits = (value: string) => value.replace(/\D/g, "");

export function ProgramDialog({ onClose }: { onClose: () => void }) {
  const [create, state] = useCreateProgramMutation();
  const { control, handleSubmit, setError, setValue, formState } = useZodForm(
    programFormSchema,
    programFormDefaults,
  );
  return (
    <FormDialog
      title="New loyalty program"
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const result = await create(values);
        if ("data" in result) onClose();
        else applyServerError(setError, toClientApiError(result.error));
      })}
      submitLabel="Create program"
      pending={state.isLoading || formState.isSubmitting}
      error={toClientApiError(state.error)}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormTextField
          control={control}
          name="code"
          label="Code"
          maxLength={20}
          onChange={(e) => setValue("code", e.target.value.toUpperCase())}
        />
        <FormTextField control={control} name="name" label="Name" maxLength={100} />
      </div>
      <FormCheckbox
        control={control}
        name="isExternal"
        className="flex min-h-11 items-center gap-2 text-sm"
        label="External program (member numbers come from the program, not generated here)"
      />
      <FormTextArea control={control} name="reason" label="Reason (audited)" maxLength={500} />
    </FormDialog>
  );
}

export function ProgramStatusDialog({
  program,
  onClose,
}: {
  program: LoyaltyProgramView;
  onClose: () => void;
}) {
  const [update, state] = useUpdateProgramMutation();
  const { control, handleSubmit, setError, formState } = useZodForm(programStatusFormSchema, {
    reason: "",
  });
  const next = program.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
  return (
    <FormDialog
      title={`${next === "ACTIVE" ? "Activate" : "Deactivate"} ${program.code}`}
      description={
        next === "INACTIVE" ? "Guests can no longer be enrolled; memberships stay." : undefined
      }
      onClose={onClose}
      onSubmit={handleSubmit(async ({ reason }) => {
        const result = await update({ programId: program.id, body: { status: next, reason } });
        if ("data" in result) onClose();
        else applyServerError(setError, toClientApiError(result.error));
      })}
      submitLabel={next === "ACTIVE" ? "Activate" : "Deactivate"}
      danger={next === "INACTIVE"}
      pending={state.isLoading || formState.isSubmitting}
      error={toClientApiError(state.error)}
    >
      <FormTextArea control={control} name="reason" label="Reason (audited)" maxLength={500} />
    </FormDialog>
  );
}

export function TierDialog({
  program,
  tier,
  onClose,
}: {
  program: LoyaltyProgramView;
  tier?: LoyaltyTierView;
  onClose: () => void;
}) {
  const [create, createState] = useCreateTierMutation();
  const [update, updateState] = useUpdateTierMutation();
  const { control, handleSubmit, setError, setValue, formState } = useZodForm(
    tierFormSchema(Boolean(tier)),
    tierFormDefaults(tier ?? null, program.tiers.length),
  );
  const error = toClientApiError(createState.error ?? updateState.error);
  return (
    <FormDialog
      title={tier ? `Edit tier ${tier.code}` : `New tier · ${program.code}`}
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const common = {
          name: values.name,
          rank: values.rank,
          qualifyingNights: values.qualifyingNights,
          qualifyingStays: values.qualifyingStays,
          reason: values.reason,
        };
        const result = tier
          ? await update({ tierId: tier.id, body: { ...common, status: values.status } })
          : await create({ programId: program.id, body: { ...common, code: values.code } });
        if ("data" in result) onClose();
        else applyServerError(setError, toClientApiError(result.error));
      })}
      submitLabel={tier ? "Save tier" : "Create tier"}
      pending={createState.isLoading || updateState.isLoading || formState.isSubmitting}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormTextField
          control={control}
          name="code"
          label="Code"
          maxLength={20}
          disabled={!!tier}
          onChange={(e) => setValue("code", e.target.value.toUpperCase())}
        />
        <FormTextField control={control} name="name" label="Name" maxLength={100} />
        <FormTextField
          control={control}
          name="rank"
          label="Rank"
          inputMode="numeric"
          onChange={(e) => setValue("rank", digits(e.target.value))}
        />
        {tier ? (
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
        <FormTextField
          control={control}
          name="qualifyingNights"
          label="Qualifying nights (optional)"
          inputMode="numeric"
          onChange={(e) => setValue("qualifyingNights", digits(e.target.value))}
        />
        <FormTextField
          control={control}
          name="qualifyingStays"
          label="Qualifying stays (optional)"
          inputMode="numeric"
          onChange={(e) => setValue("qualifyingStays", digits(e.target.value))}
        />
      </div>
      <FormTextArea control={control} name="reason" label="Reason (audited)" maxLength={500} />
    </FormDialog>
  );
}
