"use client";

import { useId } from "react";
import { cn } from "@/components/ui/cn";
import { BRAND_GREEN, BRAND_MINT, MARK_S_PATH, MARK_SPINE_PATH } from "./Logo";

/**
 * Brand loader for session restore and page loading: the SERENE mark draws
 * its "S" (white stroke and mint spine revealed together through one
 * animated mask), a status line, and a slim indeterminate bar. Motion is a
 * slow, eased loop; with reduced motion the mark is shown complete and the
 * bar is hidden. Announced once as a polite status.
 *
 * `size="lg"` is for full pages (route loading, session restore), `md` for a
 * loading region inside a page. `heading` renders the title as that heading
 * level, so a loading page still has its h1 (StatusPanel level).
 */
export function BrandLoader({
  title,
  description,
  size = "lg",
  heading,
}: {
  title: string;
  description?: string;
  size?: "md" | "lg";
  heading?: 1 | 2;
}) {
  const maskId = `${useId()}-draw`;
  const Title = heading === 1 ? "h1" : heading === 2 ? "h2" : "p";
  const large = size === "lg";
  return (
    <div
      role="status"
      className={cn("flex flex-col items-center text-center", large ? "gap-7" : "gap-5")}
    >
      <svg
        viewBox="0 0 32 32"
        aria-hidden="true"
        className={cn(
          large
            ? "size-16 rounded-2xl shadow-[0_8px_24px_rgb(21_130_60/0.18)]"
            : "size-12 rounded-xl shadow-[0_6px_18px_rgb(21_130_60/0.16)]",
        )}
      >
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
            <path
              d={MARK_S_PATH}
              fill="none"
              stroke="#fff"
              strokeWidth="4.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="sm-mark-draw"
            />
          </mask>
        </defs>
        <rect width="32" height="32" rx="8" fill={BRAND_GREEN} />
        <g mask={`url(#${maskId})`}>
          <path
            d={MARK_S_PATH}
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="3.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d={MARK_SPINE_PATH} fill="none" stroke={BRAND_MINT} strokeWidth="3.3" />
        </g>
      </svg>
      <div className="flex flex-col items-center gap-1.5">
        <Title className={cn("font-semibold text-fg", large ? "text-base" : "text-sm")}>
          {title}
        </Title>
        {description ? (
          <p className="max-w-xs text-sm text-pretty text-fg-secondary">{description}</p>
        ) : null}
      </div>
      <div
        aria-hidden="true"
        className={cn(
          "relative h-[3px] overflow-hidden rounded-full bg-border-subtle motion-reduce:hidden",
          large ? "w-44" : "w-32",
        )}
      >
        <span className="sm-indeterminate absolute inset-y-0 start-0 w-2/5 rounded-full bg-brand" />
      </div>
    </div>
  );
}
