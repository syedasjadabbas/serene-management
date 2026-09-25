export type ReportColumnType = "text" | "number" | "money" | "percent" | "date" | "datetime";

export interface ReportColumn {
  key: string;
  label: string;
  type: ReportColumnType;
}

export type ReportCell = string | number | null;
export type ReportRow = Record<string, ReportCell>;

export type ReportGroup = "OPERATIONS" | "ROOMS" | "FINANCE" | "AUDIT";

export interface ReportCatalogItem {
  key: string;
  title: string;
  group: ReportGroup;
  description: string;
  /** Needs a date range (false: a snapshot of now). */
  ranged: boolean;
  /** Offers the room type filter. */
  roomTypeFilter: boolean;
  /** Offers the risk filter (audit trail). */
  riskFilter: boolean;
}

export interface ReportResult extends ReportCatalogItem {
  params: { from: string; to: string; roomTypeId: string | null; risk: string | null };
  businessDate: string;
  currencyCode: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: ReportRow | null;
  /** How the figures were obtained, limits, and hidden columns. */
  notes: string[];
  generatedAt: string;
  canExport: boolean;
}

export interface DashboardView {
  businessDate: string;
  currencyCode: string;
  today: {
    arrivalsExpected: number;
    arrivalsDone: number;
    departuresExpected: number;
    departuresDone: number;
    inHouse: number;
    vipArrivals: number;
    roomsOccupied: number;
    roomsAvailable: number;
    occupancy: string;
  };
  rooms: {
    vacant: number;
    occupied: number;
    dirty: number;
    clean: number;
    inspected: number;
    outOfOrder: number;
    outOfService: number;
  };
  /** Last closed date's KPIs (null before the first audit). */
  lastClosed: {
    businessDate: string;
    occupancy: string;
    roomsSold: number;
    adr: string | null;
    revpar: string | null;
    roomRevenue: string | null;
  } | null;
  /** Up to 30 closed dates, oldest first. */
  trend: { businessDate: string; occupancy: string; adr: string | null; revpar: string | null }[];
  finance: { openBalance: string; openFolios: number } | null;
  access: { financial: boolean; reports: boolean };
}
