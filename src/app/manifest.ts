import type { MetadataRoute } from "next";

// Installability (and, on iOS, push itself — Safari only delivers web push
// to a PWA added to the Home Screen, never to a browser tab) depends on this
// file, icons/, and the service worker at /sw/sw.js all being present and
// correctly linked. See RootLayout for the <link rel="manifest"> and the
// registration call.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "journal4me",
    short_name: "journal4me",
    description:
      "A trading journal for forex, indices, commodities and crypto — across personal accounts and prop firm challenges.",
    start_url: "/dashboard",
    display: "standalone",
    // Matches globals.css's dark bg-subtle / the RootLayout viewport
    // theme-color for dark mode — most trading happens after the open, and
    // the install splash screen shouldn't flash light before the app paints.
    background_color: "#18181b",
    theme_color: "#18181b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
