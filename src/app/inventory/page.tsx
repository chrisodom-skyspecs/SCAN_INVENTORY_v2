/**
 * /inventory — INVENTORY dashboard entry point
 *
 * Server Component that decodes the full MapUrlState from URL search params
 * using the codec (sanitizeMapDeepLink), then renders the appropriate
 * client-side map mode component pre-seeded with the decoded state.
 *
 * Map modes:
 *   M1 — Fleet Overview        (default)
 *   M2 — Activity Density
 *   M3 — Transit Tracker       (stub)
 *   M4 — Deployment            (stub)
 *   M5 — Mission Control       (stub, FF_MAP_MISSION)
 *
 * URL params decoded (all 8 fields):
 *   view    — map mode (M1–M5, default "M1")
 *   case    — selected case Convex ID (default null)
 *   window  — case detail layout (T1–T5, default "T1")
 *   panel   — panel open flag (default false)
 *   layers  — comma-separated overlay layer IDs (default DEFAULT_LAYERS)
 *   org     — organisation filter Convex ID (default null)
 *   kit     — kit / case-template filter Convex ID (default null)
 *   at      — mission-replay ISO-8601 timestamp (default null)
 *
 * Design
 * ──────
 * The decode is performed server-side via sanitizeMapDeepLink so that:
 *   1. Invalid / malformed params are sanitized with per-param defaults
 *      before any client code runs.
 *   2. The full decoded MapUrlState is passed as a single `initialState`
 *      prop, making the server-decoded values available to the client
 *      component on its very first render — before useSearchParams() is
 *      called on the client side.
 *   3. All validation and fallback logic lives in one place (the codec)
 *      rather than being duplicated in the page.
 *
 * The MapStateProvider (in layout.tsx) wraps this page in a Suspense
 * boundary and wires the URL ↔ React state sync for subsequent interactions.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { sanitizeMapDeepLink } from "@/lib/map-url-params";
import type { MapUrlState } from "@/types/map";
import { InventoryMapClient } from "./InventoryMapClient";

export const metadata: Metadata = {
  title: "INVENTORY — SkySpecs",
  description: "Fleet, transit, and deployment map dashboard",
};

interface InventoryPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Adapt a Next.js searchParams record to the `.get()` interface expected
 * by sanitizeMapDeepLink (and all other map-url-params codec functions).
 *
 * Next.js provides searchParams as `Record<string, string | string[] | undefined>`.
 * When a param appears multiple times, Next.js coerces it to a string array —
 * in that case we take the last value (rightmost wins, consistent with how
 * browsers handle duplicate query params).
 */
function makeSearchParamsAdapter(
  params: Record<string, string | string[] | undefined>
): { get(key: string): string | null } {
  return {
    get(key: string): string | null {
      const value = params[key];
      if (value === undefined) return null;
      if (Array.isArray(value)) return value[value.length - 1] ?? null;
      return value;
    },
  };
}

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  // Resolve searchParams (Next.js 15 async pattern)
  const params = await searchParams;

  // ── Decode the full MapUrlState using the codec ──────────────────────────────
  //
  // sanitizeMapDeepLink validates every URL param against its schema and falls
  // back to MAP_URL_STATE_DEFAULTS for any missing or invalid values.
  //
  // This replaces the previous manual `view`-only parsing (`/^M[1-5]$/.test(...)`)
  // with the authoritative codec decode path, ensuring all 8 URL params are
  // parsed and sanitized consistently — the same logic used by MapStateProvider
  // on the client side.
  //
  // The decoded `initialState` is passed as a prop to InventoryMapClient so
  // that all map state fields are initialized from the URL before the first
  // client-side render (i.e., before useSearchParams() is called).
  const { state: initialState } = sanitizeMapDeepLink(
    makeSearchParamsAdapter(params)
  );

  return (
    <Suspense
      fallback={
        <div
          style={{
            height: "100dvh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--surface-base)",
            color: "var(--ink-secondary)",
          }}
        >
          Loading map…
        </div>
      }
    >
      <InventoryMapClient initialState={initialState} />
    </Suspense>
  );
}
