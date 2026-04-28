/**
 * providers.tsx
 *
 * Client-side provider tree for the SkySpecs INVENTORY + SCAN apps.
 * Wraps children with:
 *   1. KindeProvider — authentication state (user session, org, permissions)
 *   2. ConvexProvider — real-time reactive subscriptions
 *
 * Must be "use client" so it can use React context and Convex hooks.
 * The root layout imports this as a server component boundary.
 *
 * Provider order matters:
 *   KindeProvider must be outermost so that ConvexProvider (and any Convex
 *   hooks that read auth state) can access the Kinde session context.
 */

"use client";

import { KindeProvider } from "@kinde-oss/kinde-auth-nextjs";
import { ConvexProvider, ConvexReactClient } from "convex/react";

/**
 * Module-level Convex client.
 *
 * Guarded against missing URL so Next.js static prerendering (`next build`)
 * does not throw "Provided address was not an absolute URL" when
 * NEXT_PUBLIC_CONVEX_URL is not set in the build environment.
 *
 * In production the env var is required; all dynamic routes that use
 * Convex hooks will show a loading state until the client is available.
 */
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

export function Providers({ children }: { children: React.ReactNode }) {
  // During `next build` without a Convex URL, render children without the
  // Convex provider.  All Convex hooks will be inert (undefined data) but
  // the app shell will still server-render cleanly.
  if (!convex) {
    return <KindeProvider>{children}</KindeProvider>;
  }

  return (
    <KindeProvider>
      <ConvexProvider client={convex}>{children}</ConvexProvider>
    </KindeProvider>
  );
}
