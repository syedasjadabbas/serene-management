"use client";

import {
  BedDouble,
  Blocks,
  CalendarDays,
  LayoutDashboard,
  LogIn,
  Palette,
  Shapes,
  Plus,
  RefreshCw,
  Table2,
  Type,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { BrandLoader } from "@/components/brand/BrandLoader";
import { SereneLogo, SereneMark } from "@/components/brand/Logo";
import { Alert } from "@/components/ui/Alert";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, Count, StatusDot } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Drawer } from "@/components/ui/Drawer";
import { IconButton } from "@/components/ui/IconButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { Tab, TabList } from "@/components/ui/TabList";
import { TBody, THead, Table, TableFrame, Td, Th, Tr } from "@/components/ui/Table";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { useTabs } from "@/components/ui/tabs";
import { AppShell } from "@/components/workspace/AppShell";
import { MobileNav } from "@/components/workspace/MobileNav";
import { PrimaryNav } from "@/components/workspace/PrimaryNav";
import type { NavEntry } from "@/components/workspace/nav";

const SECTIONS = [
  { id: "brand", label: "Brand", icon: Shapes },
  { id: "colour", label: "Colour", icon: Palette },
  { id: "type", label: "Typography", icon: Type },
  { id: "actions", label: "Actions", icon: LayoutDashboard },
  { id: "forms", label: "Forms", icon: CalendarDays },
  { id: "status", label: "Status", icon: Blocks },
  { id: "data", label: "Tables & cards", icon: Table2 },
] as const;

const SWATCHES: [string, string][] = [
  ["canvas", "bg-canvas"],
  ["surface", "bg-surface"],
  ["surface-sunken", "bg-surface-sunken"],
  ["border-subtle", "bg-border-subtle"],
  ["border-strong", "bg-border-strong"],
  ["fg", "bg-fg"],
  ["fg-secondary", "bg-fg-secondary"],
  ["brand", "bg-brand"],
  ["brand-subtle", "bg-brand-subtle"],
  ["accent", "bg-accent"],
  ["accent-subtle", "bg-accent-subtle"],
  ["nav", "bg-nav"],
  ["success", "bg-success"],
  ["warning", "bg-warning"],
  ["danger", "bg-danger"],
  ["info", "bg-info"],
  ["chart-1", "bg-chart-1"],
  ["chart-2", "bg-chart-2"],
  ["chart-3", "bg-chart-3"],
  ["chart-4", "bg-chart-4"],
];

const ARRIVALS = [
  {
    conf: "SMR-10482",
    guest: "Amina Qureshi",
    room: "204",
    type: "Deluxe King",
    eta: "14:00",
    balance: "0.00",
    status: ["Confirmed", "brand"],
  },
  {
    conf: "SMR-10483",
    guest: "Daniel Ortega",
    room: "—",
    type: "Twin Garden",
    eta: "15:30",
    balance: "12,400.00",
    status: ["Deposit due", "warning"],
  },
  {
    conf: "SMR-10486",
    guest: "Hana Sato",
    room: "311",
    type: "Suite",
    eta: "17:00",
    balance: "0.00",
    status: ["VIP", "accent"],
  },
  {
    conf: "SMR-10490",
    guest: "Omar Farooq",
    room: "108",
    type: "Deluxe King",
    eta: "—",
    balance: "3,250.00",
    status: ["Checked in", "success"],
  },
] as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20">
      <h2 id={`${id}-h`} className="mb-3 text-lg font-semibold">
        {title}
      </h2>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** The catalogue's sections as one navigation menu (anchors on this page). */
const catalogNav: NavEntry[] = [
  {
    kind: "group",
    id: "sections",
    label: "Sections",
    icon: SECTIONS[0]!.icon,
    items: SECTIONS.map((section) => ({
      href: `#${section.id}`,
      label: section.label,
      icon: section.icon,
      active: false,
    })),
  },
];

