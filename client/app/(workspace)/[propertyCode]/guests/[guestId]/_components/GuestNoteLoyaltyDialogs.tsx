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
import { useProperty } from "@/global/hooks/useProperty";
import { useAddGuestNoteMutation, useEnrollGuestMutation } from "@/global/api/endpoints/guestsApi";
import {
  useAdjustPointsMutation,
  useChangeMembershipMutation,
  useLoyaltyOverviewQuery,
} from "@/global/api/endpoints/loyaltyApi";
import { toClientApiError } from "@/global/api/errors";
import type {
  GuestProfileView,
  LoyaltyMembershipView,
} from "@serene/shared/modules/guests/guests.types";
import {
  enrollFormSchema,
  enrollPayload,
  membershipFormSchema,
  membershipPayload,
  noteFormSchema,
  notePayload,
  pointsFormSchema,
} from "../_lib/guestDialogForms";

export function NoteDialog({ guest, onClose }: { guest: GuestProfileView; onClose: () => void }) {
  const property = useProperty();
  const [add, state] = useAddGuestNoteMutation();
  // Notes for every property need organization scope (D54); default to this property.
  const { control, handleSubmit, setError, formState } = useZodForm(noteFormSchema, {
    body: "",
    visibility: "ALL_STAFF" as "ALL_STAFF" | "MANAGEMENT" | "INTERNAL",
    isAlert: false,
    scope: guest.access.addGlobalNote ? "" : property.id,
  });
  return (
    <FormDialog
      title="Add note"
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const result = await add({ guestId: guest.id, body: notePayload(values) });
        if ("data" in result) onClose();
        else applyServerError(setError, toClientApiError(result.error));
      })}
      submitLabel="Add note"
      pending={state.isLoading || formState.isSubmitting}
      error={toClientApiError(state.error)}
    >
      <FormTextArea control={control} name="body" label="Note" maxLength={4000} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormSelect
          control={control}
          name="visibility"
          label="Visible to"
          options={[
            { value: "ALL_STAFF", label: "All staff" },
            ...(guest.access.readSensitive
              ? [
                  { value: "MANAGEMENT", label: "Management only" },
                  { value: "INTERNAL", label: "Internal (restricted)" },
                ]
              : []),
          ]}
        />
        <FormSelect
          control={control}
          name="scope"
          label="Applies to"
          options={[
            ...(guest.access.addGlobalNote ? [{ value: "", label: "Every property" }] : []),
            { value: property.id, label: `Only ${property.code}` },
          ]}
        />
      </div>
      <FormCheckbox
        control={control}
        name="isAlert"
        className="flex min-h-11 items-center gap-2 text-sm"
        label="Show as an alert when the guest's reservations are opened"
      />
    </FormDialog>
  );
}

export function EnrollDialog({ guest, onClose }: { guest: GuestProfileView; onClose: () => void }) {
  const overview = useLoyaltyOverviewQuery();
  const [enroll, state] = useEnrollGuestMutation();
  const enrolled = new Set((guest.loyalty ?? []).map((m) => m.program.id));
  const programs = (overview.data?.programs ?? []).filter(
    (p) => p.status === "ACTIVE" && !enrolled.has(p.id),
  );
  const isExternal = (id: string) => !!programs.find((p) => p.id === id)?.isExternal;
  const { control, handleSubmit, setError, setValue, watch, formState } = useZodForm(
    enrollFormSchema(isExternal),
    { programId: "", tierId: "", number: "", reason: "" },
  );
  const programId = watch("programId");
  const program = programs.find((p) => p.id === programId);
  return (
    <FormDialog
      title={`Enroll ${guest.fullName}`}
      description="One membership per program. High-risk: the reason is audited."
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const result = await enroll({
          guestId: guest.id,
          body: enrollPayload(values, !!program?.isExternal),
        });
        if ("data" in result) onClose();
        else applyServerError(setError, toClientApiError(result.error), ["membershipNumber"]);
      })}
      submitLabel="Enroll"
      pending={state.isLoading || formState.isSubmitting}
      error={toClientApiError(state.error)}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormSelect
          control={control}
          name="programId"
          label="Program"
          placeholder={programs.length ? "Choose a program" : "No program to join"}
          options={programs.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
          onChange={() => setValue("tierId", "")}
        />
        {guest.access.manageLoyalty ? (
          <FormSelect
            control={control}
            name="tierId"
            label="Tier"
            placeholder="No tier"
            options={(program?.tiers ?? [])
              .filter((t) => t.status === "ACTIVE")
              .map((t) => ({ value: t.id, label: t.name }))}
          />
        ) : null}
        {program?.isExternal ? (
          <FormTextField control={control} name="number" label="Membership number" />
        ) : null}
      </div>
      <FormTextArea control={control} name="reason" label="Reason (audited)" maxLength={500} />
    </FormDialog>
  );
}

