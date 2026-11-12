"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Alert } from "@/global/components/ui/Alert";
import { Button } from "@/global/components/ui/Button";
import { FormPasswordField, applyServerError, useZodForm } from "@/global/components/ui/form";
import { PASSWORD_MIN_LENGTH } from "@serene/shared/lib/auth/password-policy";
import { useCompletePasswordResetMutation } from "@/global/api/endpoints/sessionApi";
import { toClientApiError } from "@/global/api/errors";
import { resetPasswordDefaults, resetPasswordFormSchema } from "../_lib/resetPasswordForm";

/** Reads the one-time token from the fragment and sets the new password. */
export function ResetPasswordForm() {
  // undefined: not read yet; null: the link carries no token.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const { control, handleSubmit, setError, formState } = useZodForm(
    resetPasswordFormSchema,
    resetPasswordDefaults,
  );
  const [complete, { isLoading, error, isSuccess }] = useCompletePasswordResetMutation();
  const apiError = toClientApiError(error);

  const readOnce = useRef(false);

  useEffect(() => {
    // Read once: the fragment is cleared below, and Strict Mode re-runs effects.
    if (readOnce.current) return;
    readOnce.current = true;
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
    // Remove the token from the address bar and history once it is read.
    window.history.replaceState(null, "", window.location.pathname);
    // The fragment is only readable after mount (it never reaches the server).
    setToken(value);
  }, []);

  if (isSuccess) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success">Your password was changed. Sign in with the new password.</Alert>
        <Link
          href="/login"
          className="text-center text-sm font-medium text-brand underline-offset-2 hover:underline"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  async function onSubmit(values: { newPassword: string }) {
    if (!token) return;
    const result = await complete({ token, newPassword: values.newPassword });
    if ("error" in result) {
      applyServerError(setError, toClientApiError(result.error), ["newPassword"]);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      {token === null ? (
        <Alert tone="danger">
          This reset link is incomplete. Ask an administrator for a new one.
        </Alert>
      ) : null}
      {apiError ? (
        <Alert tone="danger">
          {apiError.code === "RATE_LIMITED"
            ? "Too many attempts. Please wait a minute and try again."
            : apiError.message}
        </Alert>
      ) : null}
      <FormPasswordField
        control={control}
        name="newPassword"
        label="New password"
        autoComplete="new-password"
        controlSize="lg"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters`}
      />
      <FormPasswordField
        control={control}
        name="confirm"
        label="Repeat the new password"
        autoComplete="new-password"
        controlSize="lg"
      />
      <Button
        type="submit"
        size="touch"
        pending={isLoading || formState.isSubmitting}
        disabled={!token}
        className="w-full"
      >
        Set password
      </Button>
    </form>
  );
}
