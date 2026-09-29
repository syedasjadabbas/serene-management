import Image from "next/image";
import type { ReactNode } from "react";
import { SereneLogo } from "@/components/brand/Logo";
import heroImage from "./serene-heights.webp";

/** What the product covers, as plain facts (no figures). */
const MODULES = [
  { label: "Front office", value: "Arrivals & stays" },
  { label: "Rooms", value: "Housekeeping" },
  { label: "Finance", value: "Folios & audit" },
];

/**
 * Sign-in frame (SERENE family, as SALESTORM's): from lg a photo panel of
 * Serene Heights carries the product statement and the form sits on white;
 * below lg it is a single column with the logo above the form. The photo
 * is decorative; a solid scrim keeps the white text at >= 4.5:1.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const year = new Date().getFullYear();
  return (
    <main className="grid min-h-screen bg-surface lg:grid-cols-[minmax(0,11fr)_minmax(0,10fr)]">
      <section
        aria-label="SERENE MANAGEMENT"
        className="relative hidden overflow-hidden bg-[#0f1a14] text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-14"
      >
        <Image
          src={heroImage}
          alt=""
          fill
          priority
          placeholder="blur"
          sizes="55vw"
          className="object-cover object-center"
        />
        <div aria-hidden="true" className="absolute inset-0 bg-[rgb(8_18_12/0.62)]" />

        <div className="relative">
          <SereneLogo size="lg" tone="inverse" />
        </div>

        <div className="relative max-w-xl">
          <p className="text-2xs font-semibold tracking-[0.18em] text-white/80 uppercase">
            Hotel operations
          </p>
          <p className="mt-4 text-4xl leading-[1.08] font-bold tracking-[-0.03em] text-balance xl:text-5xl">
            Run every stay from one workspace.
          </p>
          <p className="mt-5 max-w-md text-base text-pretty text-white/85">
            Reservations, front desk, housekeeping, billing and night audit for every SERENE
            property, each on its own business date.
          </p>
          <ul className="mt-9 grid max-w-lg grid-cols-3 gap-3">
            {MODULES.map((module) => (
              <li
                key={module.label}
                className="rounded-lg border border-white/15 bg-white/[0.08] px-4 py-3.5"
              >
                <p className="text-2xs font-semibold tracking-[0.12em] text-white/75 uppercase">
                  {module.label}
                </p>
                <p className="mt-1 text-sm font-semibold text-white">{module.value}</p>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/70">© {year} SERENE MANAGEMENT</p>
      </section>

      <div className="flex min-h-screen flex-col items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-[25rem]">
          <div className="mb-10 lg:hidden">
            <SereneLogo />
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
