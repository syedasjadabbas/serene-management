"use client";

import { useEffect, useState } from "react";
import {
  FormCheckbox,
  FormSelect,
  FormTextArea,
  FormTextField,
  applyServerError,
  useZodForm,
} from "@/global/components/ui/form";
import { FormDialog } from "@/global/components/ui/FormDialog";
import { useProperty } from "@/global/hooks/useProperty";
import {
  useChangeBlockStatusMutation,
  useCreateBlockMutation,
  useGroupOptionsQuery,
  useReleaseBlockMutation,
  useSetAllocationMutation,
} from "@/global/api/endpoints/groupsApi";
import { toClientApiError } from "@/global/api/errors";
import { addDays } from "@serene/shared/modules/business-date/business-date.policy";
import type { BlockView, GroupDetail } from "@serene/shared/modules/groups/groups.types";
import { randomId } from "@serene/shared/lib/utils/random-id";
import { DigitsField } from "../../_components/DigitsField";
import {
  allocationBody,
  allocationDefaults,
  allocationFormSchema,
  blockStatusDefaults,
  blockStatusFormSchema,
  newBlockBody,
  newBlockDefaults,
  newBlockFormSchema,
  releaseBody,
  releaseDefaults,
  releaseFormSchema,
  renameServerFields,
} from "../../_lib/groupForms";
import { OverrideField } from "./OverrideField";

const OVERBOOK_LABEL = "Hold beyond house availability (overbook, audited)";

export function NewBlockDialog({ group, onClose }: { group: GroupDetail; onClose: () => void }) {
  const property = useProperty();
  const options = useGroupOptionsQuery(property.id);
  const [create, state] = useCreateBlockMutation();
  const start0 = group.businessDate ?? options.data?.businessDate ?? "";
  const { control, handleSubmit, setError, setValue, getValues, watch, formState } = useZodForm(
    newBlockFormSchema,
    newBlockDefaults(start0),
  );
  const override = watch("override");
  const roomsError = (formState.errors.rooms as { message?: string } | undefined)?.message;
  const error = toClientApiError(state.error);
  const data = options.data;
  const defaultStatusId = data?.statuses.find((s) => s.isDefault)?.id ?? "";

  // The block's default status is preselected once the options arrive.
  useEffect(() => {
    if (defaultStatusId && !getValues("statusId")) setValue("statusId", defaultStatusId);
  }, [defaultStatusId, getValues, setValue]);

  return (
    <FormDialog
      title="New block"
      description="Rooms held per night for each room type. A definite block takes them out of house availability."
      size="lg"
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const result = await create({
          propertyId: property.id,
          groupId: group.id,
          body: newBlockBody(values),
        });
        if ("data" in result) onClose();
        else
          applyServerError(
            setError,
            renameServerFields(toClientApiError(result.error), { allocations: "rooms" }),
          );
      })}
      submitLabel="Create block"
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormTextField
          control={control}
          name="code"
          label="Code"
          maxLength={20}
          onChange={(e) => setValue("code", e.target.value.toUpperCase())}
        />
        <FormTextField control={control} name="name" label="Name" maxLength={200} />
        <FormSelect
          control={control}
          name="statusId"
          label="Status"
          options={(data?.statuses ?? []).map((s) => ({
            value: s.id,
            label: `${s.name} (${s.code})`,
          }))}
        />
        <FormSelect
          control={control}
          name="ratePlanId"
          label="Rate plan"
          placeholder="Choose a rate plan"
          options={(data?.ratePlans ?? []).map((p) => ({
            value: p.id,
            label: `${p.code} · ${p.name}`,
          }))}
        />
        <FormTextField control={control} name="startDate" label="First night" type="date" />
        <FormTextField control={control} name="endDate" label="Departure" type="date" />
        <FormTextField
          control={control}
          name="cutoffDate"
          label="Cutoff date (optional)"
          type="date"
        />
        <FormCheckbox
          control={control}
          name="isElastic"
          className="flex min-h-11 items-center gap-2 self-end text-sm"
          label="Elastic (pickup may exceed the block from house availability)"
        />
      </div>
      <fieldset className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
        <legend className="px-1 text-sm">Rooms per night</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {(data?.roomTypes ?? []).map((rt) => (
            <DigitsField
              key={rt.id}
              control={control}
              name={`rooms.${rt.id}`}
              label={`${rt.code} · ${rt.name}`}
              placeholder="0"
            />
          ))}
        </div>
        {roomsError ? <p className="text-sm text-danger">{roomsError}</p> : null}
      </fieldset>
      <OverrideField control={control} label={OVERBOOK_LABEL} />
      {override ? (
        <FormTextArea control={control} name="reason" label="Reason (audited)" maxLength={1000} />
      ) : null}
    </FormDialog>
  );
}

