/**
 * /inventory — INVENTORY dashboard entry point
 *
 * Server Component that reads the initial `view` param from searchParams,
 * then renders the appropriate client-side map mode component.
 *
 * Map modes:
 *   M1 — Fleet Overview        (default)
 *   M2 — Activity Density
 *   M3 — Transit Tracker       (stub)
 *   M4 — Deployment            (stub)
 *   M5 — Mission Control       (stub, FF_MAP_MISSION)
 *
 * The MapStateProvider (in layout.tsx) wraps this page in a Suspense
 * boundary and wires the URL ↔ React state sync.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { InventoryMapClient } from "./InventoryMapClient";

export const metadata: Metadata = {
  title: "INVENTORY — SkySpecs",
  description: "Fleet, transit, and deployment map dashboard",
};

interface InventoryPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  // Resolve searchParams (Next.js 15 async pattern)
  const params = await searchParams;

  // Read initial view on the server so we can set page metadata / avoid flash
  const rawView = typeof params.view === "string" ? params.view : "M1";
  const initialView = /^M[1-5]$/.test(rawView.toUpperCase())
    ? rawView.toUpperCase()
    : "M1";

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
      <InventoryMapClient initialView={initialView as "M1" | "M2" | "M3" | "M4" | "M5"} />
    </Suspense>
  );
}
