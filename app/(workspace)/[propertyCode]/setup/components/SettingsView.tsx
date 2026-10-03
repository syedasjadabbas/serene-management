"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FactList } from "@/components/ui/FactList";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { TextField } from "@/components/ui/TextField";
import { useProperty } from "@/hooks/useProperty";
import {
  usePropertyConfigurationQuery,
  useUpdatePropertyConfigurationMutation,
} from "@/lib/api/endpoints/setup.api";
import { toClientApiError } from "@/lib/api/errors";
import type { UpdatePropertyConfigurationInput } from "@/modules/properties/properties.schema";
import type { PropertyConfigurationView } from "@/modules/properties/properties.types";
import { CheckboxField, ReasonField } from "./SetupFields";

/**
 * Operating settings that the application applies. Only settings with an
 * effect are shown (overbooking is a per-booking, permission-gated override,
 * not a property switch). Time zone and confirmation prefix are fixed once
 * the property is live.
 */
export function SettingsView({ manage, live }: { manage: boolean; live: boolean }) {
  const property = useProperty();
  const query = usePropertyConfigurationQuery(property.id);
  const error = toClientApiError(query.error);
  if (query.isLoading) return <StatusPanel kind="loading" title="Loading settings" />;
  if (error || !query.data) {
    return (
      <StatusPanel
        kind={error?.status === 403 ? "forbidden" : "error"}
        title={error?.status === 403 ? "Access denied" : "Could not load the settings"}
        description={error?.message}
        requestId={error?.requestId}
      />
    );
  }
  return (
    <SettingsForm
      key={query.data.updatedAt ?? "new"}
      config={query.data}
      manage={manage}
      live={live}
    />
  );
}

const FLAGS = [
  {
    key: "requireInspectedForCheckIn",
    label: "Check in only to inspected rooms",
    hint: "A clean room must be inspected before a guest can be checked into it.",
  },
  {
    key: "usePickupStatus",
    label: "Use the pick-up housekeeping status",
    hint: "Light tidying between full cleans (stayovers) is tracked as its own status.",
  },
  {
    key: "autoNoShowOnNightAudit",
    label: "Night audit marks unarrived guests as no-shows",
    hint: "Guaranteed arrivals still due when the date closes become no-shows automatically.",
  },
  {
    key: "postNoShowCharges",
    label: "Post a no-show charge",
    hint: "The first night of a guaranteed no-show is charged by the night audit.",
  },
  {
    key: "requireZeroBalanceCheckout",
    label: "Check out only with a zero balance",
    hint: "Every folio window must be settled before the guest leaves.",
  },
] as const;
type FlagKey = (typeof FLAGS)[number]["key"];

function SettingsForm({
  config,
  manage,
  live,
}: {
  config: PropertyConfigurationView;
  manage: boolean;
  live: boolean;
}) {
  const property = useProperty();
  const [save, state] = useUpdatePropertyConfigurationMutation();
  const [checkInTime, setCheckInTime] = useState(config.checkInTime);
  const [checkOutTime, setCheckOutTime] = useState(config.checkOutTime);
  const [maxFolioWindows, setMaxFolioWindows] = useState(String(config.maxFolioWindows));
  const [timezone, setTimezone] = useState(config.timezone);
  const [confirmationPrefix, setConfirmationPrefix] = useState(config.confirmationPrefix);
  const [flags, setFlags] = useState<Record<FlagKey, boolean>>(
    () => Object.fromEntries(FLAGS.map((f) => [f.key, config[f.key]])) as Record<FlagKey, boolean>,
  );
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState(false);
  const error = toClientApiError(state.error);

  const changes: Partial<UpdatePropertyConfigurationInput> = {};
  if (checkInTime !== config.checkInTime) changes.checkInTime = checkInTime;
  if (checkOutTime !== config.checkOutTime) changes.checkOutTime = checkOutTime;
  if (Number(maxFolioWindows) !== config.maxFolioWindows)
    changes.maxFolioWindows = Number(maxFolioWindows);
  if (!live && timezone.trim() !== config.timezone) changes.timezone = timezone.trim();
  if (!live && confirmationPrefix.trim().toUpperCase() !== config.confirmationPrefix)
    changes.confirmationPrefix = confirmationPrefix.trim().toUpperCase();
  for (const f of FLAGS) if (flags[f.key] !== config[f.key]) changes[f.key] = flags[f.key];
  const changed = Object.keys(changes).length;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaved(false);
        const result = await save({
          propertyId: property.id,
          body: { ...changes, reason: reason.trim() } as UpdatePropertyConfigurationInput,
        });
        if ("data" in result) {
          setReason("");
          setSaved(true);
        }
      }}
    >
      {saved ? <Alert tone="success">Settings saved.</Alert> : null}
      <Card title="Times and folios">
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            label="Check-in from"
            type="time"
            value={checkInTime}
            onChange={(e) => setCheckInTime(e.target.value)}
            disabled={!manage}
            errors={error?.fieldErrors.checkInTime}
          />
          <TextField
            label="Check-out by"
            type="time"
            value={checkOutTime}
            onChange={(e) => setCheckOutTime(e.target.value)}
            disabled={!manage}
            errors={error?.fieldErrors.checkOutTime}
          />
          <TextField
            label="Folio windows per stay"
            type="number"
            inputMode="numeric"
            min={1}
            max={99}
            value={maxFolioWindows}
            onChange={(e) => setMaxFolioWindows(e.target.value)}
            disabled={!manage}
            hint="Separate bills, for example company and guest extras"
            errors={error?.fieldErrors.maxFolioWindows}
          />
        </div>
      </Card>
      <Card title="Front office rules">
        <div className="flex flex-col">
          {FLAGS.map((f) => (
            <CheckboxField
              key={f.key}
              checked={flags[f.key]}
              onChange={(on) => setFlags((all) => ({ ...all, [f.key]: on }))}
              hint={f.hint}
              disabled={!manage}
            >
              {f.label}
            </CheckboxField>
          ))}
        </div>
      </Card>
      <Card
        title="Identity"
        description={
          live
            ? "Fixed since go-live: the business date and every confirmation number depend on them."
            : "These can change until the property goes live."
        }
      >
        {live ? (
          <FactList
            items={[
              { label: "Time zone", value: config.timezone },
              { label: "Confirmation prefix", value: config.confirmationPrefix },
            ]}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Time zone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              disabled={!manage}
              hint="An IANA name such as Asia/Karachi"
              errors={error?.fieldErrors.timezone}
            />
            <TextField
              label="Confirmation prefix"
              value={confirmationPrefix}
              onChange={(e) => setConfirmationPrefix(e.target.value.toUpperCase())}
              disabled={!manage}
              maxLength={10}
              errors={error?.fieldErrors.confirmationPrefix}
            />
          </div>
        )}
      </Card>
      {manage ? (
        <div className="flex flex-col gap-3">
          <ReasonField value={reason} onChange={setReason} errors={error?.fieldErrors.reason} />
          {error && Object.keys(error.fieldErrors).length === 0 ? (
            <Alert tone="danger">{error.message}</Alert>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={changed === 0 || reason.trim().length < 3}
              pending={state.isLoading}
            >
              Save settings
            </Button>
            <span className="text-sm text-fg-secondary">
              {changed === 0 ? "No changes" : `${changed} change${changed === 1 ? "" : "s"}`}
            </span>
          </div>
        </div>
      ) : null}
    </form>
  );
}
