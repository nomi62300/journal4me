import type { Metadata, Viewport } from "next";
import { Inter, Roboto_Mono } from "next/font/google";

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
};

// theme-color matches the light/dark background tokens in globals.css, so the
// browser chrome (and later, the PWA install bar) doesn't flash a mismatched
// colour against the app's own background on load.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#18181b" },
  ],
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
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
