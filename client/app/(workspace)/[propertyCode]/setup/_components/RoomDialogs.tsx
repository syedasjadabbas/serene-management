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
  useCreateFloorMutation,
  useCreateRoomsMutation,
  useUpdateFloorMutation,
  useUpdateRoomMutation,
} from "@/global/api/endpoints/setupApi";
import { toClientApiError } from "@/global/api/errors";
import type {
  PropertySetupView,
  SetupFloorView,
  SetupRoomView,
} from "@serene/shared/modules/setup/setup.types";
import {
  type AddRoomsFormValues,
  type EditRoomFormValues,
  type FloorFormValues,
  addRoomsDefaults,
  addRoomsFormSchema,
  addRoomsPayload,
  editRoomDefaults,
  editRoomFormSchema,
  floorDefaults,
  floorFields,
  floorFormSchema,
} from "../_lib/setupForm";
import {
  FormCheckboxField,
  FormReasonField,
  STATUS_OPTIONS,
  parseRoomNumbers,
} from "./SetupFields";

export function FloorDialog({
  floor,
  onClose,
}: {
  floor: SetupFloorView | null;
  onClose: () => void;
}) {
  const property = useProperty();
  const [create, created] = useCreateFloorMutation();
  const [update, updated] = useUpdateFloorMutation();
  const state = floor ? updated : created;
  const form = useZodForm(floorFormSchema(floor !== null), floorDefaults(floor));
  const { control, handleSubmit, setError, setValue, formState } = form;
  const error = toClientApiError(state.error);

  async function submit(values: FloorFormValues) {
    const fields = floorFields(values);
    const result = floor
      ? await update({
          propertyId: property.id,
          floorId: floor.id,
          body: { ...fields, status: values.status },
        })
      : await create({ propertyId: property.id, body: { ...fields, code: values.code.trim() } });
    if ("data" in result) onClose();
    else applyServerError(setError, toClientApiError(result.error));
  }

  return (
    <FormDialog
      title={floor ? `Edit ${floor.name}` : "New floor"}
      description={floor ? "A floor can be retired once no room in use is on it." : undefined}
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel={floor ? "Save floor" : "Add floor"}
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <FormTextField
          control={control}
          name="code"
          label="Code"
          maxLength={20}
          disabled={floor !== null}
          hint={floor ? "The code never changes" : "For example F1"}
          onChange={(e) => setValue("code", e.target.value.toUpperCase())}
          required
        />
        <FormTextField control={control} name="name" label="Name" maxLength={100} required />
        <FormTextField
          control={control}
          name="level"
          label="Level"
          type="number"
          inputMode="numeric"
          min={-10}
          max={200}
        />
      </div>
      {floor ? (
        <FormSelect control={control} name="status" label="Status" options={STATUS_OPTIONS} />
      ) : null}
      <FormReasonField control={control} />
    </FormDialog>
  );
}

