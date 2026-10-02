"use client";

import { textLinkClass } from "@/components/ui/Button";
import Link from "next/link";
import type { Route } from "next";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { type BadgeTone, StatusDot } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { DashboardView } from "@/modules/reports/reports.types";

/**
 * Room status right now. The donut shows the front-office split (occupied
 * vs vacant), which always adds up to the active rooms; housekeeping and
 * service states are independent of it, so they are listed as counts
 * instead of being drawn as slices of the same whole.
 */
export function RoomStatusCard({
  rooms,
  href,
}: {
  rooms: DashboardView["rooms"];
  /** Housekeeping board or the room-status report, whichever the user may open. */
  href: Route | null;
}) {
  const total = rooms.occupied + rooms.vacant;
  const slices = [
    { name: "Occupied", value: rooms.occupied, color: "var(--sm-chart-1)" },
    { name: "Vacant", value: rooms.vacant, color: "var(--sm-chart-4)" },
  ];
  const housekeeping: [string, number, BadgeTone][] = [
    ["Clean", rooms.clean, "success"],
    ["Inspected", rooms.inspected, "brand"],
    ["Dirty", rooms.dirty, "warning"],
    ["Out of order", rooms.outOfOrder, "danger"],
    ["Out of service", rooms.outOfService, "neutral"],
  ];

  return (
    <Card
      title="Room status"
      description="Live, all active rooms"
      actions={
        href ? (
          <Link href={href} className={textLinkClass}>
            View rooms
          </Link>
        ) : null
      }
    >
      <div className="flex flex-col items-center gap-5 sm:flex-row lg:flex-col min-[87.5rem]:flex-row">
        <figure className="relative size-36 shrink-0">
          <div aria-hidden="true" className="absolute inset-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart accessibilityLayer={false}>
                <Pie
                  data={
                    total > 0 ? slices : [{ name: "None", value: 1, color: "var(--sm-chart-grid)" }]
                  }
                  dataKey="value"
                  innerRadius="72%"
                  outerRadius="100%"
                  startAngle={90}
                  endAngle={-270}
                  stroke="none"
                  isAnimationActive={false}
                  rootTabIndex={-1}
                >
                  {(total > 0 ? slices : [{ color: "var(--sm-chart-grid)" }]).map(
                    (slice, index) => (
                      <Cell key={index} fill={slice.color} />
                    ),
                  )}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <figcaption className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-semibold tabular-nums">{rooms.occupied}</span>
            <span className="text-xs text-fg-secondary">of {total} occupied</span>
          </figcaption>
        </figure>
        <div className="flex w-full min-w-0 flex-col gap-3">
          <dl className="grid grid-cols-2 gap-2">
            {slices.map((slice) => (
              <div key={slice.name} className="rounded-md bg-surface-sunken px-3 py-2">
                <dt className="flex items-center gap-1.5 label-caps">
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full"
                    style={{ background: slice.color }}
                  />
                  {slice.name}
                </dt>
                <dd className="text-lg font-semibold tabular-nums">{slice.value}</dd>
              </div>
            ))}
          </dl>
          <dl className="flex flex-col divide-y divide-border-subtle">
            {housekeeping.map(([label, count, tone]) => (
              <div key={label} className="flex items-center justify-between py-1.5 text-sm">
                <dt>
                  <StatusDot tone={tone} className="text-sm text-fg">
                    {label}
                  </StatusDot>
                </dt>
                <dd className="font-medium tabular-nums">{count}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </Card>
  );
}
