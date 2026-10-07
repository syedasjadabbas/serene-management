"use client";

import { useState } from "react";
import { cn } from "./cn";

/**
 * Up to two initials ("Syed Asjad Abbas" → "SA"; "Farooq, Daniyal" → "FD").
 * A parenthesised suffix is a note, not part of the name ("Imran Ali
 * (Housekeeping)" → "IA", not "I("), and only words that start with a letter
 * or digit count.
 */
export function initials(name: string): string {
  const words = (source: string) =>
    source
      .replace(/[,;/]/g, " ")
      .split(/\s+/)
      .filter((word) => /^[\p{L}\p{N}]/u.test(word));
  let parts = words(name.replace(/\([^)]*\)?/g, " "));
  if (parts.length === 0) parts = words(name.replace(/[()]/g, " "));
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return letters.map((part) => part!.charAt(0).toUpperCase()).join("") || "?";
}

const SIZES = {
  sm: "size-7 text-2xs",
  md: "size-9 text-xs",
  lg: "size-12 text-base",
  xl: "size-20 text-xl",
};

/**
 * Avatar for people (users, guests): the profile picture when there is one,
 * initials otherwise (also when the image fails to load). Decorative: the
 * name is always shown or announced next to it, so it is hidden from
 * assistive technology. SERENE family look: a rounded square. Guests use
 * the soft mint tile; `tone="solid"` (green, white initials) is the signed-in
 * user; `tone="accent"` marks VIP guests.
 */
export function Avatar({
  name,
  src,
  size = "md",
  tone = "brand",
  className,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof SIZES;
  tone?: "brand" | "solid" | "accent" | "neutral";
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = Boolean(src) && failed !== src;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-md font-semibold",
        SIZES[size],
        tone === "accent"
          ? "bg-accent-subtle text-accent"
          : tone === "neutral"
            ? "bg-surface-sunken text-fg-secondary"
            : tone === "solid"
              ? "bg-brand text-brand-fg"
              : "bg-brand-subtle text-brand",
        className,
      )}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- small same-origin private image; next/image adds nothing here
        <img
          src={src!}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(src ?? null)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
