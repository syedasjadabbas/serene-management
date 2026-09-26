"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormDialog } from "@/components/ui/FormDialog";
import { Select } from "@/components/ui/Select";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { useProperty } from "@/hooks/useProperty";
import {
  useAddGuestNoteMutation,
  useEnrollGuestMutation,
  useGuestOptionsQuery,
  useSetGuestPreferencesMutation,
  useUpdateGuestMutation,
} from "@/lib/api/endpoints/guests.api";
import {
  useAdjustPointsMutation,
  useChangeMembershipMutation,
  useLoyaltyOverviewQuery,
} from "@/lib/api/endpoints/loyalty.api";
import { toClientApiError } from "@/lib/api/errors";
import { ADDRESS_TYPES, CONTACT_TYPES } from "@/modules/guests/guests.schema";
import type {
  GuestAddressView,
  GuestContactView,
  GuestProfileView,
  LoyaltyMembershipView,
} from "@/modules/guests/guests.types";

const label = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace("_", " ");

type ContactRow = Pick<GuestContactView, "type" | "value" | "isPrimary" | "optIn">;
type AddressRow = Omit<GuestAddressView, "id">;

export function EditProfileDialog({
  guest,
  onClose,
}: {
  guest: GuestProfileView;
  onClose: () => void;
}) {
  const options = useGuestOptionsQuery();
  const [update, state] = useUpdateGuestMutation();
  const [form, setForm] = useState({
    title: guest.title ?? "",
    firstName: guest.firstName,
    middleName: guest.middleName ?? "",
    lastName: guest.lastName,
    preferredName: guest.preferredName ?? "",
    gender: guest.gender ?? "",
    dateOfBirth: guest.dateOfBirth ?? "",
    email: guest.email ?? "",
    phone: guest.phone ?? "",
    preferredContact: guest.preferredContact ?? "",
    nationalityCode: guest.nationalityCode ?? "",
    languageCode: guest.languageCode ?? "",
    vipLevelId: guest.vipLevelId ?? "",
    marketingOptIn: guest.marketingOptIn,
    status: guest.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    isRestricted: guest.isRestricted,
    restrictionReason: guest.restrictionReason ?? "",
    reason: "",
  });
  const [contacts, setContacts] = useState<ContactRow[]>(
    guest.contacts.map(({ type, value, isPrimary, optIn }) => ({ type, value, isPrimary, optIn })),
  );
  const [addresses, setAddresses] = useState<AddressRow[]>(
    guest.addresses.map(({ id: _id, ...rest }) => rest),
  );
  const error = toClientApiError(state.error);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const statusChange = form.status !== (guest.status === "INACTIVE" ? "INACTIVE" : "ACTIVE");
  const restrictionChange = form.isRestricted !== guest.isRestricted;
  const needsReason = statusChange || restrictionChange;

  return (
    <FormDialog
      title={`Edit ${guest.fullName}`}
      description="Changes are audited. The profile is shared by every property."
      onClose={onClose}
      onSubmit={async () => {
        const result = await update({
          guestId: guest.id,
          body: {
            version: guest.version,
            title: form.title,
            firstName: form.firstName,
            middleName: form.middleName,
            lastName: form.lastName,
            preferredName: form.preferredName,
            gender: form.gender,
            ...(guest.access.readSensitive && form.dateOfBirth !== (guest.dateOfBirth ?? "")
              ? { dateOfBirth: form.dateOfBirth || null }
              : {}),
            email: form.email,
            phone: form.phone,
            preferredContact: (form.preferredContact || null) as GuestContactView["type"] | null,
            nationalityCode: form.nationalityCode || null,
            languageCode: form.languageCode,
            vipLevelId: form.vipLevelId || null,
            marketingOptIn: form.marketingOptIn,
            ...(statusChange ? { status: form.status as "ACTIVE" | "INACTIVE" } : {}),
            ...(restrictionChange
              ? {
                  isRestricted: form.isRestricted,
                  restrictionReason: form.isRestricted ? form.restrictionReason : null,
                }
              : form.isRestricted && form.restrictionReason !== (guest.restrictionReason ?? "")
                ? { restrictionReason: form.restrictionReason }
                : {}),
            contacts,
            addresses: addresses.map((a) => ({ ...a, countryCode: a.countryCode || null })),
            ...(form.reason.trim() ? { reason: form.reason.trim() } : {}),
          },
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Save profile"
      disabled={
        !form.firstName.trim() ||
        !form.lastName.trim() ||
        (needsReason && form.reason.trim().length < 3) ||
        (form.isRestricted && !form.restrictionReason.trim())
      }
      pending={state.isLoading}
      error={error}
      size="lg"
    >
      <div className="grid gap-3 sm:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)]">
        <TextField label="Title" value={form.title} onChange={set("title")} maxLength={20} />
        <TextField
          label="First name"
          value={form.firstName}
          onChange={set("firstName")}
          maxLength={100}
        />
        <TextField
          label="Last name"
          value={form.lastName}
          onChange={set("lastName")}
          maxLength={100}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          label="Middle name"
          value={form.middleName}
          onChange={set("middleName")}
          maxLength={100}
        />
        <TextField
          label="Preferred name"
          value={form.preferredName}
          onChange={set("preferredName")}
          maxLength={100}
        />
        <TextField label="Gender" value={form.gender} onChange={set("gender")} maxLength={20} />
        <TextField
          label="E-mail"
          type="email"
          value={form.email}
          onChange={set("email")}
          errors={error?.fieldErrors.email}
        />
        <TextField
          label="Phone"
          inputMode="tel"
          value={form.phone}
          onChange={set("phone")}
          errors={error?.fieldErrors.phone}
        />
        <Select
          label="Preferred contact"
          placeholder="Not set"
          options={CONTACT_TYPES.map((t) => ({ value: t, label: label(t) }))}
          value={form.preferredContact}
          onChange={set("preferredContact")}
        />
        <TextField
          label="Nationality (2 letters)"
          value={form.nationalityCode}
          onChange={(e) =>
            setForm((f) => ({ ...f, nationalityCode: e.target.value.toUpperCase() }))
          }
          maxLength={2}
          errors={error?.fieldErrors.nationalityCode}
        />
        <TextField
          label="Language"
          value={form.languageCode}
          onChange={set("languageCode")}
          maxLength={10}
        />
        <Select
          label="VIP level"
          placeholder="None"
          options={(options.data?.vipLevels ?? []).map((v) => ({ value: v.id, label: v.name }))}
          value={form.vipLevelId}
          onChange={set("vipLevelId")}
        />
        {guest.access.readSensitive ? (
          <TextField
            label="Date of birth (sensitive)"
            type="date"
            value={form.dateOfBirth}
            onChange={set("dateOfBirth")}
            errors={error?.fieldErrors.dateOfBirth}
          />
        ) : null}
        <Select
          label="Status"
          options={[
            { value: "ACTIVE", label: "Active" },
            { value: "INACTIVE", label: "Inactive" },
          ]}
          value={form.status}
          onChange={set("status")}
        />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.marketingOptIn}
          onChange={(e) => setForm((f) => ({ ...f, marketingOptIn: e.target.checked }))}
        />
        Agrees to marketing communication
      </label>

      <fieldset className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
        <legend className="px-1 text-sm">Additional contacts</legend>
        {contacts.map((c, i) => (
          <div
            key={i}
            className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-end gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto_auto]"
          >
            <Select
              label="Type"
              options={CONTACT_TYPES.map((t) => ({ value: t, label: label(t) }))}
              value={c.type}
              onChange={(e) =>
                setContacts((list) =>
                  list.map((x, j) =>
                    j === i ? { ...x, type: e.target.value as ContactRow["type"] } : x,
                  ),
                )
              }
            />
            <TextField
              label="Value"
              value={c.value}
              onChange={(e) =>
                setContacts((list) =>
                  list.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                )
              }
            />
            <label className="flex min-h-11 items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={c.isPrimary}
                onChange={(e) =>
                  setContacts((list) =>
                    list.map((x, j) => (j === i ? { ...x, isPrimary: e.target.checked } : x)),
                  )
                }
              />
              Primary
            </label>
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11 md:min-h-0"
              onClick={() => setContacts((list) => list.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
        ))}
        {error?.fieldErrors.contacts ? (
          <p className="text-sm text-danger">{error.fieldErrors.contacts.join(" ")}</p>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          className="min-h-11 self-start md:min-h-0"
          onClick={() =>
            setContacts((list) => [
              ...list,
              { type: "MOBILE", value: "", isPrimary: false, optIn: false },
            ])
          }
          disabled={contacts.length >= 20}
        >
          Add contact
        </Button>
      </fieldset>

      <fieldset className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
        <legend className="px-1 text-sm">Addresses</legend>
        {addresses.map((ad, i) => {
          const upd = (patch: Partial<AddressRow>) =>
            setAddresses((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <div key={i} className="grid gap-2 border-b border-border-subtle pb-2 sm:grid-cols-4">
              <Select
                label="Type"
                options={ADDRESS_TYPES.map((t) => ({ value: t, label: label(t) }))}
                value={ad.type}
                onChange={(e) => upd({ type: e.target.value as AddressRow["type"] })}
              />
              <TextField
                label="Line 1"
                value={ad.line1}
                onChange={(e) => upd({ line1: e.target.value })}
                className="sm:col-span-3"
              />
              <TextField
                label="City"
                value={ad.city ?? ""}
                onChange={(e) => upd({ city: e.target.value })}
              />
              <TextField
                label="Postal code"
                value={ad.postalCode ?? ""}
                onChange={(e) => upd({ postalCode: e.target.value })}
              />
              <TextField
                label="Country"
                value={ad.countryCode ?? ""}
                maxLength={2}
                onChange={(e) => upd({ countryCode: e.target.value.toUpperCase() })}
              />
              <div className="flex items-end gap-2">
                <label className="flex min-h-11 items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={ad.isPrimary}
                    onChange={(e) => upd({ isPrimary: e.target.checked })}
                  />
                  Primary
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-11 md:min-h-0"
                  onClick={() => setAddresses((list) => list.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
            </div>
          );
        })}
        {error?.fieldErrors.addresses ? (
          <p className="text-sm text-danger">{error.fieldErrors.addresses.join(" ")}</p>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          className="min-h-11 self-start md:min-h-0"
          onClick={() =>
            setAddresses((list) => [
              ...list,
              {
                type: "HOME",
                line1: "",
                line2: null,
                city: null,
                region: null,
                postalCode: null,
                countryCode: null,
                isPrimary: list.length === 0,
              },
            ])
          }
          disabled={addresses.length >= 10}
        >
          Add address
        </Button>
      </fieldset>

      <fieldset className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
        <legend className="px-1 text-sm">Restriction</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isRestricted}
            onChange={(e) => setForm((f) => ({ ...f, isRestricted: e.target.checked }))}
          />
          Restrict this profile from booking (high-risk, audited)
        </label>
        {form.isRestricted ? (
          <TextField
            label="Why is the profile restricted?"
            value={form.restrictionReason}
            onChange={set("restrictionReason")}
            maxLength={500}
            errors={error?.fieldErrors.restrictionReason}
          />
        ) : null}
      </fieldset>
      <TextArea
        label={needsReason ? "Reason for the change (required)" : "Reason (optional)"}
        value={form.reason}
        onChange={set("reason")}
        maxLength={1000}
        errors={error?.fieldErrors.reason}
      />
    </FormDialog>
  );
}

export function PreferencesDialog({
  guest,
  onClose,
}: {
  guest: GuestProfileView;
  onClose: () => void;
}) {
  const property = useProperty();
  const options = useGuestOptionsQuery();
  const [save, state] = useSetGuestPreferencesMutation();
  // Preferences the caller manages: global and this property's.
  const [rows, setRows] = useState(
    guest.preferences
      .filter((p) => p.property === null || p.property.id === property.id)
      .map((p) => ({
        preferenceCodeId: p.preferenceCode.id,
        propertyId: p.property?.id ?? null,
        note: p.note ?? "",
      })),
  );
  // Preferences for every property need an organization-level grant (D3);
  // without it they are shown read-only and sent back unchanged.
  const manageGlobal = guest.access.manageGlobalPreferences;
  const codes = options.data?.preferenceCodes ?? [];
  const groups = [...new Set(codes.map((c) => c.groupCode))];
  const selected = (id: string) => rows.find((r) => r.preferenceCodeId === id);
  const toggle = (id: string, on: boolean) =>
    setRows((list) =>
      on
        ? [
            ...list,
            { preferenceCodeId: id, propertyId: manageGlobal ? null : property.id, note: "" },
          ]
        : list.filter((r) => r.preferenceCodeId !== id),
    );
  const patch = (id: string, value: Partial<(typeof rows)[number]>) =>
    setRows((list) => list.map((r) => (r.preferenceCodeId === id ? { ...r, ...value } : r)));
  return (
    <FormDialog
      title="Preferences"
      description={
        manageGlobal
          ? `Apply to every property or only ${property.code}. Changes are audited.`
          : `Set preferences for ${property.code}. Preferences for every property are managed at organization level. Changes are audited.`
      }
      onClose={onClose}
      onSubmit={async () => {
        const result = await save({
          guestId: guest.id,
          body: {
            version: guest.version,
            preferences: rows.map((r) => ({ ...r, note: r.note.trim() || null })),
          },
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Save preferences"
      pending={state.isLoading}
      error={toClientApiError(state.error)}
      size="lg"
    >
      {groups.map((group) => (
        <fieldset key={group} className="flex flex-col gap-1">
          <legend className="text-xs font-medium text-fg-secondary">{label(group)}</legend>
          {codes
            .filter((c) => c.groupCode === group)
            .map((code) => {
              const row = selected(code.id);
              const locked = !manageGlobal && row?.propertyId === null;
              return (
                <div key={code.id} className="flex flex-wrap items-center gap-2">
                  <label className="flex min-h-11 min-w-44 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!row}
                      disabled={locked}
                      onChange={(e) => toggle(code.id, e.target.checked)}
                    />
                    {code.name}
                  </label>
                  {row && locked ? (
                    <span className="text-xs text-fg-muted">
                      Every property{row.note ? ` · ${row.note}` : ""}
                    </span>
                  ) : row ? (
                    <>
                      <Select
                        label="Applies to"
                        options={[
                          ...(manageGlobal ? [{ value: "", label: "Every property" }] : []),
                          { value: property.id, label: `Only ${property.code}` },
                        ]}
                        value={row.propertyId ?? ""}
                        onChange={(e) => patch(code.id, { propertyId: e.target.value || null })}
                      />
                      <TextField
                        label="Note"
                        value={row.note}
                        maxLength={500}
                        onChange={(e) => patch(code.id, { note: e.target.value })}
                        className="min-w-0 flex-1 basis-40"
                      />
                    </>
                  ) : null}
                </div>
              );
            })}
        </fieldset>
      ))}
      {codes.length === 0 ? (
        <p className="text-sm text-fg-secondary">No preference catalog configured.</p>
      ) : null}
    </FormDialog>
  );
}

export function NoteDialog({ guest, onClose }: { guest: GuestProfileView; onClose: () => void }) {
  const property = useProperty();
  const [add, state] = useAddGuestNoteMutation();
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"ALL_STAFF" | "MANAGEMENT" | "INTERNAL">(
    "ALL_STAFF",
  );
  const [isAlert, setIsAlert] = useState(false);
  const [scope, setScope] = useState("");
  return (
    <FormDialog
      title="Add note"
      onClose={onClose}
      onSubmit={async () => {
        const result = await add({
          guestId: guest.id,
          body: { body: body.trim(), visibility, isAlert, propertyId: scope || null },
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Add note"
      disabled={!body.trim()}
      pending={state.isLoading}
      error={toClientApiError(state.error)}
    >
      <TextArea
        label="Note"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={4000}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
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
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as typeof visibility)}
        />
        <Select
          label="Applies to"
          options={[
            { value: "", label: "Every property" },
            { value: property.id, label: `Only ${property.code}` },
          ]}
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={isAlert} onChange={(e) => setIsAlert(e.target.checked)} />
        Show as an alert when the guest&apos;s reservations are opened
      </label>
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
  const [programId, setProgramId] = useState("");
  const [tierId, setTierId] = useState("");
  const [number, setNumber] = useState("");
  const [reason, setReason] = useState("");
  const program = programs.find((p) => p.id === programId);
  const error = toClientApiError(state.error);
  return (
    <FormDialog
      title={`Enroll ${guest.fullName}`}
      description="One membership per program. High-risk: the reason is audited."
      onClose={onClose}
      onSubmit={async () => {
        const result = await enroll({
          guestId: guest.id,
          body: {
            programId,
            tierId: tierId || null,
            ...(program?.isExternal ? { membershipNumber: number.trim().toUpperCase() } : {}),
            reason: reason.trim(),
          },
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Enroll"
      disabled={!programId || reason.trim().length < 3 || (!!program?.isExternal && !number.trim())}
      pending={state.isLoading}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Program"
          placeholder={programs.length ? "Choose a program" : "No program to join"}
          options={programs.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
          value={programId}
          onChange={(e) => {
            setProgramId(e.target.value);
            setTierId("");
          }}
        />
        <Select
          label="Tier"
          placeholder="No tier"
          options={(program?.tiers ?? [])
            .filter((t) => t.status === "ACTIVE")
            .map((t) => ({ value: t.id, label: t.name }))}
          value={tierId}
          onChange={(e) => setTierId(e.target.value)}
        />
        {program?.isExternal ? (
          <TextField
            label="Membership number"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            errors={error?.fieldErrors.membershipNumber}
          />
        ) : null}
      </div>
      <TextArea
        label="Reason (audited)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
      />
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
  const [tierId, setTierId] = useState(membership.tier?.id ?? "");
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">(membership.status);
  const [reason, setReason] = useState("");
  const tierChanged = (tierId || null) !== (membership.tier?.id ?? null);
  const statusChanged = status !== membership.status;
  return (
    <FormDialog
      title={`${membership.program.name} · ${membership.membershipNumber}`}
      description="Tier and status changes are kept in the membership history."
      onClose={onClose}
      onSubmit={async () => {
        const result = await change({
          membershipId: membership.id,
          guestId: guest.id,
          body: {
            version: membership.version,
            ...(tierChanged ? { tierId: tierId || null } : {}),
            ...(statusChanged ? { status } : {}),
            reason: reason.trim(),
          },
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Save"
      disabled={(!tierChanged && !statusChanged) || reason.trim().length < 3}
      pending={state.isLoading}
      error={toClientApiError(state.error)}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Tier"
          placeholder="No tier"
          options={tiers
            .filter((t) => t.status === "ACTIVE" || t.id === membership.tier?.id)
            .map((t) => ({ value: t.id, label: t.name }))}
          value={tierId}
          onChange={(e) => setTierId(e.target.value)}
        />
        <Select
          label="Status"
          options={[
            { value: "ACTIVE", label: "Active" },
            { value: "INACTIVE", label: "Inactive" },
          ]}
          value={status}
          onChange={(e) => setStatus(e.target.value as "ACTIVE" | "INACTIVE")}
        />
      </div>
      <TextArea
        label="Reason (audited)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
      />
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
  const [points, setPoints] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const error = toClientApiError(state.error);
  return (
    <FormDialog
      title="Adjust points"
      description={`Balance ${membership.pointsBalance} points. Whole points; use a minus sign to deduct.`}
      onClose={onClose}
      onSubmit={async () => {
        const result = await adjust({
          membershipId: membership.id,
          guestId: guest.id,
          body: {
            version: membership.version,
            points: points.trim(),
            description: description.trim(),
            reason: reason.trim(),
          },
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Adjust"
      disabled={
        !/^-?[1-9]\d*$/.test(points.trim()) ||
        description.trim().length < 3 ||
        reason.trim().length < 3
      }
      pending={state.isLoading}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Points (±)"
          inputMode="numeric"
          value={points}
          onChange={(e) => setPoints(e.target.value.replace(/[^\d-]/g, ""))}
          errors={error?.fieldErrors.points}
        />
        <TextField
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={200}
        />
      </div>
      <TextArea
        label="Reason (audited)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
      />
    </FormDialog>
  );
}
