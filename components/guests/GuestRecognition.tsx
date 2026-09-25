"use client";

import Link from "next/link";
import type { Route } from "next";
import { Badge } from "@/components/ui/Badge";
import { useGuestQuery } from "@/lib/api/endpoints/guests.api";

/**
 * Recognition strip for a guest (reservation, stay): VIP, loyalty tier,
 * companies, preferences and alert notes — each shown only when the server
 * returned it for the caller's permissions.
 */
export function GuestRecognition({
  guestId,
  propertyCode,
}: {
  guestId: string;
  propertyCode: string;
}) {
  const query = useGuestQuery(guestId);
  const g = query.data;
  if (!g) return null;
  const loyalty = (g.loyalty ?? []).filter((m) => m.status === "ACTIVE");
  const hasAnything =
    g.vip ||
    g.isRestricted ||
    loyalty.length > 0 ||
    (g.companies?.length ?? 0) > 0 ||
    g.preferences.length > 0 ||
    g.alerts.length > 0;
  return (
    <section
      aria-label="Guest recognition"
      className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-surface-sunken px-3 py-2 text-sm"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Link
          href={`/${propertyCode}/guests/${g.id}` as Route}
          className="font-medium text-brand hover:underline"
        >
          {g.displayName}
        </Link>
        {g.vip ? <Badge tone="brand">{g.vip.name}</Badge> : null}
        {g.isRestricted ? <Badge tone="danger">Restricted</Badge> : null}
        {loyalty.map((m) => (
          <Badge key={m.id} tone="success">
            {m.program.code} {m.tier?.name ?? "member"} · {m.membershipNumber}
          </Badge>
        ))}
        {(g.companies ?? []).map((c) => (
          <Badge key={c.account.id}>{c.account.name}</Badge>
        ))}
        {g.statistics.stays > 0 ? (
          <span className="text-xs text-fg-muted">
            {g.statistics.stays} stay{g.statistics.stays === 1 ? "" : "s"} on record
          </span>
        ) : null}
        {!hasAnything && g.statistics.stays === 0 ? (
          <span className="text-xs text-fg-muted">First stay · no preferences recorded</span>
        ) : null}
      </div>
      {g.preferences.length > 0 ? (
        <p className="text-xs text-fg-secondary">
          Prefers:{" "}
          {g.preferences
            .map((p) => p.preferenceCode.name + (p.note ? ` (${p.note})` : ""))
            .join(", ")}
        </p>
      ) : null}
      {g.alerts.map((alert, i) => (
        <p key={i} className="text-xs font-medium text-warning">
          ⚠ {alert}
        </p>
      ))}
    </section>
  );
}
