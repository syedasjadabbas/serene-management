"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";
import { useCompletePasswordResetMutation } from "@/lib/api/endpoints/session.api";
import { toClientApiError } from "@/lib/api/errors";

/** Reads the one-time token from the fragment and sets the new password. */
export function ResetPasswordForm() {
  // undefined: not read yet; null: the link carries no token.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    await complete({ token, newPassword: password });
  }

  const mismatch = confirm.length > 0 && confirm !== password;
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
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
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters`}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        errors={apiError?.fieldErrors.newPassword}
      />
      <TextField
        label="Repeat the new password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        errors={mismatch ? ["The passwords do not match"] : undefined}
      />
      <Button
        type="submit"
        pending={isLoading}
        disabled={!token || password.length < PASSWORD_MIN_LENGTH || confirm !== password}
        className="w-full"
      >
        Set password
      </Button>
    </form>
  );
}