export function DesignSystemCatalog() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [filter, setFilter] = useState("all");
  const [tab, setTab] = useState<"arrivals" | "departures" | "in-house">("arrivals");
  const tabs = useTabs(["arrivals", "departures", "in-house"] as const, tab, setTab);
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);

  function applyTheme(next: "light" | "dark") {
    setTheme(next);
    // Light is the default; dark is opt-in via data-theme (never the OS setting).
    if (next === "light") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
  }

  return (
    <AppShell
      nav={<PrimaryNav label="Design system" entries={catalogNav} />}
      mobileNav={<MobileNav label="Design system" entries={catalogNav} />}
      context={<span className="px-2 text-sm font-medium">SERENE design system</span>}
      actions={
        <ToggleGroup
          label="Theme"
          value={theme}
          onChange={applyTheme}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      }
    >
      <PageHeader
        breadcrumbs={[{ label: "SERENE" }, { label: "Design system" }]}
        title="Design system"
        description="Every SERENE primitive and state on one page. Development only; see docs/DESIGN_SYSTEM.md for the rules behind them."
        meta={<Badge tone="brand">Batch 0</Badge>}
        actions={
          <>
            <Button variant="secondary">
              <RefreshCw aria-hidden="true" className="size-4" />
              Refresh
            </Button>
            <Button>
              <Plus aria-hidden="true" className="size-4" />
              New reservation
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-10">
        <Section id="brand" title="Brand">
          <Card title="Brand loader" description="Session restore and other full-screen waits.">
            <div className="flex justify-center py-8">
              <BrandLoader
                title="Restoring your session"
                description="Just a moment while we sign you back in securely."
              />
            </div>
          </Card>
          <Card>
            <div className="flex flex-col gap-6">
              <div className="flex flex-wrap items-end gap-6">
                <SereneMark className="size-40" title="SERENE MANAGEMENT" />
                <SereneMark className="size-16" />
                <SereneMark className="size-8" />
                <SereneMark className="size-6" />
                <SereneMark className="size-4" />
              </div>
              <div className="flex flex-wrap items-center gap-8">
                <SereneLogo size="lg" />
                <SereneLogo />
                <SereneLogo size="sm" />
              </div>
              <div className="flex flex-wrap items-center gap-8 rounded-lg bg-[#10231b] p-6">
                <SereneLogo size="lg" tone="inverse" />
                <SereneLogo tone="inverse" />
                <SereneMark className="size-4" />
              </div>
            </div>
          </Card>
        </Section>

        <Section id="colour" title="Colour">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
            {SWATCHES.map(([name, className]) => (
              <div
                key={name}
                className="overflow-hidden rounded-md border border-border-subtle bg-surface"
              >
                <div className={`h-12 ${className}`} />
                <p className="px-2 py-1.5 font-mono text-2xs text-fg-secondary">{name}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="type" title="Typography">
          <Card>
            <div className="flex flex-col gap-3">
              <p className="text-2xl font-semibold">24 · Key figure 78%</p>
              <p className="text-xl font-semibold">20 · Page title</p>
              <p className="text-lg font-semibold">16 · Card and dialog title</p>
              <p className="text-base">14 · Body text for descriptions and forms.</p>
              <p className="text-sm">13 · Table cells, controls and dense lists.</p>
              <p className="text-xs text-fg-secondary">12 · Labels and secondary cells</p>
              <p className="text-2xs text-fg-muted">11 · Meta and chart ticks</p>
              <p className="font-mono text-sm">SMR-10482 · 2026-09-29 · 12,400.00</p>
            </div>
          </Card>
        </Section>

        <Section id="actions" title="Actions">
          <Card
            title="Buttons"
            description="Primary once per view; danger only for destructive commands."
          >
            <div className="flex flex-col gap-4">
              {(["md", "sm", "touch"] as const).map((size) => (
                <div key={size} className="flex flex-wrap items-center gap-2">
                  <Button size={size}>Check in</Button>
                  <Button size={size} variant="secondary">
                    Assign room
                  </Button>
                  <Button size={size} variant="ghost">
                    Cancel
                  </Button>
                  <Button size={size} variant="danger">
                    Void charge
                  </Button>
                  <Button size={size} pending>
                    Saving
                  </Button>
                  <Button size={size} disabled>
                    Disabled
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <IconButton label="Refresh">
                  <RefreshCw aria-hidden="true" className="size-4" />
                </IconButton>
                <IconButton label="Add" variant="secondary">
                  <Plus aria-hidden="true" className="size-4" />
                </IconButton>
                <IconButton label="Refresh" size="sm">
                  <RefreshCw aria-hidden="true" className="size-3.5" />
                </IconButton>
              </div>
            </div>
          </Card>
          <Card title="Overlays">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setDialog(true)}>
                Open dialog
              </Button>
              <Button variant="secondary" onClick={() => setDrawer(true)}>
                Open drawer
              </Button>
            </div>
          </Card>
        </Section>

        <Section id="forms" title="Forms">
          <Card>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <TextField
                label="Guest name"
                placeholder="First and last name"
                hint="As on the ID document"
              />
              <TextField
                label="Email"
                type="email"
                defaultValue="guest@"
                errors={["Enter a complete email address"]}
              />
              <TextField label="Arrival" type="date" defaultValue="2026-09-29" />
              <Select
                label="Room type"
                placeholder="Any room type"
                options={[
                  { value: "dk", label: "Deluxe King" },
                  { value: "tg", label: "Twin Garden" },
                ]}
              />
              <TextField label="Disabled" disabled defaultValue="Read only" />
              <TextArea label="Notes" placeholder="Arrival notes for the front desk" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" defaultChecked className="size-4" />
                Send confirmation email
              </label>
            </div>
          </Card>
          <ToggleGroup
            label="Arrival filter"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All", count: 24 },
              { value: "unassigned", label: "Unassigned", count: 5 },
              { value: "vip", label: "VIP", count: 2 },
              { value: "late", label: "Late arrival" },
            ]}
          />
        </Section>

        <Section id="status" title="Status">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard
              icon={BedDouble}
              label="Occupancy tonight"
              value="78%"
              hint="25 of 32 rooms sold"
              progress={78}
            />
            <StatCard
              icon={LogIn}
              tone="info"
              label="Arrivals to check in"
              value={12}
              hint="4 of 16 checked in"
              progress={25}
            />
          </div>
          <div className="flex items-center gap-3">
            <Avatar name="Amina Qureshi" size="sm" />
            <Avatar name="Hana Sato" tone="accent" />
            <Avatar name="Omar Farooq" size="lg" tone="neutral" />
          </div>
          <Card>
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                <Badge>Neutral</Badge>
                <Badge tone="brand">Confirmed</Badge>
                <Badge tone="accent">VIP</Badge>
                <Badge tone="success" dot>
                  Clean
                </Badge>
                <Badge tone="warning" dot>
                  Due out
                </Badge>
                <Badge tone="danger" dot>
                  Out of order
                </Badge>
                <Badge tone="info" dot>
                  Inspecting
                </Badge>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                <StatusDot tone="info">Occupied</StatusDot>
                <StatusDot tone="success">Vacant clean</StatusDot>
                <StatusDot tone="warning">Vacant dirty</StatusDot>
                <StatusDot tone="danger">Out of order</StatusDot>
                <StatusDot>Out of service</StatusDot>
              </div>
              <Alert tone="info">Night audit runs at 02:00 property time.</Alert>
              <Alert tone="success">Payment of 12,400.00 PKR recorded.</Alert>
              <Alert tone="warning">Room 204 is still dirty; the guest arrives at 14:00.</Alert>
              <Alert tone="danger">The folio could not be settled: balance is not zero.</Alert>
            </div>
          </Card>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <StatusPanel
                kind="empty"
                title="No arrivals today"
                description="Reservations arriving on the business date appear here."
              />
            </Card>
            <Card>
              <StatusPanel kind="loading" title="Loading arrivals" />
            </Card>
            <Card>
              <StatusPanel
                kind="error"
                title="Could not load arrivals"
                description="The server did not respond."
                requestId="req_01J9Z…"
                action={<Button variant="secondary">Try again</Button>}
              />
            </Card>
            <Card>
              <StatusPanel
                kind="forbidden"
                title="Access denied"
                description="You need the frontdesk:read permission."
              />
            </Card>
          </div>
        </Section>

        <Section id="data" title="Tables & cards">
          <Card
            flush
            title="Front desk"
            description="Tabs switch views of one subject; chips filter a list."
            actions={
              <Button size="sm" variant="secondary">
                Export
              </Button>
            }
          >
            <div className="px-4 pt-2">
              <TabList label="Front desk lists">
                {(["arrivals", "departures", "in-house"] as const).map((id) => (
                  <Tab key={id} {...tabs.tab(id)} onClick={() => setTab(id)}>
                    {id === "in-house" ? "In house" : id[0]!.toUpperCase() + id.slice(1)}
                    <Count>{id === "arrivals" ? 24 : id === "departures" ? 18 : 142}</Count>
                  </Tab>
                ))}
              </TabList>
            </div>
            <div {...tabs.panel}>
              <TableFrame label="Arrivals" bordered={false}>
                <Table caption="Arrivals today" minWidth="44rem">
                  <THead>
                    <tr>
                      <Th>Confirmation</Th>
                      <Th>Guest</Th>
                      <Th>Room</Th>
                      <Th>Room type</Th>
                      <Th>ETA</Th>
                      <Th numeric>Balance</Th>
                      <Th>Status</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {ARRIVALS.map((row) => (
                      <Tr key={row.conf} interactive>
                        <Td className="font-mono text-xs">{row.conf}</Td>
                        <Td className="font-medium">{row.guest}</Td>
                        <Td>{row.room}</Td>
                        <Td className="text-fg-secondary">{row.type}</Td>
                        <Td>{row.eta}</Td>
                        <Td numeric>{row.balance}</Td>
                        <Td>
                          <Badge tone={row.status[1]}>{row.status[0]}</Badge>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </TableFrame>
            </div>
          </Card>
          <Card title="Loading placeholders" flush>
            <SkeletonRows rows={3} columns={5} label="Loading departures" />
            <div className="flex gap-3 p-4">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 flex-1" />
            </div>
          </Card>
        </Section>
      </div>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Check in guest"
        description="Amina Qureshi · SMR-10482 · Room 204"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(false)}>
              Close
            </Button>
            <Button onClick={() => setDialog(false)}>Check in</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <TextField label="ID document number" autoFocus />
          <Alert tone="warning">A deposit of 12,400.00 PKR is outstanding.</Alert>
        </div>
      </Dialog>
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Room 204">
        <div className="flex flex-col gap-3 p-4 text-sm">
          <Badge tone="success" dot className="self-start">
            Vacant clean
          </Badge>
          <p className="text-fg-secondary">Deluxe King · Floor 2 · Last cleaned 11:40 by Maria.</p>
        </div>
      </Drawer>
    </AppShell>
  );
}
