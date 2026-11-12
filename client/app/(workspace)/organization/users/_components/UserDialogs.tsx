"use client";

import { useState } from "react";
import { FormDialog } from "@/global/components/ui/FormDialog";
import {
  FormSelect,
  FormTextField,
  applyServerError,
  useZodForm,
} from "@/global/components/ui/form";
import {
  useGrantRoleMutation,
  useInviteUserMutation,
} from "@/global/api/endpoints/organizationApi";
import { toClientApiError } from "@/global/api/errors";
import type { MeView } from "@serene/shared/modules/access/access.types";
import type {
  RoleAssignmentView,
  RoleView,
  UserView,
} from "@serene/shared/modules/users/users.types";
import {
  grantFormDefaults,
  grantFormSchema,
  inviteFormDefaults,
  inviteFormSchema,
  toGrantBody,
  toInviteBody,
} from "../_lib/userForms";
import {
  LinkResult,
  ReasonField,
  ResetDialog,
  RevokeDialog,
  StatusDialog,
} from "./UserReasonDialogs";

export type UserDialog =
  | { kind: "invite" }
  | { kind: "grant"; user: UserView }
  | { kind: "revoke"; user: UserView; assignment: RoleAssignmentView }
  | { kind: "disable"; user: UserView }
  | { kind: "unlock"; user: UserView }
  | { kind: "enable"; user: UserView }
  | { kind: "reset"; user: UserView };

interface ScopeProps {
  roles: RoleView[];
  orgManage: boolean;
  managedProperties: MeView["properties"];
  onClose: () => void;
}

/** Role grant / revoke and account status changes; each is audited with a reason. */
export function UserDialogs({
  dialog,
  roles,
  orgManage,
  managedProperties,
  onClose,
}: ScopeProps & { dialog: UserDialog }) {
  const scopeProps = { roles, orgManage, managedProperties, onClose };
  if (dialog.kind === "invite") return <InviteDialog {...scopeProps} />;
  if (dialog.kind === "grant") return <GrantDialog user={dialog.user} {...scopeProps} />;
  if (dialog.kind === "revoke") {
    return <RevokeDialog user={dialog.user} assignment={dialog.assignment} onClose={onClose} />;
  }
  if (dialog.kind === "reset") return <ResetDialog user={dialog.user} onClose={onClose} />;
  return <StatusDialog user={dialog.user} action={dialog.kind} onClose={onClose} />;
}

function scopeOptions(orgManage: boolean, managedProperties: MeView["properties"]) {
  return [
    ...(orgManage ? [{ value: "ORGANIZATION", label: "Whole organization" }] : []),
    ...managedProperties.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })),
  ];
}

/**
 * Adds a user with a first role. The account stays “Invited” until the
 * person opens the one-time link (24 hours) and chooses a password; while
 * the user is still invited, “Reset password” issues a new link.
 */
function InviteDialog({ roles, orgManage, managedProperties, onClose }: ScopeProps) {
  const [invite, state] = useInviteUserMutation();
  const scopes = scopeOptions(orgManage, managedProperties);
  const { control, handleSubmit, setError, formState } = useZodForm(
    inviteFormSchema,
    inviteFormDefaults(roles[0]?.id ?? "", scopes[0]?.value ?? ""),
  );
  const [link, setLink] = useState<{ url: string; expiresAt: string; name: string } | null>(null);
  const error = toClientApiError(state.error);
  if (link) {
    return (
      <LinkResult
        title={`Invitation link for ${link.name}`}
        description="Shown only once. Give it to the new user in person or over a trusted channel. They choose their own password with it, and the account becomes active when they do."
        link={link}
        onClose={onClose}
      />
    );
  }
  return (
    <FormDialog
      title="Add a user"
      description="The new user receives one role now; add more later with Grant role. You can grant only roles whose permissions you hold in that scope."
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const result = await invite(toInviteBody(values));
        if ("data" in result && result.data) {
          setLink({
            url: result.data.setupUrl,
            expiresAt: result.data.expiresAt,
            name: result.data.user.displayName,
          });
        } else if ("error" in result) {
          applyServerError(setError, toClientApiError(result.error));
        }
      })}
      submitLabel="Add user"
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <FormTextField
        control={control}
        name="displayName"
        label="Full name"
        maxLength={120}
        autoComplete="off"
        required
      />
      <FormTextField
        control={control}
        name="email"
        label="E-mail (sign-in name)"
        type="email"
        maxLength={254}
        autoComplete="off"
        required
      />
      <FormSelect
        control={control}
        name="roleId"
        label="Role"
        options={roles.map((r) => ({ value: r.id, label: r.name }))}
      />
      <FormSelect control={control} name="scope" label="Scope" options={scopes} />
      <ReasonField control={control} />
    </FormDialog>
  );
}

function GrantDialog({
  user,
  roles,
  orgManage,
  managedProperties,
  onClose,
}: ScopeProps & { user: UserView }) {
  const [grant, state] = useGrantRoleMutation();
  const scopes = scopeOptions(orgManage, managedProperties);
  const { control, handleSubmit, setError, formState } = useZodForm(
    grantFormSchema,
    grantFormDefaults(roles[0]?.id ?? "", scopes[0]?.value ?? ""),
  );
  const error = toClientApiError(state.error);
  return (
    <FormDialog
      title={`Grant a role to ${user.displayName}`}
      description="You can grant only roles whose permissions you hold in that scope."
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const result = await grant({ userId: user.id, body: toGrantBody(values) });
        if ("data" in result) onClose();
        else applyServerError(setError, toClientApiError(result.error));
      })}
      submitLabel="Grant role"
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <FormSelect
        control={control}
        name="roleId"
        label="Role"
        options={roles.map((r) => ({ value: r.id, label: r.name }))}
      />
      <FormSelect control={control} name="scope" label="Scope" options={scopes} />
      <ReasonField control={control} />
    </FormDialog>
  );
}
