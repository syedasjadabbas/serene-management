import { cn } from "@/components/ui/cn";

/** Geometry of the mark (32-unit box), shared with the animated BrandLoader. */
export const MARK_S_PATH =
  "M21.4 10.2C20.2 8.8 18.3 8 16.1 8C12.9 8 10.7 9.7 10.7 12.2C10.7 13.5 11.3 14.3 12.4 14.9C13.4 15.4 14.6 15.7 16 16C17.4 16.3 18.6 16.6 19.6 17.1C20.7 17.7 21.3 18.6 21.3 19.9C21.3 22.4 19 24 15.9 24C13.5 24 11.5 23.1 10.3 21.6";
export const MARK_SPINE_PATH = "M12.4 14.9C13.4 15.4 14.6 15.7 16 16C17.4 16.3 18.6 16.6 19.6 17.1";
export const BRAND_GREEN = "#107C41";
export const BRAND_MINT = "#BFE6CC";

/**
 * SERENE MANAGEMENT brand (docs/DESIGN_SYSTEM.md §Brand).
 *
 * Mark: a rounded green tile (#107C41, the SERENE family green) with a single-weight "S" drawn as one
 * stroke; its diagonal spine is mint (#BFE6CC), the only accent. Flat
 * colours, no gradients or effects, so it stays crisp from 16 px up and
 * reads the same on light and dark backgrounds (the tile carries its own
 * contrast). Colours are fixed brand values, not theme tokens, so the mark
 * never changes with the UI theme.
 */
export function SereneMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0", className)}
    >
      <rect width="32" height="32" rx="8" fill={BRAND_GREEN} />
      <path
        d={MARK_S_PATH}
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="3.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d={MARK_SPINE_PATH} fill="none" stroke={BRAND_MINT} strokeWidth="3.3" />
    </svg>
  );
}

/**
 * Horizontal lockup for the sidebar, header and sign-in page: mark +
 * "SERENE" (bold, open tracking) over "MANAGEMENT" (small, widely spaced,
 * muted). `tone="inverse"` is for dark backgrounds. The visible text is the
 * accessible name, so the lockup needs no extra label.
 */
export function SereneLogo({
  size = "md",
  tone = "default",
  className,
}: {
  size?: "sm" | "md" | "lg";
  tone?: "default" | "inverse";
  className?: string;
}) {
  const inverse = tone === "inverse";
  return (
    <span
      className={cn("inline-flex items-center", size === "lg" ? "gap-3" : "gap-2.5", className)}
    >
      <SereneMark className={size === "lg" ? "size-11" : size === "sm" ? "size-7" : "size-9"} />
      <span className="flex flex-col leading-none">
        <span
          className={cn(
            "font-bold tracking-[0.14em]",
            size === "lg" ? "text-xl" : size === "sm" ? "text-sm" : "text-base",
            inverse ? "text-white" : "text-fg",
          )}
        >
          SERENE
        </span>{" "}
        <span
          className={cn(
            "mt-1 font-medium tracking-[0.42em]",
            size === "lg" ? "text-2xs" : "text-[0.5625rem]",
            inverse ? "text-[#b4c3bb]" : "text-fg-muted",
          )}
        >
          MANAGEMENT
        </span>
      </span>
    </span>
  );
}
