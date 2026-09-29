import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

type Tone = "danger" | "warning" | "info" | "success";

const TONES: Record<Tone, string> = {
  danger: "border-danger/30 bg-danger-subtle text-danger",
  warning: "border-warning/30 bg-warning-subtle text-warning",
  info: "border-info/30 bg-info-subtle text-info",
  success: "border-success/30 bg-success-subtle text-success",
};

const ICONS = { danger: CircleAlert, warning: TriangleAlert, info: Info, success: CircleCheck };

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
  const Icon = ICONS[tone];
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn("flex gap-2.5 rounded-md border px-3.5 py-2.5 text-sm", TONES[tone], className)}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
