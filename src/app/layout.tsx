import type { Metadata, Viewport } from "next";
import { Inter, Roboto_Mono } from "next/font/google";
import { SerwistProvider } from "@serwist/turbopack/react";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

// Inter / Roboto Mono match Medusa's admin design system font stack
// (packages/design-system/ui-preset/src/constants.ts).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "journal4me",
    template: "%s · journal4me",
  },
  description:
    "A trading journal for forex, indices, commodities and crypto — across personal accounts and prop firm challenges.",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  // Checked rather than assumed: the classic apple-mobile-web-app-capable
  // meta tag is now deprecated (Safari falls back to it only when it can't
  // load the manifest), and this Next.js version already renders the
  // current mobile-web-app-capable tag for `capable: true` — confirmed live
  // in the rendered <head>. The setting that actually launches iOS
  // Home-Screen installs standalone (the precondition for iOS push at all,
  // see sw.ts) is manifest.ts's display: "standalone"; this block supplies
  // the status-bar style and title Safari reads alongside it.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "journal4me",
  },
};

// theme-color matches the light/dark background tokens in globals.css, so the
// browser chrome (and later, the PWA install bar) doesn't flash a mismatched
// colour against the app's own background on load. viewportFit: "cover" lets
// the bottom tab bar sit under the iPhone's home indicator instead of a hard
// white/black bar beneath it once installed — env(safe-area-inset-*) in the
// tab bar's own CSS is what then pads content clear of it.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#18181b" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning is next-themes' own documented requirement:
    // it sets the theme class on <html> before React hydrates, which would
    // otherwise mismatch the server-rendered markup on the first paint.
    <html
      lang="en"
      className={`${inter.variable} ${robotoMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* Registers /sw/sw.js on mount. cacheOnNavigation/reloadOnOnline stay
            at their defaults — this app has no offline story to build yet
            (see sw.ts: dev precaching is disabled entirely), only push. */}
        <SerwistProvider swUrl="/sw/sw.js">
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            {children}
            <Toaster />
          </ThemeProvider>
        </SerwistProvider>
      </body>
    </html>
  );
}
