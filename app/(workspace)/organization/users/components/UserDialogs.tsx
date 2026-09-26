"use client";

import { useState } from "react";
import { FormDialog } from "@/components/ui/FormDialog";
import { Select } from "@/components/ui/Select";
import { TextArea } from "@/components/ui/TextArea";
import {
  useGrantRoleMutation,
  useIssuePasswordResetMutation,
  useRevokeRoleMutation,
  useUserStatusMutation,
} from "@/lib/api/endpoints/organization.api";
import { toClientApiError } from "@/lib/api/errors";
import type { MeView } from "@/modules/access/access.types";
import type { RoleAssignmentView, RoleView, UserView } from "@/modules/users/users.types";

export type UserDialog =
  | { kind: "grant"; user: UserView }
  | { kind: "revoke"; user: UserView; assignment: RoleAssignmentView }
  | { kind: "disable"; user: UserView }
  | { kind: "unlock"; user: UserView }
  | { kind: "enable"; user: UserView }
  | { kind: "reset"; user: UserView };

/** Role grant / revoke and account status changes; each is audited with a reason. */
export function UserDialogs({
  dialog,
  roles,
  orgManage,
  managedProperties,
  onClose,
}: {
  dialog: UserDialog;
  roles: RoleView[];
  orgManage: boolean;
  managedProperties: MeView["properties"];
  onClose: () => void;
}) {
  if (dialog.kind === "grant") {
    return (
      <GrantDialog
        user={dialog.user}
        roles={roles}
        orgManage={orgManage}
        managedProperties={managedProperties}
        onClose={onClose}
      />
    );
  }
  if (dialog.kind === "revoke") {
    return <RevokeDialog user={dialog.user} assignment={dialog.assignment} onClose={onClose} />;
  }
  if (dialog.kind === "reset") return <ResetDialog user={dialog.user} onClose={onClose} />;
  return <StatusDialog user={dialog.user} action={dialog.kind} onClose={onClose} />;
}

/**
 * Issues a one-time reset link (30 minutes). It is shown once, here: the
 * administrator hands it to the user over a trusted channel.
 */
function ResetDialog({ user, onClose }: { user: UserView; onClose: () => void }) {
  const [issue, state] = useIssuePasswordResetMutation();
  const [reason, setReason] = useState("");
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const error = toClientApiError(state.error);
  if (link) {
    return (
      <FormDialog
        title={`Reset link for ${user.displayName}`}
        description="Shown only once. Give it to the user in person or over a trusted channel. Their old password and every session have been revoked."
        onClose={onClose}
        onSubmit={onClose}
        submitLabel="Done"
        pending={false}
        error={null}
      >
        <TextArea label="One-time link" value={link.url} readOnly rows={3} />
        <p className="text-xs text-fg-secondary">
          Expires {new Date(link.expiresAt).toLocaleString()}. It works once.
        </p>
        <button
          type="button"
          className="self-start text-sm font-medium text-brand underline-offset-2 hover:underline"
          onClick={async () => {
            await navigator.clipboard.writeText(link.url);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </FormDialog>
    );
  }
  return (
    <FormDialog
      title={`Reset the password of ${user.displayName}`}
      description="The current password stops working and the user is signed out everywhere. You receive a one-time link valid for 30 minutes."
      onClose={onClose}
      onSubmit={async () => {
        const result = await issue({ userId: user.id, reason: reason.trim() });
        if ("data" in result && result.data) {
          setLink({ url: result.data.resetUrl, expiresAt: result.data.expiresAt });
        }
      }}
      submitLabel="Reset password"
      danger
      disabled={reason.trim().length < 3}
      pending={state.isLoading}
      error={error}
    >
      <Reason value={reason} onChange={setReason} errors={error?.fieldErrors.reason} />
    </FormDialog>
  );
}

function Reason({
  value,
  onChange,
  errors,
}: {
  value: string;
  onChange: (value: string) => void;
  errors?: string[];
}) {
  return (
    <TextArea
      label="Reason (required)"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={1000}
      errors={errors}
    />
  );
}

function GrantDialog({
  user,
  roles,
  orgManage,
  managedProperties,
  onClose,
}: {
  user: UserView;
  roles: RoleView[];
  orgManage: boolean;
  managedProperties: MeView["properties"];
  onClose: () => void;
}) {
  const [grant, state] = useGrantRoleMutation();
  const scopes = [
    ...(orgManage ? [{ value: "ORGANIZATION", label: "Whole organization" }] : []),
    ...managedProperties.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })),
  ];
  const [scope, setScope] = useState(scopes[0]?.value ?? "");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const error = toClientApiError(state.error);
  return (
    <FormDialog
      title={`Grant a role to ${user.displayName}`}
      description="You can grant only roles whose permissions you hold in that scope."
      onClose={onClose}
      onSubmit={async () => {
        const body =
          scope === "ORGANIZATION"
            ? { scope: "ORGANIZATION" as const, roleId, reason: reason.trim() }
            : { scope: "PROPERTY" as const, roleId, propertyId: scope, reason: reason.trim() };
        const result = await grant({ userId: user.id, body });
        if ("data" in result) onClose();
      }}
      submitLabel="Grant role"
      disabled={!scope || !roleId || reason.trim().length < 3}
      pending={state.isLoading}
      error={error}
    >
      <Select
        label="Role"
        value={roleId}
        onChange={(e) => setRoleId(e.target.value)}
        options={roles.map((r) => ({ value: r.id, label: r.name }))}
      />
      <Select
        label="Scope"
        value={scope}
        onChange={(e) => setScope(e.target.value)}
        options={scopes}
      />
      <Reason value={reason} onChange={setReason} errors={error?.fieldErrors.reason} />
    </FormDialog>
  );
}

