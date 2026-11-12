"use client";

import { useState } from "react";
import { Alert } from "@/global/components/ui/Alert";
import { Button } from "@/global/components/ui/Button";
import { Card } from "@/global/components/ui/Card";
import { FactList } from "@/global/components/ui/FactList";
import { StatusPanel } from "@/global/components/ui/StatusPanel";
import { FormTextField, applyServerError, useZodForm } from "@/global/components/ui/form";
import { useProperty } from "@/global/hooks/useProperty";
import {
  usePropertyConfigurationQuery,
  useUpdatePropertyConfigurationMutation,
} from "@/global/api/endpoints/setupApi";
import { toClientApiError } from "@/global/api/errors";
import type { UpdatePropertyConfigurationInput } from "@serene/shared/modules/properties/properties.schema";
import type { PropertyConfigurationView } from "@serene/shared/modules/properties/properties.types";
import {
  type SettingsFormValues,
  settingsChanges,
  settingsDefaults,
  settingsFormSchema,
} from "../_lib/setupForm";
import { FormCheckboxField, FormReasonField } from "./SetupFields";

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
  const form = useZodForm(settingsFormSchema, settingsDefaults(config));
  const { control, handleSubmit, setError, setValue, watch, formState } = form;
  const [saved, setSaved] = useState(false);
  const error = toClientApiError(state.error);
  const changed = Object.keys(settingsChanges(watch(), config, live)).length;

  async function submit(values: SettingsFormValues) {
    setSaved(false);
    const result = await save({
      propertyId: property.id,
      body: {
        ...settingsChanges(values, config, live),
        reason: values.reason.trim(),
      } as UpdatePropertyConfigurationInput,
    });
    if ("data" in result) {
      setValue("reason", "");
      setSaved(true);
    } else {
      applyServerError(setError, toClientApiError(result.error));
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit(submit)} noValidate>
      {saved ? <Alert tone="success">Settings saved.</Alert> : null}
      <Card title="Times and folios">
        <div className="grid gap-3 sm:grid-cols-3">
          <FormTextField
            control={control}
            name="checkInTime"
            label="Check-in from"
            type="time"
            disabled={!manage}
          />
          <FormTextField
            control={control}
            name="checkOutTime"
            label="Check-out by"
            type="time"
            disabled={!manage}
          />
          <FormTextField
            control={control}
            name="maxFolioWindows"
            label="Folio windows per stay"
            type="number"
            inputMode="numeric"
            min={1}
            max={99}
            disabled={!manage}
            hint="Separate bills, for example company and guest extras"
          />
        </div>
      </Card>
      <Card title="Front office rules">
        <div className="flex flex-col">
          {FLAGS.map((f) => (
            <FormCheckboxField
              key={f.key}
              control={control}
              name={f.key}
              hint={f.hint}
              disabled={!manage}
            >
              {f.label}
            </FormCheckboxField>
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
            <FormTextField
              control={control}
              name="timezone"
              label="Time zone"
              disabled={!manage}
              hint="An IANA name such as Asia/Karachi"
            />
            <FormTextField
              control={control}
              name="confirmationPrefix"
              label="Confirmation prefix"
              disabled={!manage}
              maxLength={10}
              onChange={(e) => setValue("confirmationPrefix", e.target.value.toUpperCase())}
            />
          </div>
        )}
      </Card>
      {manage ? (
        <div className="flex flex-col gap-3">
          <FormReasonField control={control} />
          {error && Object.keys(error.fieldErrors).length === 0 ? (
            <Alert tone="danger">{error.message}</Alert>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={changed === 0}
              pending={state.isLoading || formState.isSubmitting}
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
