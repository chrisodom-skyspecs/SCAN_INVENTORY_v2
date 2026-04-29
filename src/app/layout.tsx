/**
 * Root layout — SkySpecs INVENTORY + SCAN
 *
 * Applies:
 *   • Design system CSS tokens (src/styles/tokens/base.css)
 *   • Typography: Inter Tight (UI) + IBM Plex Mono (data)
 *   • Light theme default; dark theme via .theme-dark on <html>
 *   • ConvexProvider for real-time reactive subscriptions
 */

import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import "../styles/tokens/base.css";
import "../styles/tokens/breakpoints.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "SkySpecs INVENTORY + SCAN",
  description:
    "Track equipment cases through assembly, deployment, field inspection, shipping, and return.",
  manifest: "/manifest.json",
  // Apple touch icon (iOS "Add to Home Screen")
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SkySpecs SCAN",
  },
  icons: {
    // Standard favicon
    icon: [
      { url: "/icons/icon-192.svg", type: "image/svg+xml" },
      { url: "/icons/icon-512.svg", sizes: "512x512", type: "image/svg+xml" },
    ],
    // Apple touch icon — used when "Add to Home Screen" on iOS
    apple: [
      { url: "/icons/icon-180.svg", sizes: "180x180", type: "image/svg+xml" },
      { url: "/icons/icon-152.svg", sizes: "152x152", type: "image/svg+xml" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#002c6b",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Inter Tight — primary UI typeface */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter+Tight:ital,wght@0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