export function MembershipDialog({
  guest,
  membership,
  onClose,
}: {
  guest: GuestProfileView;
  membership: LoyaltyMembershipView;
  onClose: () => void;
}) {
  const overview = useLoyaltyOverviewQuery();
  const [change, state] = useChangeMembershipMutation();
  const tiers = overview.data?.programs.find((p) => p.id === membership.program.id)?.tiers ?? [];
  const original = {
    tierId: membership.tier?.id ?? null,
    status: membership.status,
    version: membership.version,
  };
  const { control, handleSubmit, setError, formState } = useZodForm(
    membershipFormSchema(original),
    { tierId: membership.tier?.id ?? "", status: membership.status, reason: "" },
  );
  return (
    <FormDialog
      title={`${membership.program.name} · ${membership.membershipNumber}`}
      description="Tier and status changes are kept in the membership history."
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const result = await change({
          membershipId: membership.id,
          guestId: guest.id,
          body: membershipPayload(values, original),
        });
        if ("data" in result) onClose();
        else applyServerError(setError, toClientApiError(result.error));
      })}
      submitLabel="Save"
      pending={state.isLoading || formState.isSubmitting}
      error={toClientApiError(state.error)}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormSelect
          control={control}
          name="tierId"
          label="Tier"
          placeholder="No tier"
          options={tiers
            .filter((t) => t.status === "ACTIVE" || t.id === membership.tier?.id)
            .map((t) => ({ value: t.id, label: t.name }))}
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
      <FormTextArea control={control} name="reason" label="Reason (audited)" maxLength={500} />
    </FormDialog>
  );
}

export function PointsDialog({
  guest,
  membership,
  onClose,
}: {
  guest: GuestProfileView;
  membership: LoyaltyMembershipView;
  onClose: () => void;
}) {
  const [adjust, state] = useAdjustPointsMutation();
  const { control, handleSubmit, setError, setValue, formState } = useZodForm(pointsFormSchema, {
    points: "",
    description: "",
    reason: "",
  });
  return (
    <FormDialog
      title="Adjust points"
      description={`Balance ${membership.pointsBalance} points. Whole points; use a minus sign to deduct.`}
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const result = await adjust({
          membershipId: membership.id,
          guestId: guest.id,
          body: { version: membership.version, ...values },
        });
        if ("data" in result) onClose();
        else applyServerError(setError, toClientApiError(result.error));
      })}
      submitLabel="Adjust"
      pending={state.isLoading || formState.isSubmitting}
      error={toClientApiError(state.error)}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormTextField
          control={control}
          name="points"
          label="Points (±)"
          inputMode="numeric"
          onChange={(e) => setValue("points", e.target.value.replace(/[^\d-]/g, ""))}
        />
        <FormTextField control={control} name="description" label="Description" maxLength={200} />
      </div>
      <FormTextArea control={control} name="reason" label="Reason (audited)" maxLength={500} />
    </FormDialog>
  );
}
