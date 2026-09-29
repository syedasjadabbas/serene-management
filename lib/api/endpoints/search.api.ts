import { baseApi } from "@/lib/api/baseApi";
import type { ApiSuccess } from "@/types/api";
import type { AccountListItem } from "@/modules/accounts/accounts.types";
import type { FolioListRow } from "@/modules/billing/billing.types";
import type { GroupListItem } from "@/modules/groups/groups.types";
import type { GuestSummaryView } from "@/modules/guests/guests.types";
import type { MaintenanceListItem } from "@/modules/maintenance/maintenance.types";
import type { ReservationListItem } from "@/modules/reservations/reservations.types";

/**
 * Global search (docs/ARCHITECTURE.md, UI search): no new endpoint. The
 * query fans out, in parallel, to the existing list endpoints that already
 * search with `q` and enforce permissions and property scope on the server:
 * guests and companies (organization profiles), and reservations, folios,
 * groups and maintenance requests of the current property. The caller only
 * enables the sources the user may use (UI gating); a source that still
 * fails (403, network) is left out instead of failing the whole search.
 * Rooms and rate plans are small per-property lists the palette filters
 * locally from their existing cached queries.
 */

export type RemoteSearchSource =
  "reservations" | "guests" | "folios" | "companies" | "groups" | "maintenance";

/**
 * One hit: display fields and the existing record route it opens. `href` is
 * null when there is no property the user may open the record in: the hit
 * is then shown as unavailable, never linked.
 */
export interface SearchHit {
  id: string;
  title: string;
  subtitle: string;
  meta?: string;
  href: string | null;
  vip?: boolean;
}

export interface SearchResultGroup {
  source: RemoteSearchSource;
  hits: SearchHit[];
}

export interface GlobalSearchArgs {
  q: string;
  sources: RemoteSearchSource[];
  /** The current property (id for API scope, code for routes); null in the organization workspace. */
  property: { id: string; code: string } | null;
  /**
   * Property each organization-level record type opens in, resolved by the
   * caller from the user's permitted properties (profileTargetCode); null
   * when there is none.
   */
  profileCodes: { guests: string | null; companies: string | null };
}

const LIMIT = "5";
const titleCase = (value: string) =>
  value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ");
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export const searchApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    globalSearch: build.query<SearchResultGroup[], GlobalSearchArgs>({
      async queryFn({ q, sources, property, profileCodes }, _api, _extra, baseQuery) {
        const params = (extra: Record<string, string> = {}) =>
          new URLSearchParams({ q, limit: LIMIT, ...extra }).toString();
        const get = async <T>(url: string): Promise<T[] | null> => {
          const result = await baseQuery(url);
          if (result.error) return null;
          return (result.data as ApiSuccess<T[]>).data;
        };

        const tasks: Record<RemoteSearchSource, () => Promise<SearchHit[] | null>> = {
          reservations: async () => {
            if (!property) return null;
            const rows = await get<ReservationListItem>(
              `/properties/${property.id}/reservations?${params()}`,
            );
            return (
              rows?.map((r) => ({
                id: r.reservationRoomId,
                title: `#${r.displayConfirmation}`,
                subtitle: `${r.guest.name} · ${shortDate(r.arrival)} → ${shortDate(r.departure)}`,
                meta: `${titleCase(r.bookingState)}${r.room ? ` · Room ${r.room.number}` : ""}`,
                href: `/${property.code}/reservations/${r.reservationId}`,
                vip: r.guest.isVip,
              })) ?? null
            );
          },
          guests: async () => {
            const code = profileCodes.guests;
            const rows = await get<GuestSummaryView>(`/guests?${params()}`);
            return (
              rows?.map((g) => ({
                id: g.id,
                title: g.fullName,
                subtitle: [g.profileNumber, g.email ?? g.phone].filter(Boolean).join(" · "),
                meta: g.vip ? `VIP ${g.vip.code}` : undefined,
                href: code ? `/${code}/guests/${g.id}` : null,
                vip: Boolean(g.vip),
              })) ?? null
            );
          },
          folios: async () => {
            if (!property) return null;
            const rows = await get<FolioListRow>(
              `/properties/${property.id}/folios?${params({ view: "all" })}`,
            );
            return (
              rows?.map((f) => ({
                id: f.reservationRoomId,
                title: f.guestName,
                subtitle: `Folio ${f.confirmation}${f.roomNumber ? ` · Room ${f.roomNumber}` : ""} · ${shortDate(f.arrival)} → ${shortDate(f.departure)}`,
                meta: `${f.currencyCode} ${Number(f.balance).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                href: `/${property.code}/billing/${f.reservationRoomId}`,
              })) ?? null
            );
          },
          companies: async () => {
            const code = profileCodes.companies;
            const rows = await get<AccountListItem>(`/accounts?${params()}`);
            return (
              rows?.map((a) => ({
                id: a.id,
                title: a.name,
                subtitle: [
                  a.code,
                  titleCase(a.type),
                  [a.city, a.countryCode].filter(Boolean).join(", "),
                ]
                  .filter(Boolean)
                  .join(" · "),
                meta: a.status !== "ACTIVE" ? titleCase(a.status) : undefined,
                href: code ? `/${code}/companies/${a.id}` : null,
              })) ?? null
            );
          },
          groups: async () => {
            if (!property) return null;
            const rows = await get<GroupListItem>(`/properties/${property.id}/groups?${params()}`);
            return (
              rows?.map((g) => ({
                id: g.id,
                title: g.name,
                subtitle: [
                  g.code,
                  g.firstNight && g.departure
                    ? `${shortDate(g.firstNight)} → ${shortDate(g.departure)}`
                    : null,
                  g.account,
                ]
                  .filter(Boolean)
                  .join(" · "),
                meta: titleCase(g.status),
                href: `/${property.code}/groups/${g.id}`,
              })) ?? null
            );
          },
          maintenance: async () => {
            if (!property) return null;
            const rows = await get<MaintenanceListItem>(
              `/properties/${property.id}/maintenance?${params({ view: "all" })}`,
            );
            return (
              rows?.map((m) => ({
                id: m.id,
                title: m.title,
                subtitle: `${m.requestNumber} · ${m.room ? `Room ${m.room.number}` : (m.location ?? "Public area")}`,
                meta: `${titleCase(m.priority)} · ${titleCase(m.status)}`,
                href: `/${property.code}/maintenance/${m.id}`,
              })) ?? null
            );
          },
        };

        const settled = await Promise.all(
          sources.map(async (source) => ({
            source,
            hits: await tasks[source]().catch(() => null),
          })),
        );
        return {
          data: settled
            .filter((group): group is SearchResultGroup => Array.isArray(group.hits))
            .filter((group) => group.hits.length > 0),
        };
      },
      keepUnusedDataFor: 30,
    }),
  }),
});

export const { useGlobalSearchQuery } = searchApi;
