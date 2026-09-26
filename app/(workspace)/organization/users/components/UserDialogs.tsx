"use client";

import { useState } from "react";
import { FormDialog } from "@/components/ui/FormDialog";
import { Select } from "@/components/ui/Select";
import { TextArea } from "@/components/ui/TextArea";
import {
  useGrantRoleMutation,
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
  | { kind: "unlock"; user: UserView };

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
  return <StatusDialog user={dialog.user} action={dialog.kind} onClose={onClose} />;
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
  action: "disable" | "unlock";
  onClose: () => void;
}) {
  const [change, state] = useUserStatusMutation();
  const [reason, setReason] = useState("");
  const error = toClientApiError(state.error);
  return (
    <FormDialog
      title={action === "disable" ? `Disable ${user.displayName}` : `Unlock ${user.displayName}`}
      description={
        action === "disable"
          ? "The user is signed out everywhere and can no longer sign in."
          : "Clears the lockout so the user can sign in again."
      }
      onClose={onClose}
      onSubmit={async () => {
        const result = await change({ userId: user.id, action, reason: reason.trim() });
        if ("data" in result) onClose();
      }}
      submitLabel={action === "disable" ? "Disable user" : "Unlock user"}
      danger={action === "disable"}
      disabled={reason.trim().length < 3}
      pending={state.isLoading}
      error={error}
    >
      <Reason value={reason} onChange={setReason} errors={error?.fieldErrors.reason} />
    </FormDialog>
  );
}
