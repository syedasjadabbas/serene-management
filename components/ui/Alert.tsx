import type { ReactNode } from "react";
import { cn } from "./cn";

type Tone = "danger" | "warning" | "info" | "success";

const TONES: Record<Tone, string> = {
  danger: "border-danger/40 bg-danger-subtle text-danger",
  warning: "border-warning/40 bg-warning-subtle text-warning",
  info: "border-info/40 bg-info-subtle text-info",
  success: "border-success/40 bg-success-subtle text-success",
};

/** Inline message. Danger/warning are announced immediately (role="alert"). */
export function Alert({
  tone = "info",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn("rounded-md border px-3 py-2 text-sm", TONES[tone], className)}
    >
      {children}
    </div>
  );
}
