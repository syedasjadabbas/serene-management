"use client";

import { useState } from "react";
import { FormDialog } from "@/components/ui/FormDialog";
import { TextField } from "@/components/ui/TextField";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";
import { useChangePasswordMutation } from "@/lib/api/endpoints/session.api";
import { toClientApiError } from "@/lib/api/errors";

/**
 * The signed-in user changes their password. Every other session is signed
 * out; this browser continues with a fresh session.
 */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [change, state] = useChangePasswordMutation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const error = toClientApiError(state.error);
  const mismatch = confirm.length > 0 && confirm !== next;

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
      onSubmit={async () => {
        const result = await change({ currentPassword: current, newPassword: next });
        if ("data" in result) setDone(true);
      }}
      submitLabel="Change password"
      disabled={!current || next.length < PASSWORD_MIN_LENGTH || confirm !== next}
      pending={state.isLoading}
      error={error}
    >
      <TextField
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        errors={error?.fieldErrors.currentPassword}
      />
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        errors={error?.fieldErrors.newPassword}
      />
      <TextField
        label="Repeat the new password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        errors={mismatch ? ["The passwords do not match"] : undefined}
      />
    </FormDialog>
  );
}
