import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from "next/font/google";
import { DEFAULT_LOCALE, directionOf } from "@/lib/i18n/config";
import { Providers } from "./providers";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-plex-arabic",
  subsets: ["arabic"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: { default: "SERENE MANAGEMENT", template: "%s · SERENE MANAGEMENT" },
  description: "Hotel property management system",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Locale becomes per-user in Phase 1 (users.locale); the document direction
  // follows it so RTL layouts come from logical CSS properties, not forks.
  const locale = DEFAULT_LOCALE;
  return (
    <html
      lang={locale}
      dir={directionOf(locale)}
      className={`${plexSans.variable} ${plexArabic.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
