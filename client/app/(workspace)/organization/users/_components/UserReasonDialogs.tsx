"use client";

import { useRef, useState } from "react";
import type { Control, FieldPath, FieldValues } from "react-hook-form";
import { FormDialog } from "@/global/components/ui/FormDialog";
import { FormTextArea, applyServerError, useZodForm } from "@/global/components/ui/form";
import { TextArea } from "@/global/components/ui/TextArea";
import {
  useIssuePasswordResetMutation,
  useRevokeRoleMutation,
  useUserStatusMutation,
} from "@/global/api/endpoints/organizationApi";
import { toClientApiError } from "@/global/api/errors";
import type { RoleAssignmentView, UserView } from "@serene/shared/modules/users/users.types";
import { reasonFormDefaults, reasonFormSchema } from "../_lib/userForms";

/** The audited reason every user command asks for. */
export function ReasonField<T extends FieldValues & { reason: string }>({
  control,
}: {
  control: Control<T, unknown, T>;
}) {
  return (
    <FormTextArea
      control={control}
      name={"reason" as FieldPath<T>}
      label="Reason (required)"
      maxLength={1000}
    />
  );
}

/**
 * Issues a one-time reset link (30 minutes). It is shown once, here: the
 * administrator hands it to the user over a trusted channel.
 */
export function ResetDialog({ user, onClose }: { user: UserView; onClose: () => void }) {
  const [issue, state] = useIssuePasswordResetMutation();
  const { control, handleSubmit, setError, formState } = useZodForm(
    reasonFormSchema,
    reasonFormDefaults,
  );
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const error = toClientApiError(state.error);
  const invited = user.status === "INVITED";
  if (link) {
    return (
      <LinkResult
        title={`${invited ? "New invitation link" : "Reset link"} for ${user.displayName}`}
        description={
          invited
            ? "Shown only once. Give it to the user in person or over a trusted channel. Earlier invitation links no longer work."
            : "Shown only once. Give it to the user in person or over a trusted channel. Their old password and every session have been revoked."
        }
        link={link}
        onClose={onClose}
      />
    );
  }
  return (
    <FormDialog
      title={
        invited
          ? `Send ${user.displayName} a new invitation link`
          : `Reset the password of ${user.displayName}`
      }
      description={
        invited
          ? "The user has not set a password yet. You receive a new one-time link valid for 24 hours; earlier links stop working."
          : "The current password stops working and the user is signed out everywhere. You receive a one-time link valid for 30 minutes."
      }
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const result = await issue({ userId: user.id, reason: values.reason });
        if ("data" in result && result.data) {
          setLink({ url: result.data.resetUrl, expiresAt: result.data.expiresAt });
        } else if ("error" in result) {
          applyServerError(setError, toClientApiError(result.error));
        }
      })}
      submitLabel={invited ? "Issue new link" : "Reset password"}
      danger={!invited}
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <ReasonField control={control} />
    </FormDialog>
  );
}

/** One-time link shown once after an invitation or a reset (the administrator hands it over). */
export function LinkResult({
  title,
  description,
  link,
  onClose,
}: {
  title: string;
  description: string;
  link: { url: string; expiresAt: string };
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<"yes" | "manual" | null>(null);
  const linkRef = useRef<HTMLTextAreaElement>(null);
  return (
    <FormDialog
      title={title}
      description={description}
      onClose={onClose}
      onSubmit={onClose}
      submitLabel="Done"
      pending={false}
      error={null}
    >
      <TextArea ref={linkRef} label="One-time link" value={link.url} readOnly rows={3} />
      <p className="text-xs text-fg-secondary">
        Expires {new Date(link.expiresAt).toLocaleString()}. It works once.
      </p>
      <button
        type="button"
        className="self-start text-sm font-medium text-brand underline-offset-2 hover:underline"
        onClick={async () => {
          // The Clipboard API exists only in secure contexts (HTTPS, localhost) and
          // may be refused; then the link is selected for a manual copy.
          try {
            await navigator.clipboard.writeText(link.url);
            setCopied("yes");
          } catch {
            linkRef.current?.focus();
            linkRef.current?.select();
            setCopied("manual");
          }
        }}
      >
        {copied === "yes"
          ? "Copied"
          : copied === "manual"
            ? "Link selected: press Ctrl+C to copy"
            : "Copy link"}
      </button>
    </FormDialog>
  );
}

export function RevokeDialog({
  user,
  assignment,
  onClose,
}: {
  user: UserView;
  assignment: RoleAssignmentView;
  onClose: () => void;
}) {
  const [revoke, state] = useRevokeRoleMutation();
  const { control, handleSubmit, setError, formState } = useZodForm(
    reasonFormSchema,
    reasonFormDefaults,
  );
  const error = toClientApiError(state.error);
  const where =
    assignment.scope === "ORGANIZATION" ? "the organization" : assignment.property?.code;
  return (
    <FormDialog
      title={`Revoke ${assignment.role.name}`}
      description={`${user.displayName} loses this role at ${where}. Their sessions pick up the change on the next request.`}
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const result = await revoke({
          userId: user.id,
          assignmentId: assignment.id,
          reason: values.reason,
        });
        if ("data" in result) onClose();
        else applyServerError(setError, toClientApiError(result.error));
      })}
      submitLabel="Revoke role"
      danger
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <ReasonField control={control} />
    </FormDialog>
  );
}

export function StatusDialog({
  user,
  action,
  onClose,
}: {
  user: UserView;
  action: "disable" | "unlock" | "enable";
  onClose: () => void;
}) {
  const [change, state] = useUserStatusMutation();
  const { control, handleSubmit, setError, formState } = useZodForm(
    reasonFormSchema,
    reasonFormDefaults,
  );
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
      onSubmit={handleSubmit(async (values) => {
        const result = await change({ userId: user.id, action, reason: values.reason });
        if ("data" in result) onClose();
        else applyServerError(setError, toClientApiError(result.error));
      })}
      submitLabel={
        action === "disable" ? "Disable user" : action === "enable" ? "Enable user" : "Unlock user"
      }
      danger={action === "disable"}
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <ReasonField control={control} />
    </FormDialog>
  );
}
