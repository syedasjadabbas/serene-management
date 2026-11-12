"use client";

import { FormDialog } from "@/global/components/ui/FormDialog";
import {
  FormSelect,
  FormTextField,
  applyServerError,
  useZodForm,
} from "@/global/components/ui/form";
import { useProperty } from "@/global/hooks/useProperty";
import {
  useCreateRoomTypeMutation,
  useUpdateRoomTypeMutation,
} from "@/global/api/endpoints/setupApi";
import { toClientApiError } from "@/global/api/errors";
import type { SetupRoomTypeView } from "@serene/shared/modules/setup/setup.types";
import {
  type RoomTypeFormValues,
  roomTypeDefaults,
  roomTypeFields,
  roomTypeFormSchema,
} from "../_lib/setupForm";
import { FormReasonField, STATUS_OPTIONS } from "./SetupFields";

export function RoomTypeDialog({
  type,
  onClose,
}: {
  type: SetupRoomTypeView | null;
  onClose: () => void;
}) {
  const property = useProperty();
  const [create, created] = useCreateRoomTypeMutation();
  const [update, updated] = useUpdateRoomTypeMutation();
  const state = type ? updated : created;
  const form = useZodForm(roomTypeFormSchema(type !== null), roomTypeDefaults(type));
  const { control, handleSubmit, setError, setValue, formState } = form;
  const error = toClientApiError(state.error);

  async function submit(values: RoomTypeFormValues) {
    const fields = roomTypeFields(values);
    const result = type
      ? await update({
          propertyId: property.id,
          roomTypeId: type.id,
          body: { ...fields, status: values.status },
        })
      : await create({ propertyId: property.id, body: { ...fields, code: values.code.trim() } });
    if ("data" in result) onClose();
    else applyServerError(setError, toClientApiError(result.error));
  }

  return (
    <FormDialog
      title={type ? `Edit ${type.code} · ${type.name}` : "New room type"}
      description={
        type
          ? "Occupancy limits apply to new bookings and changes. A room type can be retired once it has no rooms in use and no current or upcoming bookings."
          : "Rooms are added to a room type on the Rooms & floors tab; prices come from rate plans."
      }
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel={type ? "Save room type" : "Add room type"}
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <FormTextField
          control={control}
          name="code"
          label="Code"
          maxLength={20}
          disabled={type !== null}
          hint={type ? "The code never changes" : "For example DLX"}
          onChange={(e) => setValue("code", e.target.value.toUpperCase())}
          required
        />
        <FormTextField control={control} name="name" label="Name" maxLength={100} required />
      </div>
      <FormTextField
        control={control}
        name="description"
        label="Description (optional)"
        maxLength={2000}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <FormTextField
          control={control}
          name="maxOccupancy"
          label="Max guests"
          type="number"
          inputMode="numeric"
          min={1}
          max={20}
        />
        <FormTextField
          control={control}
          name="maxAdults"
          label="Max adults"
          type="number"
          inputMode="numeric"
          min={1}
          max={20}
        />
        <FormTextField
          control={control}
          name="maxChildren"
          label="Max children"
          type="number"
          inputMode="numeric"
          min={0}
          max={20}
        />
        <FormTextField
          control={control}
          name="defaultOccupancy"
          label="Usual guests"
          type="number"
          inputMode="numeric"
          min={1}
          max={20}
        />
      </div>
      {type ? (
        <FormSelect control={control} name="status" label="Status" options={STATUS_OPTIONS} />
      ) : null}
      <FormReasonField control={control} />
    </FormDialog>
  );
}
