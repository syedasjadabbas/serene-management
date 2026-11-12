"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { Badge } from "@/global/components/ui/Badge";
import { Button } from "@/global/components/ui/Button";
import { Select } from "@/global/components/ui/Select";
import { StatusPanel } from "@/global/components/ui/StatusPanel";
import { usePermissions } from "@/global/hooks/usePermissions";
import { useProperty } from "@/global/hooks/useProperty";
import { useLoyaltyMembersQuery, useLoyaltyOverviewQuery } from "@/global/api/endpoints/loyaltyApi";
import { toClientApiError } from "@/global/api/errors";
import { formatDate } from "@serene/shared/lib/utils/format";
import type {
  LoyaltyProgramView,
  LoyaltyTierView,
} from "@serene/shared/modules/loyalty/loyalty.types";
import { Table, TBody, Td, Th, THead, Tr } from "@/global/components/ui/Table";
import { ProgramDialog, ProgramStatusDialog, TierDialog } from "./LoyaltyDialogs";

type Dialog =
  | null
  | { kind: "program" }
  | { kind: "programStatus"; program: LoyaltyProgramView }
  | { kind: "tier"; program: LoyaltyProgramView; tier?: LoyaltyTierView };

/**
 * Loyalty foundation: programs, tiers and their members. Points are not
 * earned automatically yet (that needs the night audit's stay events).
 */
