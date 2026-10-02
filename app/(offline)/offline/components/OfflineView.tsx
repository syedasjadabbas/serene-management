"use client";

import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { SereneLogo } from "@/components/brand/Logo";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { SearchInput } from "@/components/ui/SearchInput";
import { Tab, TabList } from "@/components/ui/TabList";
import { Table, TableEmpty, TableFrame, TBody, Td, Th, THead, Tr } from "@/components/ui/Table";
import { useTabs } from "@/components/ui/tabs";
import { cn } from "@/components/ui/cn";
import {
  type OfflineArrival,
  type OfflineRoom,
  type OfflineSnapshot,
  type OfflineStay,
  snapshotUsability,
} from "@/lib/offline/policy";
import { useConnectivity } from "@/lib/offline/useConnectivity";
import { applySessionCheck, checkSession, type SessionCheck } from "@/lib/offline/verifySession";
import { useOfflineStore } from "@/lib/offline/useOfflineStore";

type View = "arrivals" | "inHouse" | "departures" | "rooms";
const VIEWS: { id: View; label: string }[] = [
  { id: "arrivals", label: "Arrivals" },
  { id: "inHouse", label: "In house" },
  { id: "departures", label: "Departures" },
  { id: "rooms", label: "Rooms" },
];

const label = (value: string) =>
  value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ");

const stamp = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

