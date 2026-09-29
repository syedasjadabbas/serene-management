import { BedDouble, LogIn, LogOut, Users } from "lucide-react";
import type { Route } from "next";
import { StatCard } from "@/components/ui/StatCard";
import type { DashboardView } from "@/modules/reports/reports.types";

/**
 * The four figures the desk checks first: tonight's occupancy, arrivals
 * still to check in, departures still due and guests in house. Each card
 * links to the report behind it when the user can read reports.
 */
export function StatsRow({ view, propertyCode }: { view: DashboardView; propertyCode: string }) {
  const { today } = view;
  const reports = view.access.reports;
  const report = (key: string, withDate = true) =>
    reports
      ? ((withDate
          ? `/${propertyCode}/reports/${key}?from=${view.businessDate}&to=${view.businessDate}`
          : `/${propertyCode}/reports/${key}`) as Route)
      : null;
  const arrivalsTotal = today.arrivalsDone + today.arrivalsExpected;
  const departuresTotal = today.departuresDone + today.departuresExpected;
  const share = (done: number, total: number) => (total > 0 ? (done / total) * 100 : 0);

  return (
    <section
      aria-label="Today at a glance"
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
    >
      <StatCard
        icon={BedDouble}
        tone="brand"
        label="Occupancy tonight"
        value={`${today.occupancy}%`}
        hint={`${today.roomsOccupied} of ${today.roomsAvailable} rooms sold`}
        progress={Number(today.occupancy)}
        href={report("occupancy")}
      />
      <StatCard
        icon={LogIn}
        tone="info"
        label="Arrivals to check in"
        value={today.arrivalsExpected}
        hint={`${today.arrivalsDone} of ${arrivalsTotal} checked in${
          today.vipArrivals ? ` · ${today.vipArrivals} VIP` : ""
        }`}
        progress={share(today.arrivalsDone, arrivalsTotal)}
        href={report("arrivals")}
      />
      <StatCard
        icon={LogOut}
        tone="warning"
        label="Departures due"
        value={today.departuresExpected}
        hint={`${today.departuresDone} of ${departuresTotal} departed`}
        progress={share(today.departuresDone, departuresTotal)}
        href={report("departures")}
      />
      <StatCard
        icon={Users}
        tone="accent"
        label="In house"
        value={today.inHouse}
        hint="occupied rooms with guests"
        href={report("in-house", false)}
      />
    </section>
  );
}