function typeOptions(setup: PropertySetupView, current?: string) {
  return setup.roomTypes
    .filter((t) => t.status === "ACTIVE" || t.id === current)
    .map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` }));
}

function floorOptions(setup: PropertySetupView, current?: string | null) {
  return [
    { value: "", label: "No floor" },
    ...setup.floors
      .filter((f) => f.status === "ACTIVE" || f.id === current)
      .map((f) => ({ value: f.id, label: f.name })),
  ];
}

export function AddRoomsDialog({
  setup,
  onClose,
}: {
  setup: PropertySetupView;
  onClose: () => void;
}) {
  const property = useProperty();
  const [create, state] = useCreateRoomsMutation();
  const types = typeOptions(setup);
  const form = useZodForm(
    addRoomsFormSchema(parseRoomNumbers),
    addRoomsDefaults(types[0]?.value ?? ""),
  );
  const { control, handleSubmit, setError, watch, formState } = form;
  const error = toClientApiError(state.error);
  const parsed = parseRoomNumbers(watch("numbers"));

  async function submit(values: AddRoomsFormValues) {
    const result = await create({
      propertyId: property.id,
      body: addRoomsPayload(values, parseRoomNumbers(values.numbers).numbers),
    });
    if ("data" in result) onClose();
    else applyServerError(setError, toClientApiError(result.error));
  }

  return (
    <FormDialog
      title="Add rooms"
      description="The rooms are sellable from the business date on. Rooms that should not be sold yet can be placed out of order on the room board."
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel={parsed.numbers.length > 1 ? `Add ${parsed.numbers.length} rooms` : "Add room"}
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <FormTextField
        control={control}
        name="numbers"
        label="Room numbers"
        hint={
          parsed.error ??
          (parsed.numbers.length > 0
            ? `${parsed.numbers.length} room${parsed.numbers.length === 1 ? "" : "s"}: ${parsed.numbers.slice(0, 6).join(", ")}${parsed.numbers.length > 6 ? " …" : ""}`
            : "One number, a list or ranges, for example 101-120, 125")
        }
        required
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormSelect control={control} name="roomTypeId" label="Room type" options={types} />
        <FormSelect control={control} name="floorId" label="Floor" options={floorOptions(setup)} />
      </div>
      <FormSelect
        control={control}
        name="housekeepingStatus"
        label="Housekeeping status to start with"
        options={[
          { value: "INSPECTED", label: "Inspected (ready to sell)" },
          { value: "CLEAN", label: "Clean (needs inspection)" },
          { value: "DIRTY", label: "Dirty (needs cleaning)" },
        ]}
      />
      <div className="flex flex-wrap gap-x-6">
        <FormCheckboxField control={control} name="isAccessible">
          Accessible room
        </FormCheckboxField>
        <FormCheckboxField control={control} name="isSmoking">
          Smoking room
        </FormCheckboxField>
      </div>
      <FormReasonField control={control} />
    </FormDialog>
  );
}

export function EditRoomDialog({
  setup,
  room,
  onClose,
}: {
  setup: PropertySetupView;
  room: SetupRoomView;
  onClose: () => void;
}) {
  const property = useProperty();
  const [update, state] = useUpdateRoomMutation();
  const form = useZodForm(editRoomFormSchema, editRoomDefaults(room));
  const { control, handleSubmit, setError, setValue, formState } = form;
  const error = toClientApiError(state.error);

  async function submit(values: EditRoomFormValues) {
    const result = await update({
      propertyId: property.id,
      roomId: room.id,
      body: {
        number: values.number.trim(),
        roomTypeId: values.roomTypeId,
        floorId: values.floorId || null,
        description: room.description ?? undefined,
        isAccessible: values.isAccessible,
        isSmoking: values.isSmoking,
        status: values.status,
        version: room.version,
        reason: values.reason.trim(),
      },
    });
    if ("data" in result) onClose();
    else applyServerError(setError, toClientApiError(result.error));
  }

  return (
    <FormDialog
      title={`Edit room ${room.number}`}
      description="A room can change type or be retired only while no guest is in it and no current or upcoming reservation is assigned to it."
      onClose={onClose}
      onSubmit={handleSubmit(submit)}
      submitLabel="Save room"
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <FormTextField
          control={control}
          name="number"
          label="Room number"
          maxLength={20}
          onChange={(e) => setValue("number", e.target.value.toUpperCase())}
          required
        />
        <FormSelect
          control={control}
          name="roomTypeId"
          label="Room type"
          options={typeOptions(setup, room.roomTypeId)}
        />
        <FormSelect
          control={control}
          name="floorId"
          label="Floor"
          options={floorOptions(setup, room.floorId)}
        />
      </div>
      <div className="flex flex-wrap gap-x-6">
        <FormCheckboxField control={control} name="isAccessible">
          Accessible room
        </FormCheckboxField>
        <FormCheckboxField control={control} name="isSmoking">
          Smoking room
        </FormCheckboxField>
      </div>
      <FormSelect control={control} name="status" label="Status" options={STATUS_OPTIONS} />
      <FormReasonField control={control} />
    </FormDialog>
  );
}
