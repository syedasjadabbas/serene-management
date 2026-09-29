"use client";

import { useId } from "react";
import { BRAND_GREEN, BRAND_MINT, MARK_S_PATH, MARK_SPINE_PATH } from "./Logo";

/**
 * Full-screen brand loader (session restore, first load): the SERENE mark
 * draws its "S" (white stroke and mint spine revealed together through one
 * animated mask), a status line, and a slim indeterminate bar. Motion is a
 * slow, eased loop; with reduced motion the mark is shown complete and the
 * bar is hidden. Announced once as a polite status.
 */
export function BrandLoader({ title, description }: { title: string; description?: string }) {
  const maskId = `${useId()}-draw`;
  return (
    <div role="status" className="flex flex-col items-center gap-7 text-center">
      <svg
        viewBox="0 0 32 32"
        aria-hidden="true"
        className="size-16 rounded-2xl shadow-[0_8px_24px_rgb(21_130_60/0.18)]"
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
        <p className="text-base font-semibold text-fg">{title}</p>
        {description ? (
          <p className="max-w-xs text-sm text-pretty text-fg-secondary">{description}</p>
        ) : null}
      </div>
      <div
        aria-hidden="true"
        className="relative h-[3px] w-44 overflow-hidden rounded-full bg-border-subtle motion-reduce:hidden"
      >
        <span className="sm-indeterminate absolute inset-y-0 start-0 w-2/5 rounded-full bg-brand" />
      </div>
    </div>
  );
}
