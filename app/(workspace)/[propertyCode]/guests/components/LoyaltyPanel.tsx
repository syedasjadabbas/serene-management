"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormDialog } from "@/components/ui/FormDialog";
import { Select } from "@/components/ui/Select";
import { StatusPanel } from "@/components/ui/StatusPanel";
import { TextArea } from "@/components/ui/TextArea";
import { TextField } from "@/components/ui/TextField";
import { usePermissions } from "@/hooks/usePermissions";
import { useProperty } from "@/hooks/useProperty";
import {
  useCreateProgramMutation,
  useCreateTierMutation,
  useLoyaltyMembersQuery,
  useLoyaltyOverviewQuery,
  useUpdateProgramMutation,
  useUpdateTierMutation,
} from "@/lib/api/endpoints/loyalty.api";
import { toClientApiError } from "@/lib/api/errors";
import { formatDate } from "@/lib/utils/format";
import type { LoyaltyProgramView, LoyaltyTierView } from "@/modules/loyalty/loyalty.types";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/Table";

type Dialog =
  | null
  | { kind: "program" }
  | { kind: "programStatus"; program: LoyaltyProgramView }
  | { kind: "tier"; program: LoyaltyProgramView; tier?: LoyaltyTierView };

const digits = (value: string) => value.replace(/\D/g, "");

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

function ProgramDialog({ onClose }: { onClose: () => void }) {
  const [create, state] = useCreateProgramMutation();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [isExternal, setIsExternal] = useState(false);
  const [reason, setReason] = useState("");
  const error = toClientApiError(state.error);
  return (
    <FormDialog
      title="New loyalty program"
      onClose={onClose}
      onSubmit={async () => {
        const result = await create({
          code: code.trim(),
          name: name.trim(),
          isExternal,
          reason: reason.trim(),
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Create program"
      disabled={!code.trim() || !name.trim() || reason.trim().length < 3}
      pending={state.isLoading}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={20}
          errors={error?.fieldErrors.code}
        />
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
        />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isExternal}
          onChange={(e) => setIsExternal(e.target.checked)}
        />
        External program (member numbers come from the program, not generated here)
      </label>
      <TextArea
        label="Reason (audited)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
      />
    </FormDialog>
  );
}

function ProgramStatusDialog({
  program,
  onClose,
}: {
  program: LoyaltyProgramView;
  onClose: () => void;
}) {
  const [update, state] = useUpdateProgramMutation();
  const [reason, setReason] = useState("");
  const next = program.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
  return (
    <FormDialog
      title={`${next === "ACTIVE" ? "Activate" : "Deactivate"} ${program.code}`}
      description={
        next === "INACTIVE" ? "Guests can no longer be enrolled; memberships stay." : undefined
      }
      onClose={onClose}
      onSubmit={async () => {
        const result = await update({
          programId: program.id,
          body: { status: next, reason: reason.trim() },
        });
        if ("data" in result) onClose();
      }}
      submitLabel={next === "ACTIVE" ? "Activate" : "Deactivate"}
      danger={next === "INACTIVE"}
      disabled={reason.trim().length < 3}
      pending={state.isLoading}
      error={toClientApiError(state.error)}
    >
      <TextArea
        label="Reason (audited)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
      />
    </FormDialog>
  );
}

function TierDialog({
  program,
  tier,
  onClose,
}: {
  program: LoyaltyProgramView;
  tier?: LoyaltyTierView;
  onClose: () => void;
}) {
  const [create, createState] = useCreateTierMutation();
  const [update, updateState] = useUpdateTierMutation();
  const [code, setCode] = useState(tier?.code ?? "");
  const [name, setName] = useState(tier?.name ?? "");
  const [rank, setRank] = useState(String(tier?.rank ?? program.tiers.length + 1));
  const [nights, setNights] = useState(tier?.qualifyingNights?.toString() ?? "");
  const [stays, setStays] = useState(tier?.qualifyingStays?.toString() ?? "");
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">(tier?.status ?? "ACTIVE");
  const [reason, setReason] = useState("");
  const error = toClientApiError(createState.error ?? updateState.error);
  const num = (v: string) => (v === "" ? null : Number.parseInt(v, 10));
  return (
    <FormDialog
      title={tier ? `Edit tier ${tier.code}` : `New tier · ${program.code}`}
      onClose={onClose}
      onSubmit={async () => {
        const common = {
          name: name.trim(),
          rank: Number.parseInt(rank || "0", 10),
          qualifyingNights: num(nights),
          qualifyingStays: num(stays),
          reason: reason.trim(),
        };
        const result = tier
          ? await update({ tierId: tier.id, body: { ...common, status } })
          : await create({ programId: program.id, body: { ...common, code: code.trim() } });
        if ("data" in result) onClose();
      }}
      submitLabel={tier ? "Save tier" : "Create tier"}
      disabled={(!tier && !code.trim()) || !name.trim() || reason.trim().length < 3}
      pending={createState.isLoading || updateState.isLoading}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={20}
          disabled={!!tier}
          errors={error?.fieldErrors.code}
        />
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
        />
        <TextField
          label="Rank"
          inputMode="numeric"
          value={rank}
          onChange={(e) => setRank(digits(e.target.value))}
        />
        {tier ? (
          <Select
            label="Status"
            options={[
              { value: "ACTIVE", label: "Active" },
              { value: "INACTIVE", label: "Inactive" },
            ]}
            value={status}
            onChange={(e) => setStatus(e.target.value as "ACTIVE" | "INACTIVE")}
          />
        ) : null}
        <TextField
          label="Qualifying nights (optional)"
          inputMode="numeric"
          value={nights}
          onChange={(e) => setNights(digits(e.target.value))}
        />
        <TextField
          label="Qualifying stays (optional)"
          inputMode="numeric"
          value={stays}
          onChange={(e) => setStays(digits(e.target.value))}
        />
      </div>
      <TextArea
        label="Reason (audited)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
      />
    </FormDialog>
  );
}
