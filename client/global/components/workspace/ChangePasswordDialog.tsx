"use client";

import { useState } from "react";
import { FormDialog } from "@/global/components/ui/FormDialog";
import { FormTextField, applyServerError, useZodForm } from "@/global/components/ui/form";
import { PASSWORD_MIN_LENGTH } from "@serene/shared/lib/auth/password-policy";
import { useChangePasswordMutation } from "@/global/api/endpoints/sessionApi";
import { toClientApiError } from "@/global/api/errors";
import {
  changePasswordDefaults,
  changePasswordFormSchema,
  toChangePasswordBody,
} from "./changePasswordForm";

/**
 * The signed-in user changes their password. Every other session is signed
 * out; this browser continues with a fresh session.
 */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [change, state] = useChangePasswordMutation();
  const { control, handleSubmit, setError, formState } = useZodForm(
    changePasswordFormSchema,
    changePasswordDefaults,
  );
  const [done, setDone] = useState(false);
  const error = toClientApiError(state.error);

  if (done) {
    return (
      <FormDialog
        title="Password changed"
        description="You stay signed in here; every other session has been signed out."
        onClose={onClose}
        onSubmit={onClose}
        submitLabel="Done"
        pending={false}
        error={null}
      >
        <p className="text-sm text-fg-secondary">Use the new password next time you sign in.</p>
      </FormDialog>
    );
  }
  return (
    <FormDialog
      title="Change password"
      description={`At least ${PASSWORD_MIN_LENGTH} characters. Other devices will be signed out.`}
      onClose={onClose}
      onSubmit={handleSubmit(async (values) => {
        const result = await change(toChangePasswordBody(values));
        if ("data" in result) setDone(true);
        else applyServerError(setError, toClientApiError(result.error));
      })}
      submitLabel="Change password"
      pending={state.isLoading || formState.isSubmitting}
      error={error}
    >
      <FormTextField
        control={control}
        name="currentPassword"
        label="Current password"
        type="password"
        autoComplete="current-password"
      />
      <FormTextField
        control={control}
        name="newPassword"
        label="New password"
        type="password"
        autoComplete="new-password"
      />
      <FormTextField
        control={control}
        name="confirm"
        label="Repeat the new password"
        type="password"
        autoComplete="new-password"
      />
    </FormDialog>
  );
}
