"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormDialog } from "@/components/ui/FormDialog";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { TextArea } from "@/components/ui/TextArea";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import {
  useNightAuditRunQuery,
  useRecoverNightAuditMutation,
} from "@/lib/api/endpoints/night-audit.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatDateTime } from "@/lib/utils/format";
import type { StepStatus } from "@/modules/night-audit/night-audit.policy";
import type { CheckItem, RunStepView, RunView } from "@/modules/night-audit/night-audit.types";
import { RUN_TONE, itemHref } from "../../components/NightAuditWorkspace";

const STEP_TONE: Record<StepStatus, BadgeTone> = {
  PENDING: "neutral",
  RUNNING: "info",
  SUCCEEDED: "success",
  FAILED: "danger",
  SKIPPED: "neutral",
};

/** The reports for the date this run closed. */
const REPORT_PACK = [
  ["manager-flash", "Manager's flash"],
  ["occupancy", "Occupancy, ADR and RevPAR"],
  ["revenue-by-code", "Revenue by transaction code"],
  ["payments", "Payments by method"],
  ["ledger-roll-forward", "Ledger roll-forward"],
  ["no-shows", "No-shows"],
] as const;

/** One night-audit run: outcome, summary, every step and the date's report pack. */
export function NightAuditRunView({ runId }: { runId: string }) {
  const property = useProperty();
  const { can, isLoading: permissionsLoading } = usePermissions(property.id);
  const allowed = can("nightaudit:read");
  const query = useNightAuditRunQuery(
    { propertyId: property.id, runId },
    { skip: !allowed, pollingInterval: 0 },
  );
  const [recovering, setRecovering] = useState(false);

  if (permissionsLoading) return <StatusPanel kind="loading" title="Loading the run" />;
  if (!allowed) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="You need the nightaudit:read permission."
      />
    );
  }
  if (query.isLoading) return <StatusPanel kind="loading" title="Loading the run" />;
  if (query.isError || !query.data) {
    const error = toClientApiError(query.error);
    return (
      <StatusPanel
        kind={error?.status === 404 ? "empty" : "error"}
        title={error?.status === 404 ? "Run not found" : "Could not load the run"}
        description={error?.message}
        requestId={error?.requestId}
      />
    );
  }
  const run = query.data;
  const summary = run.summary;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <nav className="text-sm">
        <Link
          className="text-brand hover:underline"
          href={`/${property.code}/night-audit` as Route}
        >
          ← Night audit
        </Link>
      </nav>
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="me-auto text-xl font-semibold">
          Business date <span className="font-mono">{run.businessDate}</span> · attempt{" "}
          {run.attempt}
        </h1>
        <Badge tone={RUN_TONE[run.status]}>{run.status.toLowerCase()}</Badge>
        {run.actions.recover ? (
          <Button size="sm" variant="danger" onClick={() => setRecovering(true)}>
            Recover stale run
          </Button>
        ) : null}
      </header>
      <p className="text-sm text-fg-secondary">
        Started {formatDateTime(run.startedAt, property.timezone)} by {run.startedBy?.name ?? "—"}
        {run.finishedAt ? ` · finished ${formatDateTime(run.finishedAt, property.timezone)}` : ""}
      </p>

      {run.status === "FAILED" ? (
        <Alert tone="danger">
          {run.errorMessage ?? "The run failed."} Nothing was posted and the business date is still
          open; fix the cause and run the audit again.
        </Alert>
      ) : null}
      {run.status === "RUNNING" ? (
        <Alert tone="info">
          The run is in progress or was interrupted. Postings are locked until it finishes.
        </Alert>
      ) : null}

      {summary && run.status === "COMPLETED" ? (
        <section aria-labelledby="summary-heading" className="flex flex-col gap-2">
          <h2 id="summary-heading" className="text-sm font-semibold">
            Summary
          </h2>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle sm:grid-cols-4">
            <Fact label="Rooms charged" value={String(summary.roomsPosted)} />
            <Fact label="Nights posted" value={String(summary.nightsPosted)} />
            <Fact
              label="Charges posted"
              value={formatCurrency(summary.chargesPosted, property.currencyCode)}
            />
            <Fact
              label="Of which tax"
              value={formatCurrency(summary.taxesPosted, property.currencyCode)}
            />
            <Fact label="No-shows" value={String(summary.noShows)} />
            <Fact
              label="No-show fees"
              value={`${summary.noShowFees} · ${formatCurrency(summary.noShowFeeTotal, property.currencyCode)}`}
            />
            <Fact label="Rooms to dirty" value={String(summary.roomsRolledToDirty)} />
            <Fact label="Tasks created" value={String(summary.tasksCreated)} />
            <Fact
              label="Blocks released / started"
              value={`${summary.blocksReleased} / ${summary.blocksActivated}`}
            />
            <Fact label="Group cutoffs" value={String(summary.groupCutoffs)} />
            <Fact label="Inventory repairs" value={String(summary.inventoryRepairs)} />
            <Fact label="Next business date" value={summary.nextBusinessDate ?? "—"} mono />
          </dl>
        </section>
      ) : null}

      <section aria-labelledby="steps-heading" className="flex flex-col gap-2">
        <h2 id="steps-heading" className="text-sm font-semibold">
          Steps
        </h2>
        <ol className="flex flex-col gap-1.5">
          {run.steps.map((step) => (
            <StepRow key={step.sequence} step={step} propertyCode={property.code} />
          ))}
        </ol>
      </section>

      {run.status === "COMPLETED" && can("reports:read") ? (
        <section aria-labelledby="pack-heading" className="flex flex-col gap-2">
          <h2 id="pack-heading" className="text-sm font-semibold">
            Reports for {run.businessDate}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {REPORT_PACK.map(([key, label]) => (
              <li key={key}>
                <Link
                  className="inline-flex h-7 items-center rounded-md border border-border bg-surface px-2.5 text-xs hover:bg-surface-sunken"
                  href={
                    `/${property.code}/reports/${key}?from=${run.businessDate}&to=${run.businessDate}` as Route
                  }
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recovering ? <RecoverDialog run={run} onClose={() => setRecovering(false)} /> : null}
    </div>
  );
}

function StepRow({ step, propertyCode }: { step: RunStepView; propertyCode: string }) {
  const result = (step.result ?? null) as {
    message?: string;
    count?: number;
    items?: CheckItem[];
    rolledBack?: boolean;
  } | null;
  return (
    <li className="rounded-lg border border-border-subtle bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-6 font-mono text-xs text-fg-muted">{step.sequence}</span>
        <Badge tone={STEP_TONE[step.status]}>{step.status.toLowerCase()}</Badge>
        <span className="text-sm font-medium">{step.label}</span>
        {result?.rolledBack ? <Badge tone="warning">rolled back</Badge> : null}
        {result?.message ? (
          <span className="min-w-0 flex-1 text-sm text-fg-secondary">{result.message}</span>
        ) : null}
      </div>
      {step.error ? <p className="mt-1 text-sm text-danger">{step.error}</p> : null}
      {result?.items && result.items.length > 0 ? (
        <ul className="mt-1 ps-8 text-sm">
          {result.items.slice(0, 10).map((item, index) => {
            const href = itemHref(propertyCode, item.link);
            return (
              <li key={index}>
                {href ? (
                  <Link className="text-brand hover:underline" href={href}>
                    {item.label}
                  </Link>
                ) : (
                  item.label
                )}{" "}
                {item.detail ? <span className="text-fg-muted">{item.detail}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

function RecoverDialog({ run, onClose }: { run: RunView; onClose: () => void }) {
  const property = useProperty();
  const [reason, setReason] = useState("");
  const [recover, { isLoading, error }] = useRecoverNightAuditMutation();
  async function submit() {
    const result = await recover({ propertyId: property.id, runId: run.id, reason: reason.trim() });
    if ("data" in result) onClose();
  }
  return (
    <FormDialog
      title="Recover stale run"
      description="Marks this interrupted run as failed and reopens the business date. Nothing it started was posted. A run that is still committing cannot be recovered."
      onClose={onClose}
      onSubmit={() => void submit()}
      submitLabel="Recover"
      disabled={reason.trim().length < 3}
      pending={isLoading}
      error={toClientApiError(error)}
      danger
    >
      <TextArea
        label="Reason (recorded in the audit trail)"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={2}
      />
    </FormDialog>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-surface px-3 py-2">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className={mono ? "font-mono text-sm" : "text-sm"}>{value}</dd>
    </div>
  );
}