export function AllocationDialog({ block, onClose }: { block: BlockView; onClose: () => void }) {
  const property = useProperty();
  const [save, state] = useSetAllocationMutation();
  const lastNight = addDays(block.endDate, -1);
  const { control, handleSubmit, setError, watch, formState } = useZodForm(
    allocationFormSchema,
    allocationDefaults(block.roomTypes[0]?.roomType.id ?? "", block.startDate, block.endDate),
  );
  const override = watch("override");
  const error = toClientApiError(state.error);
  const options = useGroupOptionsQuery(property.id);
  const roomTypes = options.data?.roomTypes ?? block.roomTypes.map((rt) => rt.roomType);

  return (
    <FormDialog
      title={`Allocation · ${block.code}`}
      description="Sets the rooms held on each night in the range. It cannot go below the rooms already picked up."
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const result = await save({
          propertyId: property.id,
          blockId: block.id,
          body: allocationBody(values, block.version),
        });
        if ("data" in result) onClose();
        else applyServerError(setError, toClientApiError(result.error));
      })}
      submitLabel="Save allocation"
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormSelect
          control={control}
          name="roomTypeId"
          label="Room type"
          options={roomTypes.map((rt) => ({ value: rt.id, label: `${rt.code} · ${rt.name}` }))}
        />
        <DigitsField control={control} name="rooms" label="Rooms per night" />
        <FormTextField
          control={control}
          name="from"
          label="From night"
          type="date"
          min={block.startDate}
          max={lastNight}
        />
        <FormTextField
          control={control}
          name="to"
          label="To night"
          type="date"
          min={block.startDate}
          max={lastNight}
        />
      </div>
      <OverrideField control={control} label={OVERBOOK_LABEL} />
      {override ? (
        <FormTextArea control={control} name="reason" label="Reason (audited)" maxLength={1000} />
      ) : null}
    </FormDialog>
  );
}

export function BlockStatusDialog({ block, onClose }: { block: BlockView; onClose: () => void }) {
  const property = useProperty();
  const options = useGroupOptionsQuery(property.id);
  const [save, state] = useChangeBlockStatusMutation();
  const { control, handleSubmit, setError, watch, formState } = useZodForm(
    blockStatusFormSchema,
    blockStatusDefaults,
  );
  const [statusId, override] = watch(["statusId", "override"]);
  const error = toClientApiError(state.error);
  const choices = (options.data?.statuses ?? []).filter((s) => s.id !== block.status.id);
  const target = choices.find((s) => s.id === statusId);

  return (
    <FormDialog
      title={`Block status · ${block.code}`}
      description={`Currently ${block.status.name}. Definite blocks hold inventory; a block with active pickups cannot leave definite.`}
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const result = await save({
          propertyId: property.id,
          blockId: block.id,
          body: {
            version: block.version,
            statusId: values.statusId,
            override: values.override,
            reason: values.reason.trim() || undefined,
          },
        });
        if ("data" in result) onClose();
        else applyServerError(setError, toClientApiError(result.error));
      })}
      submitLabel="Change status"
      danger={target?.type === "CANCEL"}
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <FormSelect
        control={control}
        name="statusId"
        label="New status"
        placeholder="Choose a status"
        options={choices.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
      />
      {target?.type === "DEDUCT" ? (
        <OverrideField control={control} label={OVERBOOK_LABEL} />
      ) : null}
      <FormTextArea
        control={control}
        name="reason"
        label={override ? "Reason (audited)" : "Reason (optional)"}
        maxLength={1000}
      />
    </FormDialog>
  );
}

export function ReleaseDialog({ block, onClose }: { block: BlockView; onClose: () => void }) {
  const property = useProperty();
  const [release, state] = useReleaseBlockMutation();
  // One key per dialog: a retried submit replays instead of releasing twice.
  const [idempotencyKey] = useState(randomId);
  const lastNight = addDays(block.endDate, -1);
  const { control, handleSubmit, setError, formState } = useZodForm(
    releaseFormSchema,
    releaseDefaults(block.startDate, block.endDate),
  );
  const [done, setDone] = useState<number | null>(null);
  const error = toClientApiError(state.error);

  if (done !== null) {
    return (
      <FormDialog
        title="Rooms released"
        onClose={onClose}
        onSubmit={onClose}
        submitLabel="Done"
        pending={false}
        error={null}
      >
        <p className="text-sm">
          {done} room-night{done === 1 ? "" : "s"} returned to house availability.
        </p>
      </FormDialog>
    );
  }
  return (
    <FormDialog
      title={`Release rooms · ${block.code}`}
      description="Returns rooms the block still holds (not picked up) to house availability. Picked-up rooms are never released."
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const result = await release({
          propertyId: property.id,
          blockId: block.id,
          idempotencyKey,
          body: releaseBody(values, block.version),
        });
        if ("data" in result && result.data) setDone(result.data.released);
        else if ("error" in result) applyServerError(setError, toClientApiError(result.error));
      })}
      submitLabel="Release"
      danger
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <FormSelect
          control={control}
          name="roomTypeId"
          label="Room type"
          placeholder="All room types"
          options={block.roomTypes.map((rt) => ({
            value: rt.roomType.id,
            label: rt.roomType.code,
          }))}
        />
        <FormTextField
          control={control}
          name="from"
          label="From night"
          type="date"
          min={block.startDate}
          max={lastNight}
        />
        <FormTextField
          control={control}
          name="to"
          label="To night"
          type="date"
          min={block.startDate}
          max={lastNight}
        />
      </div>
      <FormTextArea control={control} name="reason" label="Reason (audited)" maxLength={1000} />
    </FormDialog>
  );
}