function RevokeDialog({
  user,
  assignment,
  onClose,
}: {
  user: UserView;
  assignment: RoleAssignmentView;
  onClose: () => void;
}) {
  const [revoke, state] = useRevokeRoleMutation();
  const [reason, setReason] = useState("");
  const error = toClientApiError(state.error);
  const where =
    assignment.scope === "ORGANIZATION" ? "the organization" : assignment.property?.code;
  return (
    <FormDialog
      title={`Revoke ${assignment.role.name}`}
      description={`${user.displayName} loses this role at ${where}. Their sessions pick up the change on the next request.`}
      onClose={onClose}
      onSubmit={async () => {
        const result = await revoke({
          userId: user.id,
          assignmentId: assignment.id,
          reason: reason.trim(),
        });
        if ("data" in result) onClose();
      }}
      submitLabel="Revoke role"
      danger
      disabled={reason.trim().length < 3}
      pending={state.isLoading}
      error={error}
    >
      <Reason value={reason} onChange={setReason} errors={error?.fieldErrors.reason} />
    </FormDialog>
  );
}

function StatusDialog({
  user,
  action,
  onClose,
}: {
  user: UserView;
  action: "disable" | "unlock" | "enable";
  onClose: () => void;
}) {
  const [change, state] = useUserStatusMutation();
  const [reason, setReason] = useState("");
  const error = toClientApiError(state.error);
  return (
    <FormDialog
      title={`${action === "disable" ? "Disable" : action === "enable" ? "Enable" : "Unlock"} ${user.displayName}`}
      description={
        action === "disable"
          ? "The user is signed out everywhere and can no longer sign in."
          : action === "enable"
            ? "The user can sign in again with their password (a new session is required)."
            : "Clears the lockout so the user can sign in again."
      }
      onClose={onClose}
      onSubmit={async () => {
        const result = await change({ userId: user.id, action, reason: reason.trim() });
        if ("data" in result) onClose();
      }}
      submitLabel={
        action === "disable" ? "Disable user" : action === "enable" ? "Enable user" : "Unlock user"
      }
      danger={action === "disable"}
      disabled={reason.trim().length < 3}
      pending={state.isLoading}
      error={error}
    >
      <Reason value={reason} onChange={setReason} errors={error?.fieldErrors.reason} />
    </FormDialog>
  );
}
