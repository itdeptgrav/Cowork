import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/layout/shell/AppShell";
import { themeScript } from "@/components/layout/shell/ThemeContext";
import { DEVICE_MODE_BOOT_SCRIPT } from "@/components/layout/shell/DeviceModeContext";

/**
 * One neo-grotesque doing every job, differentiated by weight and tracking
 * rather than by family. A second family would be decoration here.
 */
const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cowork — Workspace",
  description:
    "One workspace for tasks, projects, meetings, communication, documents and team workflows — where the work gets done and where it gets measured.",
};

export const viewport: Viewport = {
  // Two entries so the browser chrome matches the resolved theme rather than
  // flashing a light bar over a dark page.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#cfcfcf" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0e" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning is required and correct here: the inline script
    // below sets `data-theme` on this element before React hydrates, so the
    // server-rendered attribute set will legitimately differ from the DOM.
    <html lang="en" className={`${geist.variable} h-full`} suppressHydrationWarning>
      <head>
        {/* Blocking, before paint — this is what prevents the theme flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* Before first paint, for the same reason as the theme script: a
            low-end machine must not render one frosted, animated frame and then
            drop it. That frame is the most expensive in the session and it is
            precisely what the mode exists to avoid. */}
        <script dangerouslySetInnerHTML={{ __html: DEVICE_MODE_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[200] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-[15px] focus:text-[var(--body-bg)]"
        >
          Skip to content
        </a>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
