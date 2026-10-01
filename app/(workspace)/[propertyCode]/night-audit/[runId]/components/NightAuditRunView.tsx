"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { MoonStar } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { FormDialog } from "@/components/ui/FormDialog";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { TextArea } from "@/components/ui/TextArea";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "@/lib/api/store";
import {
  NIGHT_AUDIT_ROLLED_TAGS,
  nightAuditApi,
  useNightAuditRunQuery,
  useRecoverNightAuditMutation,
} from "@/lib/api/endpoints/night-audit.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatCurrency, formatDateTime } from "@/lib/utils/format";
import type { StepStatus } from "@/modules/night-audit/night-audit.policy";
import type {
  CheckItem,
  RunJobView,
  RunStepView,
  RunView,
} from "@/modules/night-audit/night-audit.types";
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

/** How often a run in progress is re-read (the audit runs in a background job). */
const RUNNING_POLL_MS = 2_000;

/** One night-audit run: outcome, summary, every step and the date's report pack. */
export function NightAuditRunView({ runId }: { runId: string }) {
  const property = useProperty();
  const { can, isLoading: permissionsLoading } = usePermissions(property.id);
  const allowed = can("nightaudit:read");
  // Followed while RUNNING (the page may be opened, refreshed or reopened after
  // signing in again at any point: the state is the server's, not this tab's).
  const args = { propertyId: property.id, runId };
  const cached = nightAuditApi.endpoints.nightAuditRun.useQueryState(args, { skip: !allowed });
  const inProgress = cached.data ? cached.data.status === "RUNNING" : true;
  const query = useNightAuditRunQuery(args, {
    skip: !allowed,
    pollingInterval: inProgress ? RUNNING_POLL_MS : 0,
    skipPollingIfUnfocused: true,
  });
  const [recovering, setRecovering] = useState(false);
  const dispatch = useDispatch<AppDispatch>();
  const status = query.data?.status;
  const previous = useRef(status);
  useEffect(() => {
    if (!status) return;
    // Finished while this page watched: the date rolled (or reopened), so
    // every operational list and the business date are stale.
    if (previous.current === "RUNNING" && status !== "RUNNING") {
      dispatch(nightAuditApi.util.invalidateTags([...NIGHT_AUDIT_ROLLED_TAGS]));
    }
    previous.current = status;
  }, [status, dispatch]);

  if (permissionsLoading) return <PageSkeleton title="Loading the run" layout="detail" />;
  if (!allowed) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="You need the nightaudit:read permission."
      />
    );
  }
  if (query.isLoading) return <PageSkeleton title="Loading the run" layout="detail" />;
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        back={{ href: `/${property.code}/night-audit`, label: "Night audit" }}
        icon={MoonStar}
        eyebrow="Night audit run"
        title={
          <>
            Business date <span className="font-mono">{run.businessDate}</span> · attempt{" "}
            {run.attempt}
          </>
        }
        meta={<Badge tone={RUN_TONE[run.status]}>{run.status.toLowerCase()}</Badge>}
        description={
          <>
            Started {formatDateTime(run.startedAt, property.timezone)} by{" "}
            {run.startedBy?.name ?? "—"}
            {run.finishedAt
              ? ` · finished ${formatDateTime(run.finishedAt, property.timezone)}`
              : ""}
          </>
        }
        actions={
          run.actions.recover ? (
            <Button variant="danger" onClick={() => setRecovering(true)}>
              {run.job?.status === "QUEUED" ? "Cancel audit" : "Recover stale run"}
            </Button>
          ) : undefined
        }
      />

      {run.status === "FAILED" ? (
        <Alert tone="danger">
          {run.errorMessage ?? "The run failed."} Nothing was posted and the business date is still
          open; fix the cause and run the audit again.
        </Alert>
      ) : null}
      {run.status === "RUNNING" ? <ProgressAlert job={run.job} /> : null}

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

      {run.steps.length > 0 ? (
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
      ) : null}

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

      {recovering ? (
        <RecoverDialog
          run={run}
          cancel={run.job?.status === "QUEUED"}
          onClose={() => setRecovering(false)}
        />
      ) : null}
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

const STAGE_LABEL: Record<string, string> = {
  CHECKS: "Running the checks",
  COMMIT: "Posting and closing the day",
};

/** Where a run in progress stands: waiting for a worker, working, retrying, or stuck. */
function ProgressAlert({ job }: { job: RunJobView | null }) {
  const property = useProperty();
  let text: string;
  if (!job || job.status === "FAILED" || job.status === "CANCELLED") {
    text = "The run was interrupted. Postings stay locked until it is recovered.";
  } else if (job.status === "QUEUED" && job.attempts > 0) {
    text = `${job.error?.message ?? "The last attempt was interrupted"}. Next attempt${
      job.runAfter ? ` at ${formatDateTime(job.runAfter, property.timezone)}` : ""
    } (${job.attempts} of ${job.maxAttempts} used).`;
  } else if (job.status === "QUEUED") {
    text = "Queued: waiting for a worker to start the audit.";
  } else {
    text = `${STAGE_LABEL[job.stage ?? ""] ?? "In progress"}${
      job.attempts > 1 ? ` (attempt ${job.attempts} of ${job.maxAttempts})` : ""
    }…`;
  }
  return (
    <Alert tone="info">
      <span role="status" aria-live="polite">
        {text}
      </span>{" "}
      Postings are locked until the audit finishes. You can leave this page; the audit continues on
      the server.
    </Alert>
  );
}

function RecoverDialog({
  run,
  cancel,
  onClose,
}: {
  run: RunView;
  cancel: boolean;
  onClose: () => void;
}) {
  const property = useProperty();
  const [reason, setReason] = useState("");
  const [recover, { isLoading, error }] = useRecoverNightAuditMutation();
  async function submit() {
    const result = await recover({ propertyId: property.id, runId: run.id, reason: reason.trim() });
    if ("data" in result) onClose();
  }
  return (
    <FormDialog
      title={cancel ? "Cancel night audit" : "Recover stale run"}
      description={
        cancel
          ? "The audit is waiting for a worker (to start, or to retry after an interruption). Cancelling marks the run as failed and reopens the business date; nothing is posted."
          : "Marks this interrupted run as failed and reopens the business date. Nothing it started was posted. A run that is still committing cannot be recovered."
      }
      onClose={onClose}
      onSubmit={() => void submit()}
      submitLabel={cancel ? "Cancel audit" : "Recover"}
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
