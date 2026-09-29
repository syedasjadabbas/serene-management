import type { Metadata } from "next";
import { connection } from "next/server";
import { Geist, Geist_Mono, IBM_Plex_Sans_Arabic } from "next/font/google";
import { DEFAULT_LOCALE, directionOf } from "@/lib/i18n/config";
import { Providers } from "./providers";
import "./globals.css";

// Geist is the SERENE family typeface (shared with SALESTORM).
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const plexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-plex-arabic",
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "SERENE MANAGEMENT", template: "%s · SERENE MANAGEMENT" },
  description: "Hotel property management system",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page renders per request so Next.js can apply the CSP nonce set by proxy.ts.
  await connection();
  // Locale becomes per-user in Phase 1 (users.locale); the document direction
  // follows it so RTL layouts come from logical CSS properties, not forks.
  const locale = DEFAULT_LOCALE;
  return (
    <html
      lang={locale}
      dir={directionOf(locale)}
      className={`${geist.variable} ${plexArabic.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