function age(at: number, now: number) {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min ago`;
}

const noSubscribe = () => () => {};

/**
 * The page the failed navigation was for (/offline?from=/SMR/front-desk).
 * Only same-origin paths: this page must never become an open redirect.
 */
function useFrom(): string | null {
  const search = useSyncExternalStore(
    noSubscribe,
    () => window.location.search,
    () => "",
  );
  const from = new URLSearchParams(search).get("from");
  return from && from.startsWith("/") && !from.startsWith("//") ? from : null;
}

/**
 * Read-only front office from the last snapshot of one property. Never
 * mixes properties: exactly one snapshot is shown, chosen from the page the
 * user was trying to open, or picked from the list of this user's
 * snapshots. Nothing here can change data.
 */
export function OfflineView() {
  const store = useOfflineStore();
  const { online, recheck } = useConnectivity();
  // Nothing is shown until the server confirmed the session (online), or
  // cannot be asked (offline): see lib/offline/verifySession.ts.
  const [verified, setVerified] = useState<SessionCheck["state"] | "checking">("checking");
  useEffect(() => {
    if (online !== true) return;
    let cancelled = false;
    void (async () => {
      const check = await checkSession();
      await applySessionCheck(check);
      if (!cancelled) setVerified(check.state);
    })();
    return () => {
      cancelled = true;
    };
  }, [online]);
  const session = online === false ? "unreachable" : online === null ? "checking" : verified;
  const from = useFrom();
  // The property of the page being opened (SMR from /SMR/front-desk) until the user picks one.
  const requested = from?.split("/")[1]?.toUpperCase() ?? null;
  const [picked, setChosen] = useState<string | null>(null);
  const chosen = picked ?? requested;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const usable = useMemo(
    () =>
      store.snapshots
        .filter((s) => {
          const usability = snapshotUsability(s, { userId: store.session?.userId ?? null, now });
          return usability === "usable" || usability === "stale-business-date";
        })
        .sort((a, b) => a.propertyCode.localeCompare(b.propertyCode)),
    [store.snapshots, store.session, now],
  );
  // Never substitute another property's copy for the one being opened: a
  // requested property without a copy shows the chooser, not a neighbour.
  const snapshot = chosen
    ? usable.find((s) => s.propertyCode === chosen)
    : usable.length === 1
      ? usable[0]
      : undefined;
  const missing = chosen && !snapshot ? chosen : null;
  const returnTo = from ?? (snapshot ? `/${snapshot.propertyCode}/front-desk` : "/");

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-(--z-sticky) border-b border-border-subtle bg-surface">
        <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center gap-3 px-3 sm:px-6 lg:px-8">
          <SereneLogo size="sm" />
          <span aria-hidden="true" className="hidden h-6 w-px bg-border sm:block" />
          <p className="hidden min-w-0 truncate text-sm font-semibold sm:block">
            {snapshot ? snapshot.propertyName : "Offline view"}
          </p>
          <div className="ms-auto flex items-center gap-2">
            {online === false ? (
              <span
                role="status"
                className="inline-flex h-10 items-center gap-2 rounded-md border border-warning/40 bg-surface px-3 text-xs font-medium text-warning shadow-card"
              >
                <CloudOff aria-hidden="true" className="size-4" />
                Offline mode
              </span>
            ) : online ? (
              <span
                role="status"
                className="inline-flex h-10 items-center gap-2 rounded-md border border-success/35 bg-surface px-3 text-xs font-medium text-success shadow-card"
              >
                <Wifi aria-hidden="true" className="size-4" />
                Back online
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <main
        id="main"
        className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-3 py-5 sm:px-6 lg:px-8 lg:py-8"
      >
        {online ? (
          <Alert tone="success">
            <span className="font-medium">The connection is back.</span>{" "}
            <a href={returnTo} className="font-semibold underline underline-offset-2">
              Return to the workspace
            </a>{" "}
            for live data and to make changes.
          </Alert>
        ) : (
          <Alert tone="warning">
            <span className="font-medium">No connection to the server.</span> This is a read-only
            copy saved in this browser. Check-ins, check-outs, room moves, housekeeping updates,
            payments and charges need the connection.{" "}
            <button
              type="button"
              onClick={() => void recheck()}
              className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"
            >
              <RefreshCw aria-hidden="true" className="size-3.5" />
              Check again
            </button>
          </Alert>
        )}

        {!store.loaded || session === "checking" ? null : !store.session || usable.length === 0 ? (
          <section className="rounded-lg border border-border-subtle bg-surface p-6 shadow-card">
            <h1 className="text-lg font-semibold">No offline copy in this browser</h1>
            <p className="mt-1.5 max-w-prose text-sm text-fg-secondary">
              While you are signed in and online, each property you open keeps a read-only copy of
              today&apos;s arrivals, departures, in-house guests and rooms here for outages. Copies
              older than 24 hours are not shown, and signing out deletes them.
            </p>
          </section>
        ) : !snapshot ? (
          <PropertyChooser snapshots={usable} missing={missing} onChoose={setChosen} />
        ) : (
          <SnapshotView
            snapshot={snapshot}
            owner={store.session.displayName}
            now={now}
            others={usable.length > 1 ? () => setChosen("") : null}
          />
        )}
      </main>
    </div>
  );
}

function PropertyChooser({
  snapshots,
  missing,
  onChoose,
}: {
  snapshots: OfflineSnapshot[];
  missing: string | null;
  onChoose: (code: string) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold">
          {missing ? `No offline copy of ${missing}` : "Choose a property"}
        </h1>
        {missing ? (
          <p className="mt-1 text-sm text-fg-secondary">
            This browser has no saved copy of that property. Offline copies exist for:
          </p>
        ) : null}
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {snapshots.map((s) => (
          <li key={s.key}>
            <button
              type="button"
              onClick={() => onChoose(s.propertyCode)}
              className="flex w-full flex-col items-start rounded-lg border border-border-subtle bg-surface px-4 py-3 text-start shadow-card hover:bg-surface-sunken"
            >
              <span className="text-sm font-semibold">{s.propertyName}</span>
              <span className="text-xs text-fg-muted">
                {s.propertyCode} · saved {stamp(s.savedAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SnapshotView({
  snapshot,
  owner,
  now,
  others,
}: {
  snapshot: OfflineSnapshot;
  owner: string;
  now: number;
  others: (() => void) | null;
}) {
  const available = VIEWS.filter((v) =>
    v.id === "rooms" ? snapshot.rooms !== null : snapshot[v.id] !== null,
  );
  const [view, setView] = useState<View>(available[0]?.id ?? "arrivals");
  const [query, setQuery] = useState("");
  const ids = available.map((v) => v.id);
  const tabs = useTabs(ids, view, setView);
  const old = now - snapshot.savedAt > 2 * 60 * 60 * 1000;
  const q = query.trim().toLowerCase();
  const match = (...values: (string | null)[]) =>
    !q || values.some((v) => v?.toLowerCase().includes(q));

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.02em] text-balance">
            {snapshot.propertyName} · front office
          </h1>
          <p className="mt-1 text-sm text-fg-secondary">
            Business date{" "}
            <span className="font-mono font-semibold text-fg">
              {snapshot.businessDate ?? "unknown"}
            </span>{" "}
            · last synced {stamp(snapshot.savedAt)} ({age(snapshot.savedAt, now)}) · saved for{" "}
            {owner}
          </p>
        </div>
        {others ? (
          <button
            type="button"
            onClick={others}
            className="text-sm font-medium text-brand underline-offset-2 hover:underline"
          >
            Other properties
          </button>
        ) : null}
      </div>

      {old ? (
        <Alert tone="warning">
          This copy is {age(snapshot.savedAt, now)}. Guests may have arrived or left since, and the
          business date may have changed.
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabList label="Offline front office">
          {available.map((v) => (
            <Tab key={v.id} {...tabs.tab(v.id)} onClick={() => setView(v.id)}>
              {v.label}
              <Badge>{(v.id === "rooms" ? snapshot.rooms : snapshot[v.id])?.length ?? 0}</Badge>
            </Tab>
          ))}
        </TabList>
        <SearchInput
          label="Search the offline copy"
          hideLabel
          placeholder="Guest, room or confirmation"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full sm:w-72"
        />
      </div>

      <div {...tabs.panel}>
        {view === "arrivals" && snapshot.arrivals ? (
          <ArrivalsTable
            rows={snapshot.arrivals.filter((r) => match(r.guestName, r.room, r.confirmation))}
          />
        ) : null}
        {(view === "inHouse" || view === "departures") && snapshot[view] ? (
          <StaysTable
            caption={view === "inHouse" ? "In-house guests" : "Departures"}
            rows={snapshot[view]!.filter((r) => match(r.guestName, r.room, r.confirmation))}
          />
        ) : null}
        {view === "rooms" && snapshot.rooms ? (
          <RoomsTable rows={snapshot.rooms.filter((r) => match(r.number, r.guest, r.roomType))} />
        ) : null}
      </div>
    </section>
  );
}

function Guest({ name, vip }: { name: string; vip: string | null }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-medium">{name}</span>
      {vip ? <Badge tone="accent">{vip}</Badge> : null}
    </span>
  );
}

const ARRIVAL_TONE: Record<string, "success" | "warning" | "info" | "brand"> = {
  CHECKED_IN: "success",
  READY: "brand",
  ROOM_NOT_READY: "warning",
  UNASSIGNED: "warning",
  NEEDS_CONFIRMATION: "info",
};

function ArrivalsTable({ rows }: { rows: OfflineArrival[] }) {
  return (
    <TableFrame label="Arrivals (offline copy)">
      <Table caption="Arrivals" minWidth="48rem">
        <THead>
          <tr>
            <Th>Guest</Th>
            <Th>Confirmation</Th>
            <Th>Room</Th>
            <Th>Stay</Th>
            <Th numeric>Guests</Th>
            <Th>ETA</Th>
            <Th>State</Th>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 ? <TableEmpty colSpan={7}>No arrivals in the copy.</TableEmpty> : null}
          {rows.map((r) => (
            <Tr key={r.reservationRoomId}>
              <Td>
                <Guest name={r.guestName} vip={r.vip} />
              </Td>
              <Td className="font-mono text-xs">{r.confirmation}</Td>
              <Td>
                {r.room ?? <span className="text-fg-muted">Unassigned</span>}{" "}
                <span className="text-xs text-fg-muted">{r.roomType}</span>
              </Td>
              <Td className="text-xs whitespace-nowrap">
                {r.arrival} → {r.departure} · {r.nights} n
              </Td>
              <Td numeric>
                {r.adults}
                {r.children ? ` + ${r.children}` : ""}
              </Td>
              <Td>{r.eta ?? "—"}</Td>
              <Td>
                <Badge tone={ARRIVAL_TONE[r.state] ?? "neutral"}>{label(r.state)}</Badge>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </TableFrame>
  );
}

function StaysTable({ caption, rows }: { caption: string; rows: OfflineStay[] }) {
  return (
    <TableFrame label={`${caption} (offline copy)`}>
      <Table caption={caption} minWidth="44rem">
        <THead>
          <tr>
            <Th>Guest</Th>
            <Th>Room</Th>
            <Th>Confirmation</Th>
            <Th>Stay</Th>
            <Th>Status</Th>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 ? <TableEmpty colSpan={5}>No guests in the copy.</TableEmpty> : null}
          {rows.map((r) => (
            <Tr key={r.stayId}>
              <Td>
                <Guest name={r.guestName} vip={r.vip} />
              </Td>
              <Td>
                <span className="font-semibold">{r.room}</span>{" "}
                <span className="text-xs text-fg-muted">{r.roomType}</span>
              </Td>
              <Td className="font-mono text-xs">{r.confirmation}</Td>
              <Td className="text-xs whitespace-nowrap">
                {r.arrival} → {r.departure}
              </Td>
              <Td>
                <Badge tone={r.status === "CHECKED_OUT" ? "neutral" : "brand"}>
                  {label(r.status)}
                </Badge>
                {r.checkoutTiming ? (
                  <span className="ms-2 text-xs text-fg-muted">{label(r.checkoutTiming)}</span>
                ) : null}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </TableFrame>
  );
}

const HK_TONE: Record<string, "success" | "warning" | "info" | "neutral"> = {
  CLEAN: "success",
  INSPECTED: "success",
  DIRTY: "warning",
};

function RoomsTable({ rows }: { rows: OfflineRoom[] }) {
  return (
    <TableFrame label="Rooms (offline copy)">
      <Table caption="Rooms" minWidth="40rem">
        <THead>
          <tr>
            <Th>Room</Th>
            <Th>Type</Th>
            <Th>Floor</Th>
            <Th>Housekeeping</Th>
            <Th>Front office</Th>
            <Th>Guest</Th>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 ? <TableEmpty colSpan={6}>No rooms in the copy.</TableEmpty> : null}
          {rows.map((r) => (
            <Tr key={r.id}>
              <Td className="font-semibold">{r.number}</Td>
              <Td>{r.roomType}</Td>
              <Td>{r.floor ?? "—"}</Td>
              <Td>
                <Badge tone={HK_TONE[r.housekeepingStatus] ?? "neutral"}>
                  {label(r.housekeepingStatus)}
                </Badge>
              </Td>
              <Td className={cn(r.frontOfficeStatus === "OCCUPIED" && "font-medium")}>
                {label(r.frontOfficeStatus)}
              </Td>
              <Td>{r.guest ?? <span className="text-fg-muted">—</span>}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </TableFrame>
  );
}
