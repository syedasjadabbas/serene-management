"use client";

import { textLinkClass } from "@/components/ui/Button";
import { BedDouble, Wrench } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useHousekeepingSummaryQuery } from "@/lib/api/endpoints/housekeeping.api";
import { useMaintenanceSummaryQuery } from "@/lib/api/endpoints/maintenance.api";

/**
 * Housekeeping and maintenance workload, each shown only with its read
 * permission (queries are skipped otherwise). Figures come from the same
 * summaries the housekeeping and maintenance screens use.
 */
export function OperationsCard({
  propertyId,
  propertyCode,
  housekeeping,
  maintenance,
}: {
  propertyId: string;
  propertyCode: string;
  housekeeping: boolean;
  maintenance: boolean;
}) {
  const poll = { pollingInterval: 120_000, skipPollingIfUnfocused: true };
  const hk = useHousekeepingSummaryQuery(propertyId, { skip: !housekeeping, ...poll });
  const mt = useMaintenanceSummaryQuery(propertyId, { skip: !maintenance, ...poll });

  return (
    <Card title="Operations" description="Open work across the property">
      <div className="flex flex-col gap-4">
        {housekeeping ? (
          <Group
            icon={<BedDouble aria-hidden="true" className="size-4" />}
            title="Housekeeping"
            href={`/${propertyCode}/housekeeping` as Route}
            loading={hk.isLoading}
            failed={hk.isError}
            rows={
              hk.data
                ? [
                    ["Open tasks", hk.data.tasks.open],
                    ["In progress", hk.data.tasks.inProgress],
                    ["Awaiting inspection", hk.data.tasks.awaitingInspection],
                    ["Completed today", hk.data.tasks.completedToday],
                  ]
                : []
            }
          />
        ) : null}
        {maintenance ? (
          <Group
            icon={<Wrench aria-hidden="true" className="size-4" />}
            title="Maintenance"
            href={`/${propertyCode}/maintenance` as Route}
            loading={mt.isLoading}
            failed={mt.isError}
            rows={
              mt.data
                ? [
                    ["Open requests", mt.data.open],
                    ["Unassigned", mt.data.unassigned],
                    ["Blocking rooms", mt.data.blockingRooms],
                  ]
                : []
            }
          />
        ) : null}
      </div>
    </Card>
  );
}

function Group({
  icon,
  title,
  href,
  loading,
  failed,
  rows,
}: {
  icon: ReactNode;
  title: string;
  href: Route;
  loading: boolean;
  failed: boolean;
  rows: [string, number][];
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <span className="flex size-7 items-center justify-center rounded-md bg-surface-sunken text-fg-secondary">
            {icon}
          </span>
          {title}
        </h3>
        <Link href={href} className={textLinkClass}>
          Open<span className="sr-only"> {title.toLowerCase()}</span>
        </Link>
      </div>
      {loading ? (
        <div className="flex flex-col gap-2 py-1">
          <Skeleton className="w-3/4" />
          <Skeleton className="w-1/2" />
        </div>
      ) : failed ? (
        <p className="text-sm text-danger">Could not load the {title.toLowerCase()} summary.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-2 py-1 text-sm">
              <dt className="text-fg-secondary">{label}</dt>
              <dd className="font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
