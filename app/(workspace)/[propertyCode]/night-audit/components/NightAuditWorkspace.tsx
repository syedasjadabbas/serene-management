"use client";

import { MoonStar } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormDialog } from "@/components/ui/FormDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";
import { TextArea } from "@/components/ui/TextArea";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import {
  useNightAuditReadinessQuery,
  useNightAuditRunsQuery,
  useStartNightAuditMutation,
} from "@/lib/api/endpoints/night-audit.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import type { CheckOutcome } from "@/modules/night-audit/night-audit.policy";
import type { CheckItem, CheckResult, RunListItem } from "@/modules/night-audit/night-audit.types";
import { Table, Th, THead, Td, Tr } from "@/components/ui/Table";

export const OUTCOME_TONE: Record<CheckOutcome, BadgeTone> = {
  PASSED: "success",
  WARNING: "warning",
  BLOCKING: "danger",
  SKIPPED: "neutral",
};

const OUTCOME_LABEL: Record<CheckOutcome, string> = {
  PASSED: "Ready",
  WARNING: "Warning",
  BLOCKING: "Blocking",
  SKIPPED: "Skipped",
};

export const RUN_TONE: Record<RunListItem["status"], BadgeTone> = {
  RUNNING: "info",
  COMPLETED: "success",
  FAILED: "danger",
};

/** Where a listed item is resolved. */
export function itemHref(propertyCode: string, link: CheckItem["link"]): Route | null {
  if (!link) return null;
  switch (link.kind) {
    case "stay":
      return `/${propertyCode}/front-desk/stays/${link.id}` as Route;
    case "reservation":
      return `/${propertyCode}/reservations/${link.id}` as Route;
    case "folio":
      return `/${propertyCode}/billing/${link.id}` as Route;
    case "room":
      return `/${propertyCode}/housekeeping` as Route;
  }
}

/**
 * Night audit: the pre-audit checklist for the current business date, the
 * run command (reason + Idempotency-Key, high-risk) and the run history.
 * Every check is recomputed by the server; the button only starts when no
 * check blocks.
 */
