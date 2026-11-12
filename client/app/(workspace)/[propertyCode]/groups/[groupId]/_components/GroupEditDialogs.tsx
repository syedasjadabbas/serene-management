"use client";

import { useController } from "react-hook-form";
import { CompanyPicker } from "@/global/components/accounts/CompanyPicker";
import { GuestPicker } from "@/global/components/guests/GuestPicker";
import {
  FormSelect,
  FormTextArea,
  FormTextField,
  applyServerError,
  useZodForm,
} from "@/global/components/ui/form";
import { FormDialog } from "@/global/components/ui/FormDialog";
import { useProperty } from "@/global/hooks/useProperty";
import {
  useChangeGroupStatusMutation,
  useUpdateGroupMutation,
} from "@/global/api/endpoints/groupsApi";
import { toClientApiError } from "@/global/api/errors";
import type { GroupDetail } from "@serene/shared/modules/groups/groups.types";
import {
  editGroupFormSchema,
  groupStatusDefaults,
  groupStatusFormSchema,
} from "../../_lib/groupForms";

export function GroupStatusDialog({ group, onClose }: { group: GroupDetail; onClose: () => void }) {
  const property = useProperty();
  const [save, state] = useChangeGroupStatusMutation();
  const { control, handleSubmit, setError, watch, formState } = useZodForm(
    groupStatusFormSchema,
    groupStatusDefaults,
  );
  const status = watch("status");
  const error = toClientApiError(state.error);
  return (
    <FormDialog
      title={`Close or cancel · ${group.code}`}
      description="Cancelling moves every block to cancelled and releases held rooms; it is refused while rooms are picked up."
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const result = await save({
          propertyId: property.id,
          groupId: group.id,
          body: { status: values.status, reason: values.reason.trim() },
        });
        if ("data" in result) onClose();
        else applyServerError(setError, toClientApiError(result.error));
      })}
      submitLabel={status === "CANCELLED" ? "Cancel group" : "Close group"}
      danger={status === "CANCELLED"}
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <FormSelect
        control={control}
        name="status"
        label="New status"
        options={[
          { value: "CLOSED", label: "Closed (completed)" },
          { value: "CANCELLED", label: "Cancelled" },
        ]}
      />
      <FormTextArea control={control} name="reason" label="Reason (audited)" maxLength={1000} />
    </FormDialog>
  );
}

/** Name, company, contact and notes of an active group; the code is fixed. */
export function EditGroupDialog({ group, onClose }: { group: GroupDetail; onClose: () => void }) {
  const property = useProperty();
  const [save, state] = useUpdateGroupMutation();
  const { control, handleSubmit, setError, formState } = useZodForm(editGroupFormSchema, {
    name: group.name,
    company: group.account ? { id: group.account.id, label: group.account.name } : null,
    contact: group.contact ? { id: group.contact.id, label: group.contact.name } : null,
    notes: group.notes ?? "",
  });
  const company = useController({ control, name: "company" });
  const contact = useController({ control, name: "contact" });
  const error = toClientApiError(state.error);
  return (
    <FormDialog
      title={`Edit group · ${group.code}`}
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const result = await save({
          propertyId: property.id,
          groupId: group.id,
          body: {
            name: values.name.trim(),
            accountProfileId: values.company?.id ?? null,
            contactGuestId: values.contact?.id ?? null,
            notes: values.notes.trim() || null,
          },
        });
        if ("data" in result) onClose();
        else applyServerError(setError, toClientApiError(result.error));
      })}
      submitLabel="Save group"
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <FormTextField control={control} name="name" label="Name" maxLength={200} />
      <CompanyPicker
        value={company.field.value}
        onChange={company.field.onChange}
        label="Company (optional)"
      />
      <GuestPicker
        value={contact.field.value}
        onChange={contact.field.onChange}
        label="Contact (optional)"
      />
      <FormTextArea control={control} name="notes" label="Notes (optional)" maxLength={4000} />
    </FormDialog>
  );
}