export function LoyaltyPanel() {
  const property = useProperty();
  const { can } = usePermissions(property.id);
  const query = useLoyaltyOverviewQuery();
  const error = toClientApiError(query.error);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const manage = query.data?.actions.manage ?? false;
  const programs = query.data?.programs ?? [];
  const programId = selected ?? programs[0]?.id ?? null;

  if (query.isLoading) return <StatusPanel kind="loading" title="Loading loyalty" />;
  if (error)
    return <StatusPanel kind="error" title="Could not load loyalty" description={error.message} />;
  return (
    <section className="flex flex-col gap-4" aria-label="Loyalty">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-fg-muted">
          Enroll guests from their profile. Points are adjusted manually for now; automatic earning
          arrives with night audit.
        </p>
        {manage ? (
          <Button className="ms-auto" onClick={() => setDialog({ kind: "program" })}>
            New program
          </Button>
        ) : null}
      </div>
      {programs.length === 0 ? <StatusPanel kind="empty" title="No loyalty program yet" /> : null}
      {programs.map((program) => (
        <section
          key={program.id}
          className="rounded-lg border border-border-subtle bg-surface shadow-card"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2.5">
            <h2 className="font-semibold">
              {program.code} · {program.name}
            </h2>
            <Badge tone={program.status === "ACTIVE" ? "success" : "neutral"}>
              {program.status.toLowerCase()}
            </Badge>
            {program.isExternal ? <Badge tone="info">External</Badge> : null}
            <span className="text-xs text-fg-muted">
              {program.members} member{program.members === 1 ? "" : "s"}
            </span>
            {manage ? (
              <span className="ms-auto flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  className="min-h-11 md:min-h-0"
                  onClick={() => setDialog({ kind: "tier", program })}
                >
                  New tier
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-11 md:min-h-0"
                  onClick={() => setDialog({ kind: "programStatus", program })}
                >
                  {program.status === "ACTIVE" ? "Deactivate" : "Activate"}
                </Button>
              </span>
            ) : null}
          </div>
          <div className="relative overflow-x-auto">
            <Table caption={`Tiers of ${program.name}`} minWidth="520px">
              <THead>
                <tr>
                  <Th>Rank</Th>
                  <Th>Tier</Th>
                  <Th>Qualifies at</Th>
                  <Th>Members</Th>
                  <Th>Status</Th>
                  {manage ? (
                    <Th>
                      <span className="sr-only">Actions</span>
                    </Th>
                  ) : null}
                </tr>
              </THead>
              <TBody>
                {program.tiers.length === 0 ? (
                  <Tr interactive>
                    <Td className="text-fg-secondary" colSpan={6}>
                      No tiers yet.
                    </Td>
                  </Tr>
                ) : null}
                {program.tiers.map((tier) => (
                  <Tr interactive key={tier.id}>
                    <Td className="tabular-nums">{tier.rank}</Td>
                    <Td>
                      {tier.code} · {tier.name}
                    </Td>
                    <Td className="text-fg-secondary">
                      {[
                        tier.qualifyingNights !== null ? `${tier.qualifyingNights} nights` : null,
                        tier.qualifyingStays !== null ? `${tier.qualifyingStays} stays` : null,
                      ]
                        .filter(Boolean)
                        .join(" or ") || "—"}
                    </Td>
                    <Td className="tabular-nums">{tier.members}</Td>
                    <Td>{tier.status.toLowerCase()}</Td>
                    {manage ? (
                      <Td>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="min-h-11 md:min-h-0"
                          onClick={() => setDialog({ kind: "tier", program, tier })}
                        >
                          Edit
                        </Button>
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        </section>
      ))}
      {programs.length > 0 && can("guests:read") ? (
        <MembersList
          key={programId}
          programs={programs}
          programId={programId!}
          onProgramChange={setSelected}
          propertyCode={property.code}
        />
      ) : null}
      {dialog?.kind === "program" ? <ProgramDialog onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "programStatus" ? (
        <ProgramStatusDialog program={dialog.program} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "tier" ? (
        <TierDialog program={dialog.program} tier={dialog.tier} onClose={() => setDialog(null)} />
      ) : null}
    </section>
  );
}

function MembersList({
  programs,
  programId,
  onProgramChange,
  propertyCode,
}: {
  programs: LoyaltyProgramView[];
  programId: string;
  onProgramChange: (id: string) => void;
  propertyCode: string;
}) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const members = useLoyaltyMembersQuery({ programId, cursor: cursors.at(-1) });
  const membersError = toClientApiError(members.error);
  // `currentData` belongs to the current page only; never show another page's rows.
  const data = members.currentData;
  const loading = members.isFetching && !data && !membersError;
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="text-lg font-semibold tracking-[-0.01em]">Members</h2>
        <Select
          label="Program"
          options={programs.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
          value={programId}
          onChange={(e) => {
            onProgramChange(e.target.value);
            setCursors([undefined]);
          }}
          className="ms-auto"
        />
      </div>
      {loading ? <StatusPanel kind="loading" title="Loading members" /> : null}
      {membersError ? (
        <StatusPanel
          kind="error"
          title="Could not load members"
          description={membersError.message}
          requestId={membersError.requestId}
          action={
            <Button variant="secondary" onClick={() => void members.refetch()}>
              Retry
            </Button>
          }
        />
      ) : null}
      {data && data.items.length === 0 ? (
        <p className="text-sm text-fg-secondary">No members yet.</p>
      ) : null}
      {data && data.items.length > 0 ? (
        <div className="relative overflow-x-auto" aria-busy={members.isFetching}>
          <Table caption="Members of the program" minWidth="560px">
            <THead>
              <tr>
                <Th>Member</Th>
                <Th>Number</Th>
                <Th>Tier</Th>
                <Th numeric>Points</Th>
                <Th>Status</Th>
                <Th>Since</Th>
              </tr>
            </THead>
            <TBody>
              {data.items.map((m) => (
                <Tr interactive key={m.membershipId}>
                  <Td>
                    <Link
                      href={`/${propertyCode}/guests/${m.guest.id}` as Route}
                      className="text-brand hover:underline"
                    >
                      {m.guest.fullName}
                    </Link>
                  </Td>
                  <Td className="font-mono text-xs">{m.membershipNumber}</Td>
                  <Td>{m.tier ?? "—"}</Td>
                  <Td numeric>{m.pointsBalance}</Td>
                  <Td>{m.status.toLowerCase()}</Td>
                  <Td className="whitespace-nowrap">{formatDate(m.enrolledAt.slice(0, 10))}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      ) : null}
      {cursors.length > 1 || data?.meta.nextCursor ? (
        <div className="flex justify-between gap-2">
          <Button
            variant="secondary"
            disabled={cursors.length <= 1}
            onClick={() => setCursors((c) => c.slice(0, -1))}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            disabled={!data?.meta.nextCursor}
            onClick={() => {
              const next = data?.meta.nextCursor;
              if (next) setCursors((c) => [...c, next]);
            }}
          >
            Next
          </Button>
        </div>
      ) : null}
    </section>
  );
}
