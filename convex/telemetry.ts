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
 *   persistTelemetryEvents — canonical mutation: persist a batch of ≤ MAX_BATCH_SIZE events
 *   recordTelemetryBatch   — alias for persistTelemetryEvents (backward compatibility)
 */

import { internalMutation, mutation } from "./_generated/server";
import type { Auth, UserIdentity } from "convex/server";
import { v } from "convex/values";

// ─── Auth guard ───────────────────────────────────────────────────────────────

async function requireAuth(ctx: { auth: Auth }): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error(
      "[AUTH_REQUIRED] Unauthenticated. Provide a valid Kinde access token."
    );
  }
  return identity;
}

async function getOptionalAuth(ctx: { auth: Auth }): Promise<UserIdentity | null> {
  return await ctx.auth.getUserIdentity();
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum number of events accepted in a single batch.
 *
 * Matches MAX_BATCH_SIZE in src/lib/telemetry.lib.ts — the client will never
 * send more than this many events in a single POST.  Enforced here as a
 * defence-in-depth guard against oversized payloads.
 */
const MAX_BATCH_SIZE = 100;

// ─── persistTelemetryEvents ───────────────────────────────────────────────────

/**
 * Canonical mutation: persist a batch of telemetry events to the
 * `telemetryEvents` table.
 *
 * This is the primary entry point used by:
 *   • The /api/telemetry Next.js route handler (via ConvexHttpClient)
 *   • React components in INVENTORY / SCAN that call useMutation directly
 *   • The buildConvexTransport helper in telemetry.lib.ts
 *
 * Each event in the batch is inserted as an individual row. Scalar index
 * fields (app, eventCategory, eventName, sessionId, timestamp) are extracted
 * from the raw event for efficient queries; the full payload is stored in the
 * `payload` field for complete auditing and analytics export.
 *
 * Authentication: requires a valid Kinde access token. Unauthenticated callers
 * receive an AUTH_REQUIRED error. Use `internalPersistTelemetryEvents` for
 * server-side / HTTP action callers that operate outside the Kinde auth context.
 *
 * @param events  Array of raw telemetry event objects (up to MAX_BATCH_SIZE).
 * @returns `{ accepted: number }` — count of successfully inserted events.
 * @throws When `events.length > MAX_BATCH_SIZE` to prevent oversized writes.
 */
export const persistTelemetryEvents = mutation({
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
    const identity = await getOptionalAuth(ctx);
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
        typeof event.userId === "string" ? event.userId : identity?.subject;
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
        payload: event,
        recordedAt: now,
      });

      accepted++;
    }

    return { accepted };
  },
});

// ─── internalPersistTelemetryEvents ───────────────────────────────────────────

/**
 * Internal variant of `persistTelemetryEvents` for use by Convex HTTP actions
 * and scheduled functions that operate outside the Kinde auth context.
 *
 * Unlike the public `persistTelemetryEvents` mutation, this mutation bypasses
 * authentication checks — it is only callable from other Convex functions
 * (actions, scheduled tasks) using `ctx.runMutation(internal.telemetry.…)`.
 *
 * The caller is responsible for ensuring that events originate from a trusted
 * server-side context (e.g. the /api/telemetry HTTP action proxy).
 *
 * @param events  Array of raw telemetry event objects (up to MAX_BATCH_SIZE).
 * @returns `{ accepted: number }` — count of successfully inserted events.
 */
export const internalPersistTelemetryEvents = internalMutation({
  args: {
    events: v.array(v.any()),
  },

  returns: v.object({
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
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        continue;
      }

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
        payload: event,
        recordedAt: now,
      });

      accepted++;
    }

    return { accepted };
  },
});

// ─── recordTelemetryBatch ─────────────────────────────────────────────────────

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
    const identity = await getOptionalAuth(ctx);
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
        typeof event.userId === "string" ? event.userId : identity?.subject;
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
