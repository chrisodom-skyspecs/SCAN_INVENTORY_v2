/**
 * convex/telemetry.ts
 *
 * Convex mutations for persisting telemetry events emitted by the INVENTORY
 * dashboard and SCAN mobile app.
 *
 * Transport architecture
 * ──────────────────────
 * Browser/client (TelemetryClient)
 *   → batches events in-memory
 *   → POST /api/telemetry  (Next.js route handler)
 *     → ConvexHttpClient.mutation(api.telemetry.recordTelemetryBatch, …)
 *       → inserts rows into telemetryEvents table (this file)
 *
 * Alternatively, React components with direct Convex access can use
 * buildConvexTransport(useMutation(api.telemetry.recordTelemetryBatch))
 * to bypass the HTTP intermediary.
 *
 * Security
 * ────────
 * This mutation accepts any authenticated caller.  The event payload is stored
 * as-is; no PII validation is performed here — callers are responsible for
 * following the telemetry spec (no raw user data in payloads).
 *
 * The recordedAt field uses the server clock (Date.now()) so there is always
 * a trusted server-side timestamp even if the client clock is skewed.
 *
 * Exports
 * ───────
 *   recordTelemetryBatch  — persist a batch of ≤ MAX_BATCH_SIZE events
 */

import { mutation } from "./_generated/server";
import { v } from "convex/values";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum number of events accepted in a single batch.
 *
 * Matches MAX_BATCH_SIZE in src/lib/telemetry.lib.ts — the client will never
 * send more than this many events in a single POST.  Enforced here as a
 * defence-in-depth guard against oversized payloads.
 */
const MAX_BATCH_SIZE = 100;

// ─── recordTelemetryBatch ─────────────────────────────────────────────────────

/**
 * Persist a batch of telemetry events to the `telemetryEvents` table.
 *
 * Called by the /api/telemetry Next.js route handler (via ConvexHttpClient)
 * or directly from SCAN/INVENTORY React components via useMutation.
 *
 * Each event in the batch is inserted as an individual row.  Scalar index
 * fields (app, eventCategory, eventName, sessionId, timestamp) are extracted
 * from the payload for efficient queries; the full payload is stored in the
 * `payload` field for complete auditing.
 *
 * @param events  Array of raw telemetry event objects.  Values are typed as
 *                `v.any()` here because the TelemetryEvent discriminated union
 *                is too large to express as a Convex validator — TypeScript
 *                type-safety is enforced at the call sites in telemetry.lib.ts.
 *
 * @returns `{ accepted: number }` — count of successfully inserted events.
 *
 * @throws When `events.length > MAX_BATCH_SIZE` to prevent oversized writes.
 */
export const recordTelemetryBatch = mutation({
  args: {
    /**
     * Batch of telemetry event objects.
     *
     * Each element must have at minimum:
     *   app           — "inventory" | "scan"
     *   eventCategory — "navigation" | "user_action" | "error" | "performance"
     *   eventName     — specific event name string
     *   sessionId     — UUID v4 per-page-load session identifier
     *   timestamp     — epoch ms (client clock)
     *
     * Additional fields (caseId, userId, and category-specific payload fields)
     * are stored as part of `payload` and indexed when present.
     */
    events: v.array(v.any()),
  },

  returns: v.object({
    /** Number of events successfully inserted into the telemetryEvents table. */
    accepted: v.number(),
  }),

  handler: async (ctx, { events }) => {
    if (events.length > MAX_BATCH_SIZE) {
      throw new Error(
        `Batch size ${events.length} exceeds maximum of ${MAX_BATCH_SIZE} events.`
      );
    }

    const now = Date.now();
    let accepted = 0;

    for (const event of events) {
      // Skip null / non-object entries defensively
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        continue;
      }

      // Extract scalar index fields with safe fallbacks so malformed events
      // don't throw — they are still stored for debugging.
      const app: string =
        typeof event.app === "string" ? event.app : "unknown";
      const eventCategory: string =
        typeof event.eventCategory === "string" ? event.eventCategory : "unknown";
      const eventName: string =
        typeof event.eventName === "string" ? event.eventName : "unknown";
      const sessionId: string =
        typeof event.sessionId === "string" ? event.sessionId : "";
      const userId: string | undefined =
        typeof event.userId === "string" ? event.userId : undefined;
      const caseId: string | undefined =
        typeof event.caseId === "string" ? event.caseId : undefined;
      const timestamp: number =
        typeof event.timestamp === "number" ? event.timestamp : now;

      await ctx.db.insert("telemetryEvents", {
        app,
        eventCategory,
        eventName,
        sessionId,
        userId,
        caseId,
        timestamp,
        payload:    event,
        recordedAt: now,
      });

      accepted++;
    }

    return { accepted };
  },
});