export function NightAuditWorkspace() {
  const property = useProperty();
  const { can, isLoading: permissionsLoading } = usePermissions(property.id);
  const allowed = can("nightaudit:read");
  const readiness = useNightAuditReadinessQuery(property.id, { skip: !allowed });
  const [dialog, setDialog] = useState(false);
  const crumbs = [{ label: property.code, href: `/${property.code}` }, { label: "Night audit" }];

  if (permissionsLoading) return <PageSkeleton title="Loading night audit" />;
  if (!allowed) {
    return (
      <StatusPanel
        kind="forbidden"
        title="Access denied"
        description="You need the nightaudit:read permission."
      />
    );
  }
  if (readiness.isLoading) {
    // The page keeps its heading while the checks are computed.
    return (
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          icon={MoonStar}
          breadcrumbs={crumbs}
          title="Night audit"
          description="Checking the business date…"
        />
        <section role="status" className="flex flex-col gap-2">
          <span className="sr-only">Checking the business date</span>
          <Skeleton className="h-3.5 w-28" />
          <ul aria-hidden="true" className="flex flex-col gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <li
                key={i}
                className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface px-3 py-3 shadow-card"
              >
                <Skeleton className="h-5 w-16 rounded-sm" />
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 flex-1" />
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }
  if (readiness.isError || !readiness.data) {
    const error = toClientApiError(readiness.error);
    return (
      <StatusPanel
        kind="error"
        title="Could not load the night audit"
        description={error?.message}
        requestId={error?.requestId}
        action={
          <Button variant="secondary" onClick={() => void readiness.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }
  const view = readiness.data;
  const blocking = view.checks.filter((c) => c.outcome === "BLOCKING").length;
  const warnings = view.checks.filter((c) => c.outcome === "WARNING").length;

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        icon={MoonStar}
        breadcrumbs={crumbs}
        title="Night audit"
        description={
          view.businessDate ? (
            <>
              Closes business date <strong className="font-mono">{view.businessDate}</strong> (
              {formatDate(view.businessDate)}) and opens the next. Hotel date{" "}
              <span className="font-mono">{view.propertyLocalDate}</span>.
            </>
          ) : (
            "The property is not live yet."
          )
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => void readiness.refetch()}>
              Recheck
            </Button>
            {view.actions.run ? (
              <Button onClick={() => setDialog(true)} disabled={!view.canStart}>
                Run night audit
              </Button>
            ) : null}
          </>
        }
      />

      {view.running ? (
        <Alert tone="info">
          Night audit is running for {view.running.businessDate} (attempt {view.running.attempt}).{" "}
          <Link
            className="underline"
            href={`/${property.code}/night-audit/${view.running.id}` as Route}
          >
            View the run
          </Link>
        </Alert>
      ) : null}
      {view.startProblem && !view.running ? (
        <Alert tone={blocking > 0 ? "danger" : "warning"}>{view.startProblem}</Alert>
      ) : null}
      {view.canStart && warnings > 0 ? (
        <Alert tone="warning">
          {warnings} check{warnings === 1 ? "" : "s"} with warnings: review them before running.
        </Alert>
      ) : null}

      <section aria-labelledby="checks-heading" className="flex flex-col gap-2">
        <h2 id="checks-heading" className="text-sm font-semibold">
          Pre-audit checks
        </h2>
        <ul className="flex flex-col gap-2">
          {view.checks.map((check) => (
            <CheckRow key={check.code} check={check} propertyCode={property.code} />
          ))}
        </ul>
      </section>

      <RunHistory />

      {dialog && view.businessDate ? (
        <RunDialog businessDate={view.businessDate} onClose={() => setDialog(false)} />
      ) : null}
    </div>
  );
}

function CheckRow({ check, propertyCode }: { check: CheckResult; propertyCode: string }) {
  const [open, setOpen] = useState(check.outcome === "BLOCKING");
  return (
    <li className="rounded-lg border border-border-subtle bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <Badge tone={OUTCOME_TONE[check.outcome]}>{OUTCOME_LABEL[check.outcome]}</Badge>
        <span className="text-sm font-medium">{check.label}</span>
        <span className="min-w-0 flex-1 text-sm text-fg-secondary">{check.message}</span>
        {check.count > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Hide" : `Show ${check.count}`}
          </Button>
        ) : null}
      </div>
      {open && check.items.length > 0 ? (
        <ul className="border-t border-border-subtle px-3 py-2 text-sm">
          {check.items.map((item, index) => {
            const href = itemHref(propertyCode, item.link);
            return (
              <li key={index} className="flex flex-wrap gap-x-2 py-0.5">
                {href ? (
                  <Link className="text-brand underline-offset-2 hover:underline" href={href}>
                    {item.label}
                  </Link>
                ) : (
                  <span>{item.label}</span>
                )}
                {item.detail ? <span className="text-fg-muted">{item.detail}</span> : null}
              </li>
            );
          })}
          {check.count > check.items.length ? (
            <li className="text-fg-muted">…and {check.count - check.items.length} more</li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

function RunDialog({ businessDate, onClose }: { businessDate: string; onClose: () => void }) {
  const property = useProperty();
  const router = useRouter();
  const [reason, setReason] = useState("End of day");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [start, { isLoading, error, data }] = useStartNightAuditMutation();
  const apiError = toClientApiError(error);

  async function submit() {
    const result = await start({
      propertyId: property.id,
      reason: reason.trim(),
      idempotencyKey,
    });
    if ("data" in result && result.data) {
      router.push(`/${property.code}/night-audit/${result.data.id}` as Route);
    }
  }

  return (
    <FormDialog
      title={`Close business date ${businessDate}`}
      description="Posts tonight's room, package and tax charges, turns missed arrivals into no-shows, releases blocks, rolls room status, freezes the day's statistics and opens the next business date. Postings are locked until it finishes; if anything fails, nothing is posted."
      onClose={onClose}
      onSubmit={() => void submit()}
      submitLabel={isLoading ? "Starting…" : "Run night audit"}
      disabled={reason.trim().length < 3 || Boolean(data)}
      pending={isLoading}
      error={apiError}
      danger
    >
      <TextArea
        label="Reason (recorded in the audit trail)"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={2}
        maxLength={1000}
      />
    </FormDialog>
  );
}

/**
 * Run history, newest first. The first page decides loading / error / empty;
 * "Load more" appends further pages, each its own cursor-keyed query.
 */
export function RunHistory() {
  const property = useProperty();
  const firstPage = useNightAuditRunsQuery({ propertyId: property.id });
  const [more, setMore] = useState<{ key: string; cursors: string[] }>({
    key: property.id,
    cursors: [],
  });
  const cursors = more.key === property.id ? more.cursors : [];
  const addPage = (cursor: string) => setMore({ key: property.id, cursors: [...cursors, cursor] });
  const data = firstPage.currentData;
  const error = toClientApiError(firstPage.error);

  return (
    <section aria-labelledby="history-heading" className="flex flex-col gap-2">
      <h2 id="history-heading" className="text-sm font-semibold">
        Run history
      </h2>
      {error ? (
        <StatusPanel
          kind="error"
          title="Could not load the run history"
          description={error.message}
          requestId={error.requestId}
          action={
            <Button variant="secondary" onClick={() => void firstPage.refetch()}>
              Retry
            </Button>
          }
        />
      ) : !data ? (
        <StatusPanel kind="loading" title="Loading runs" />
      ) : data.items.length === 0 ? (
        <StatusPanel kind="empty" title="No night audit has run yet" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-subtle">
          <Table caption="Night audit runs, newest first">
            <THead>
              <tr>
                <Th>Business date</Th>
                <Th>Attempt</Th>
                <Th>Outcome</Th>
                <Th>Started</Th>
                <Th>By</Th>
                <Th>Error</Th>
              </tr>
            </THead>
            <RunRows
              runs={data.items}
              nextCursor={cursors.length === 0 ? data.meta.nextCursor : null}
              fetching={firstPage.isFetching}
              onMore={addPage}
            />
            {cursors.map((cursor, index) => (
              <RunPage
                key={cursor}
                cursor={cursor}
                isLast={index === cursors.length - 1}
                onMore={addPage}
              />
            ))}
          </Table>
        </div>
      )}
    </section>
  );
}

const RUN_COLUMNS = 6;

/** A further page of runs, as its own table body. */
function RunPage({
  cursor,
  isLast,
  onMore,
}: {
  cursor: string;
  isLast: boolean;
  onMore: (cursor: string) => void;
}) {
  const property = useProperty();
  const query = useNightAuditRunsQuery({ propertyId: property.id, cursor });
  const error = toClientApiError(query.error);
  const data = query.currentData;
  if (error) {
    return (
      <tbody>
        <tr>
          <td colSpan={RUN_COLUMNS} className="bg-surface p-3">
            <StatusPanel
              kind="error"
              title="Could not load more runs"
              description={error.message}
              requestId={error.requestId}
              action={
                <Button variant="secondary" onClick={() => void query.refetch()}>
                  Retry
                </Button>
              }
            />
          </td>
        </tr>
      </tbody>
    );
  }
  if (!data) {
    return (
      <tbody>
        <tr>
          <td colSpan={RUN_COLUMNS} className="bg-surface p-3">
            <StatusPanel kind="loading" title="Loading more runs" />
          </td>
        </tr>
      </tbody>
    );
  }
  return (
    <RunRows
      runs={data.items}
      nextCursor={isLast ? data.meta.nextCursor : null}
      fetching={query.isFetching}
      onMore={onMore}
      continued
    />
  );
}

function RunRows({
  runs,
  nextCursor,
  fetching,
  onMore,
  continued = false,
}: {
  runs: RunListItem[];
  nextCursor: string | null | undefined;
  fetching: boolean;
  onMore: (cursor: string) => void;
  continued?: boolean;
}) {
  const property = useProperty();
  return (
    <tbody
      className={
        continued
          ? "divide-y divide-border-subtle border-t border-border-subtle"
          : "divide-y divide-border-subtle"
      }
    >
      {runs.map((run) => (
        <Tr key={run.id} interactive>
          <Td className="font-mono">
            <Link
              className="text-brand hover:underline"
              href={`/${property.code}/night-audit/${run.id}` as Route}
            >
              {run.businessDate}
            </Link>
          </Td>
          <Td>{run.attempt}</Td>
          <Td>
            <Badge tone={RUN_TONE[run.status]}>{run.status.toLowerCase()}</Badge>
          </Td>
          <Td className="whitespace-nowrap">{formatDateTime(run.startedAt, property.timezone)}</Td>
          <Td>{run.startedBy?.name ?? "—"}</Td>
          <Td className="font-mono text-xs">{run.errorCode ?? ""}</Td>
        </Tr>
      ))}
      {nextCursor ? (
        <tr className="bg-surface">
          <td colSpan={RUN_COLUMNS} className="p-3 text-center">
            <Button
              variant="secondary"
              size="sm"
              pending={fetching}
              disabled={fetching}
              onClick={() => onMore(nextCursor)}
            >
              Load more
            </Button>
          </td>
        </tr>
      ) : null}
    </tbody>
  );
}
