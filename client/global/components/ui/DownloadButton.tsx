"use client";

import { type ReactNode, useState } from "react";
import { downloadApiFile } from "@/global/api/download";
import { Button, type ButtonSize, type ButtonVariant } from "./Button";

/**
 * Button that downloads an API file (e.g. a CSV export). `path` is relative
 * to the API base. The request carries the Bearer header, so it cannot be a
 * plain link; a failure is announced next to the button.
 */
export function DownloadButton({
  path,
  fallbackName,
  variant = "secondary",
  size = "sm",
  children,
}: {
  path: string;
  fallbackName: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      await downloadApiFile(path, fallbackName);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The export failed. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button variant={variant} size={size} pending={pending} onClick={() => void run()}>
        {children}
      </Button>
      {error ? (
        <span role="alert" className="self-center text-xs text-danger">
          {error}
        </span>
      ) : null}
    </>
  );
}
