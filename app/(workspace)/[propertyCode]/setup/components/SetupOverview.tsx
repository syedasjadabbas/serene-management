"use client";

import { CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button, textLinkClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormDialog } from "@/components/ui/FormDialog";
import { Select } from "@/components/ui/Select";
import { useBusinessDate } from "@/hooks/useBusinessDate";
import { useProperty } from "@/hooks/useProperty";
import { useInitializeBusinessDateMutation } from "@/lib/api/endpoints/setup.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatDate, pluralize } from "@/lib/utils/format";
import { addDays } from "@/modules/business-date/business-date.policy";
import type { PropertySetupView } from "@/modules/setup/setup.types";
import { ReasonField } from "./SetupFields";

/**
 * What the property needs before it can sell rooms, and the go-live command
 * (opening the first business date, once). Taxes are optional: some
 * properties charge none.
 */
export function SetupOverview({
  setup,
  canGoLive,
  onOpen,
}: {
  setup: PropertySetupView;
  canGoLive: boolean;
  onOpen: (tab: "room-types" | "rooms" | "taxes" | "settings") => void;
}) {
  const property = useProperty();
  const [goLive, setGoLive] = useState(false);
  const r = setup.readiness;
  const steps = [
    {
      done: r.roomTypes > 0,
      title: "Room types",
      detail: pluralize(r.roomTypes, "room type") + " in use",
      action: () => onOpen("room-types"),
      actionLabel: "Open room types",
    },
    {
      done: r.rooms > 0,
      title: "Rooms",
      detail: pluralize(r.rooms, "room") + " in use",
      action: () => onOpen("rooms"),
      actionLabel: "Open rooms",
    },
    {
      done: r.taxes > 0,
      optional: true,
      title: "Taxes",
      detail:
        r.taxes > 0 ? pluralize(r.taxes, "tax", "taxes") + " in force" : "No taxes (optional)",
      action: () => onOpen("taxes"),
      actionLabel: "Open taxes",
    },
    {
      done: r.ratePlans > 0,
      title: "Rate plans",
      detail: pluralize(r.ratePlans, "rate plan") + " active",
      href: `/${property.code}/rates` as Route,
      actionLabel: "Open rates",
    },
  ];
  const ready = steps.every((s) => s.done || s.optional);

  return (
    <div className="flex flex-col gap-6">
      <Card
        title={r.live ? "The property is live" : "Before go-live"}
        description={
          r.live
            ? `Business date ${r.businessDate ? formatDate(r.businessDate) : "—"}. Changes to rooms and taxes apply from now on; posted charges keep the tax they were posted with.`
            : "Set up the rooms and prices, then open the first business date. Reservations and check-in work from then on."
        }
        actions={
          r.live ? (
            <Badge tone="success">Live</Badge>
          ) : canGoLive ? (
            <Button onClick={() => setGoLive(true)} disabled={!ready}>
              Go live
            </Button>
          ) : null
        }
      >
        <ol className="flex flex-col divide-y divide-border-subtle">
          {steps.map((step) => (
            <li key={step.title} className="flex flex-wrap items-center gap-3 py-3">
              {step.done ? (
                <CheckCircle2 aria-hidden="true" className="size-5 text-success" />
              ) : (
                <Circle aria-hidden="true" className="size-5 text-fg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {step.title}
                  <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
                </p>
                <p className="text-sm text-fg-secondary">{step.detail}</p>
              </div>
              {step.href ? (
                <Link href={step.href} className={textLinkClass}>
                  {step.actionLabel}
                </Link>
              ) : (
                <button type="button" className={textLinkClass} onClick={step.action}>
                  {step.actionLabel}
                </button>
              )}
            </li>
          ))}
        </ol>
        {!r.live && !ready ? (
          <p className="mt-2 text-sm text-fg-secondary">
            Go-live opens once the property has room types, rooms and an active rate plan.
          </p>
        ) : null}
        {!r.live && !canGoLive ? (
          <p className="mt-2 text-sm text-fg-secondary">
            An organization administrator (properties:manage) opens the first business date.
          </p>
        ) : null}
      </Card>
      {goLive ? <GoLiveDialog onClose={() => setGoLive(false)} /> : null}
    </div>
  );
}

function GoLiveDialog({ onClose }: { onClose: () => void }) {
  const property = useProperty();
  const businessDate = useBusinessDate();
  const [initialize, state] = useInitializeBusinessDateMutation();
  const today = businessDate.data?.propertyLocalDate ?? null;
  const [date, setDate] = useState(today ?? "");
  const [reason, setReason] = useState("");
  const error = toClientApiError(state.error);
  const options = today
    ? [
        { value: today, label: `${formatDate(today)} (today at the property)` },
        { value: addDays(today, -1), label: `${formatDate(addDays(today, -1))} (yesterday)` },
      ]
    : [];
  return (
    <FormDialog
      title={`Open the first business date of ${property.name}`}
      description="This can be done once. From then on the night audit closes each business date and opens the next."
      onClose={onClose}
      onSubmit={async () => {
        const result = await initialize({
          propertyId: property.id,
          body: { date: date || today || "", reason: reason.trim() },
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Go live"
      disabled={!(date || today) || reason.trim().length < 3}
      pending={state.isLoading}
      error={error}
    >
      <Select
        label="First business date"
        value={date || today || ""}
        onChange={(e) => setDate(e.target.value)}
        options={options}
        hint="The property's own date, in its time zone."
      />
      <ReasonField value={reason} onChange={setReason} errors={error?.fieldErrors.reason} />
    </FormDialog>
  );
}
