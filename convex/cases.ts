/**
 * convex/cases.ts
 *
 * Public query functions for case status subscriptions.
 *
 * These are callable from the client via `useQuery` (convex/react) and
 * provide real-time reactive updates to the INVENTORY dashboard and the
 * SCAN mobile app.  Convex re-runs any subscribed query automatically
 * whenever the underlying rows change — no polling required.
 *
 * All functions here use `query` (public visibility), in contrast to the
 * `internalQuery` functions in convex/maps.ts which are server-side only.
 *
 * Query functions:
 *   getCaseStatus        — status + key display fields for a single case (by id)
 *   getCaseById          — full case document by Convex ID (by id)
 *   getCaseByQrCode      — case lookup by QR payload (SCAN app entry point)
 *   listCasesByStatus    — all cases with a given lifecycle status (by status)
 *   listCasesByLocation  — all cases at a given locationName (by location)
 *   listCases            — all cases with optional status / mission / bounds filter
 *   getCasesInBounds     — all cases within a geographic bounding box (by location)
 *   getCaseStatusCounts  — aggregate counts per status for dashboard header
 *
 * Performance notes:
 *   • getCaseStatus / getCaseById use ctx.db.get — O(1) primary-key lookup.
 *   • getCaseByQrCode uses the by_qr_code index — O(log n).
 *   • listCasesByStatus uses the by_status index — O(|cases with status|).
 *   • listCasesByLocation performs a full scan with an in-memory equality
 *     filter on locationName (no by_location index in Convex schema) —
 *     acceptable for fleets up to ~10k cases.
 *   • listCases uses by_status or by_mission indexes when filters are
 *     provided; falls back to by_updated full scan when neither is set.
 *     Bounding-box filtering is applied in-memory after the index scan.
 *   • getCasesInBounds performs a full table scan with in-memory geo filter
 *     (no spatial index available in Convex) — acceptable for fleets up
 *     to ~10k cases; Convex re-evaluates on any cases row change.
 *   • getCaseStatusCounts performs a full table scan and aggregates in
 *     memory — acceptable for a single-tenant fleet up to ~10k cases.
 *
 * Reactive subscription support:
 *   All public `query` exports above are automatically reactive when consumed
 *   via the React `useQuery` hook (or any other Convex client subscription
 *   API).  Convex tracks each query's table dependencies and pushes a
 *   re-evaluated result to subscribed clients within ~100–300 ms of any
 *   mutation that affects the underlying rows — satisfying the ≤ 2-second
 *   real-time fidelity requirement between SCAN app actions and the
 *   INVENTORY dashboard.
 */

import { mutation, query } from "./_generated/server";
import type { Auth, UserIdentity } from "convex/server";
import { v } from "convex/values";

// ─── Shared status literal validator ─────────────────────────────────────────

/**
 * Convex value validator for the case status union.
 * Mirrors the `caseStatus` definition in convex/schema.ts and the
 * `CaseStatus` type in src/types/case-status.ts.
 * Defined once here so query args can re-use it without duplication.
 */
const caseStatusValidator = v.union(
  v.literal("hangar"),
  v.literal("assembled"),
  v.literal("transit_out"),
  v.literal("deployed"),
  v.literal("flagged"),
  v.literal("transit_in"),
  v.literal("received"),
  v.literal("archived"),
);

// ─── Exported TypeScript type (for use in hook / component files) ─────────────

/**
 * Valid lifecycle statuses for a case.
 *
 * Full lifecycle:
 *   hangar → assembled → transit_out → deployed → (flagged) → transit_in → received → archived
 *
 * Matches the `caseStatus` union in convex/schema.ts and the canonical
 * `CaseStatus` type exported from src/types/case-status.ts.
 */
export type CaseStatus =
  | "hangar"
  | "assembled"
  | "transit_out"
  | "deployed"
  | "flagged"
  | "transit_in"
  | "received"
  | "archived";

export const CASE_STATUSES: CaseStatus[] = [
  "hangar",
  "assembled",
  "transit_out",
  "deployed",
  "flagged",
  "transit_in",
  "received",
  "archived",
];

// ─── Return-type interfaces ───────────────────────────────────────────────────

/**
 * Lightweight status projection returned by getCaseStatus.
 * Contains only the fields needed for map pins and status badges —
 * avoids transferring the full document when only status is needed.
 */
export interface CaseStatusResult {
  _id: string;
  label: string;
  status: CaseStatus;
  lat?: number;
  lng?: number;
  locationName?: string;
  assigneeId?: string;
  assigneeName?: string;
  missionId?: string;
  updatedAt: number;
}

/**
 * Aggregate status counts for the dashboard global summary bar.
 */
export interface CaseStatusCounts {
  total: number;
  byStatus: Record<CaseStatus, number>;
}

// ─── Auth guard helper ────────────────────────────────────────────────────────

/**
 * Asserts that the calling client has a verified Kinde JWT.
 *
 * Throws [AUTH_REQUIRED] when:
 *   • The request arrived without a JWT (unauthenticated client)
 *   • The JWT was present but failed Convex's JWKS verification
 *   • The JWT has expired
 *
 * Called at the top of every public query and mutation handler.
 * Returns the UserIdentity so callers can extract the subject (kindeId)
 * without a second `getUserIdentity()` call.
 *
 * @param ctx  Convex query or mutation context with a `.auth` accessor.
 */
async function requireAuth(ctx: { auth: Auth }): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error(
      "[AUTH_REQUIRED] Unauthenticated. Provide a valid Kinde access token. " +
      "Ensure the client is wrapped in ConvexProviderWithAuth and the user is signed in."
    );
  }
  return identity;
}

// ─── getCaseStatus ────────────────────────────────────────────────────────────

/**
 * Subscribe to a single case's status and key display fields.
 *
 * Designed for the dashboard's case-detail panel: provides enough data to
 * render the status badge, location, and assignee without fetching the full
 * document.  Convex will re-run this query and push the update whenever the
 * case row changes (e.g., the SCAN app calls a mutation to advance status).
 *
 * Returns `null` if the case does not exist (deleted or invalid ID).
 *
 * Requires authentication — unauthenticated requests throw [AUTH_REQUIRED].
 *
 * Client usage:
 *   const status = useQuery(api.cases.getCaseStatus, { caseId });
 */
export const getCaseStatus = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args): Promise<CaseStatusResult | null> => {
    await requireAuth(ctx);
    const c = await ctx.db.get(args.caseId);
    if (!c) return null;

    return {
      _id: c._id.toString(),
      label: c.label,
      status: c.status as CaseStatus,
      lat: c.lat,
      lng: c.lng,
      locationName: c.locationName,
      assigneeId: c.assigneeId,
      assigneeName: c.assigneeName,
      missionId: c.missionId?.toString(),
      updatedAt: c.updatedAt,
    };
  },
});

// ─── getCaseById ──────────────────────────────────────────────────────────────

/**
 * Subscribe to the full case document for T1–T5 detail panel rendering.
 *
 * Returns the complete `Doc<"cases">` row including all optional fields.
 * Use this when the detail panel needs notes, templateId, or other fields
 * not included in the lightweight getCaseStatus projection.
 *
 * Returns `null` if the case does not exist.
 *
 * Client usage:
 *   const caseDoc = useQuery(api.cases.getCaseById, { caseId });
 */
export const getCaseById = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    return await ctx.db.get(args.caseId);
  },
});

// ─── getCaseByQrCode ──────────────────────────────────────────────────────────

/**
 * Look up a case by its QR code payload — primary SCAN app entry point.
 *
 * After the SCAN app camera decodes a QR code, the app subscribes to this
 * query with the decoded string value.  Convex automatically re-evaluates the
 * subscription and pushes updates whenever the associated case row changes
 * (status transitions, custody handoffs, shipping updates, etc.).
 *
 * Lookup path
 * ───────────
 * The `by_qr_code` index (defined in schema.ts) makes this an O(log n) scan —
 * only rows where `cases.qrCode` equals the provided value are examined.
 * String comparison is exact and case-sensitive; QR payloads are compared
 * verbatim without normalisation.
 *
 * Not-found path
 * ──────────────
 * Returns `null` when:
 *   • No case has a `qrCode` field that matches the scanned value exactly.
 *   • The `qrCode` argument is an empty or whitespace-only string (early return
 *     to avoid a vacuous index lookup against the empty string).
 *
 * The SCAN app should handle `null` by rendering a "QR code not recognized"
 * error state with an option to re-scan or manually enter a case ID.
 *
 * IMPORTANT: `null` is a data signal ("case not found"), not a runtime error.
 * Errors are thrown only for authentication failures ([AUTH_REQUIRED]).
 * Clients must NOT treat `null` as an unhandled exception — it is an expected
 * outcome that the UI should present gracefully.
 *
 * Requires authentication — unauthenticated requests throw [AUTH_REQUIRED].
 *
 * @param qrCode  The raw string decoded from the physical QR label.
 *                Typically a URL:    `https://scan.skyspecs.com/{caseId}?uid={uuid}`
 *                Or compact format:  `case:{caseId}:uid:{uuid}`
 *
 * @returns The full `Doc<"cases">` document when a matching case is found;
 *          `null` when no case is associated with the provided QR value.
 *
 * Client usage:
 *   const caseDoc = useQuery(api.cases.getCaseByQrCode, { qrCode });
 *   if (caseDoc === undefined) return <Loading />;   // query in-flight
 *   if (caseDoc === null)      return <QrNotFound />; // not-found path
 *   return <CaseDetail case={caseDoc} />;             // found path
 */
export const getCaseByQrCode = query({
  args: { qrCode: v.string() },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    // ── Guard: empty or whitespace QR payload — not-found path ───────────────
    // An empty string passed to the index would match any case whose qrCode
    // was persisted as "" (degenerate state).  Return null immediately so the
    // SCAN app renders "not recognized" rather than a spurious case match.
    const qrCode = args.qrCode.trim();
    if (qrCode.length === 0) {
      // Not-found path: an empty QR payload cannot identify any valid case.
      return null;
    }

    // ── O(log n) lookup via the by_qr_code index ──────────────────────────────
    // The by_qr_code index narrows the scan to only rows matching this exact
    // QR code value.  No full table scan is required.
    const caseDoc = await ctx.db
      .query("cases")
      .withIndex("by_qr_code", (q) => q.eq("qrCode", qrCode))
      .first();

    // ── Not-found path: no case is associated with this QR payload ────────────
    // .first() returns null when the index scan finds zero matching documents.
    // Returning null (rather than throwing) allows the SCAN app to distinguish
    // "unknown QR code" from a hard error and render the appropriate UI state.
    if (caseDoc === null) {
      return null;
    }

    // ── Found path: return the full case document ─────────────────────────────
    // The complete Doc<"cases"> row is returned so the SCAN app can render
    // the full case detail (T1–T5 panels, checklist, custody state, etc.)
    // without issuing a second query.
    return caseDoc;
  },
});

// ─── getCaseByQrIdentifier ────────────────────────────────────────────────────

/**
 * Normalized multi-strategy case lookup — primary SCAN app QR entry point.
 *
 * This query supersedes `getCaseByQrCode` by adding:
 *
 *   1. **Input normalization** — trims whitespace and URL-decodes percent-encoded
 *      characters before any index lookup, making the query robust to minor
 *      encoding variations that can occur between QR libraries.
 *
 *   2. **Generated label ID lookup** (Strategy A) — searches `cases.qrCode` via
 *      the `by_qr_code` index using the exact normalized identifier value.
 *      This covers the primary case where the decoded QR payload is the full URL
 *      stored on the case record:
 *        • URL format: `https://scan.skyspecs.com/case/{caseId}?uid={uid}&source=generated`
 *        • Compact format: `case:{caseId}:uid:{uuid}`
 *
 *   3. **Embedded case-ID extraction** (Strategy B) — parses the identifier as a
 *      URL or compact QR string to extract the embedded Convex case ID, then does
 *      a direct O(1) `ctx.db.get(caseId)` primary-key lookup.  This path succeeds
 *      when the QR payload was generated by `generateQRCodeForCase` but the stored
 *      `qrCode` field differs from the scanned payload (e.g., the base URL was
 *      updated, or encoding changed).
 *
 *   4. **Legacy/physical label lookup** (Strategy C) — falls back to matching the
 *      identifier against `cases.label` via the `by_label` index.  This handles
 *      cases where:
 *        • A pre-QR-code physical sticker just prints the case label (e.g., "CASE-001").
 *        • A legacy QR code encodes the plain human-readable case label.
 *        • A technician manually types the case label instead of scanning.
 *      Label comparison is case-sensitive (labels are stored verbatim); the caller
 *      should pass the label in the exact stored casing when using this fallback.
 *
 * Lookup is short-circuited: the first strategy that finds a matching case returns
 * immediately without running the remaining strategies.
 *
 * Not-found path
 * ──────────────
 * Returns `null` when all three strategies find no matching case.  The SCAN app
 * should render a "QR code not recognized" state with options to re-scan or enter
 * a case label manually.
 *
 * Performance
 * ───────────
 *   Strategy A: O(log n) — `by_qr_code` index
 *   Strategy B: O(1) — `ctx.db.get` primary-key lookup (plus `by_qr_code` miss)
 *   Strategy C: O(log n) — `by_label` index
 *   Total worst-case: O(log n) — no full table scan
 *
 * Real-time reactivity
 * ────────────────────
 * Convex tracks this query's dependency on the `cases` table.  Any mutation that
 * changes `cases.qrCode`, `cases.label`, or creates a new case triggers a
 * re-evaluation for subscribed clients — satisfying the ≤ 2-second fidelity
 * requirement.
 *
 * Requires authentication — unauthenticated requests throw [AUTH_REQUIRED].
 *
 * @param identifier  Raw string from the QR camera, manual entry, or URL deep-link.
 *                    Accepted formats (auto-detected):
 *                      • Full URL:    `https://scan.skyspecs.com/case/{id}?uid=abc&source=generated`
 *                      • Compact:     `case:{id}:uid:{uuid}`
 *                      • Plain label: `CASE-001`
 *                    Whitespace is trimmed; percent-encoded characters are decoded.
 *
 * @returns The full `Doc<"cases">` document when a matching case is found;
 *          `null` when all lookup strategies are exhausted.
 *
 * Client usage:
 *   const caseDoc = useQuery(api.cases.getCaseByQrIdentifier, { identifier });
 *   if (caseDoc === undefined) return <Loading />;    // query in-flight
 *   if (caseDoc === null)      return <QrNotFound />; // all strategies missed
 *   return <CaseDetail case={caseDoc} />;             // found
 */
export const getCaseByQrIdentifier = query({
  args: {
    /**
     * Raw QR payload or manually-entered identifier.
     * Accepts generated QR URLs, compact case codes, and plain case labels.
     * Whitespace is trimmed server-side; percent-encoding is decoded.
     */
    identifier: v.string(),
  },

  handler: async (ctx, args) => {
    await requireAuth(ctx);

    // ── Step 1: Normalize the identifier ─────────────────────────────────────
    // Trim leading/trailing whitespace — common artifact of manual keyboard entry
    // and some QR camera libraries that pad the decoded string.
    let normalized = args.identifier.trim();

    // Guard: empty payload cannot identify any case — return the not-found signal
    // immediately so the SCAN app renders "not recognized" without index overhead.
    if (normalized.length === 0) {
      return null;
    }

    // URL-decode percent-encoded characters (%20 → space, %2F → /, etc.).
    // Some QR cameras emit double-encoded URLs; we decode once here and rely on
    // the by_qr_code index to match the stored value after one decoding pass.
    // A try/catch guards against malformed percent-sequences.
    try {
      const decoded = decodeURIComponent(normalized);
      // Only adopt the decoded form when it is different from the input — this
      // avoids unnecessary index misses when the stored qrCode is not encoded.
      if (decoded !== normalized) {
        normalized = decoded;
      }
    } catch {
      // Malformed percent-sequence — keep the original string as-is.
      // The subsequent index lookups will handle the not-found case gracefully.
    }

    // ── Strategy A: by_qr_code index — O(log n) ──────────────────────────────
    // Primary path: the normalized identifier exactly matches cases.qrCode.
    // Covers the common case where the camera decodes the stored QR URL verbatim.
    const byQrCode = await ctx.db
      .query("cases")
      .withIndex("by_qr_code", (q) => q.eq("qrCode", normalized))
      .first();

    if (byQrCode !== null) {
      // Found: short-circuit; skip remaining strategies.
      return byQrCode;
    }

    // ── Strategy B: embedded case-ID extraction — O(1) ───────────────────────
    // Parse the identifier as a generated QR payload to extract the embedded
    // Convex case ID, then attempt a direct primary-key lookup.
    //
    // Supported QR formats for case-ID extraction:
    //
    //   1. URL path format (generateQRCodeForCase):
    //        {baseUrl}/case/{encodedCaseId}?uid={uid}&source=generated
    //      → extract everything between "/case/" and the next "?" or end-of-path
    //
    //   2. Legacy URL path format (generateQrCode in cases.ts):
    //        {baseUrl}/{caseId}?uid={uuid}
    //      → extract last path segment before the "?" query separator
    //
    //   3. Compact format (generateQrCode compact):
    //        case:{caseId}:uid:{uuid}
    //      → extract between "case:" prefix and ":uid:" separator
    //
    // The extracted string is URL-decoded (the Convex ID was encoded with
    // encodeURIComponent when the QR was generated) and tried as a case document
    // ID via ctx.db.get — which returns null for invalid IDs rather than throwing.
    const extractedId = _extractCaseIdFromQrPayload(normalized);

    if (extractedId !== null) {
      try {
        // ctx.db.get accepts an Id<"cases"> but will return null for IDs that
        // don't exist or are not valid for this table — safe to call with any
        // plausible string without risking an unhandled exception.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const byId = await ctx.db.get(extractedId as any);
        if (byId !== null) {
          return byId;
        }
      } catch {
        // Invalid Convex ID format (e.g., extracted string is not an ID) —
        // fall through to Strategy C without surfacing the error to the client.
      }
    }

    // ── Strategy C: by_label index (legacy/physical label) — O(log n) ─────────
    // Final fallback: match the identifier against cases.label (e.g., "CASE-001").
    //
    // This strategy handles three real-world scenarios:
    //   • Pre-QR-code physical stickers that print only the human-readable label.
    //   • Legacy QR codes that encode the plain case label instead of a URL.
    //   • Manual keyboard entry where the technician types "CASE-001" directly.
    //
    // The by_label index (added in schema.ts) makes this O(log n) rather than a
    // full table scan.  Label comparison is exact (case-sensitive, verbatim) —
    // labels are stored as-is (e.g., "CASE-001") and the technician / QR payload
    // must supply the same casing.
    const byLabel = await ctx.db
      .query("cases")
      .withIndex("by_label", (q) => q.eq("label", normalized))
      .first();

    // Return whatever the label lookup finds: a case document, or null if all
    // three strategies failed to identify a matching case.
    return byLabel;
  },
});

/**
 * Extract an embedded Convex case ID from a recognized QR payload format.
 *
 * Internal helper for `getCaseByQrIdentifier` Strategy B.  Returns the raw
 * extracted ID string (before validation) or `null` when the payload format is
 * not recognized.
 *
 * Supported formats:
 *
 *   URL path (preferred, generateQRCodeForCase):
 *     {baseUrl}/case/{encodedCaseId}[?...]
 *     → captures the path segment immediately after "/case/"
 *     → URL-decodes the captured segment (caseId was encoded with encodeURIComponent)
 *
 *   Legacy URL path (generateQrCode, URL variant):
 *     {baseUrl}/{caseId}[?uid=...]
 *     → captures the last path segment before the query string
 *     → NOT applied when the last segment is "case" (would be the path prefix above)
 *
 *   Compact (generateQrCode, non-URL variant):
 *     case:{caseId}:uid:{uuid}
 *     → captures the substring between the "case:" prefix and ":uid:" separator
 *
 * This function is intentionally conservative: it only extracts IDs from
 * patterns that were generated by the known Convex QR code functions, avoiding
 * false-positive matches on arbitrary label strings.
 *
 * @param payload  The normalized QR payload string.
 * @returns        The extracted (URL-decoded) case ID string, or `null` if the
 *                 payload doesn't match any recognized format.
 */
function _extractCaseIdFromQrPayload(payload: string): string | null {
  // ── Pattern 1: /case/{encodedCaseId} URL path format ─────────────────────
  // Generated by `generateQRCodeForCase` in convex/qrCodes.ts:
  //   {baseUrl}/case/{encodedCaseId}?uid={uid16}&source=generated
  //
  // The regex captures everything between "/case/" and the next "?", "#",
  // or end-of-string, allowing for any base URL.
  const casePathMatch = payload.match(/\/case\/([^?#/]+)/);
  if (casePathMatch) {
    try {
      return decodeURIComponent(casePathMatch[1]);
    } catch {
      // Invalid percent-encoding in the path segment — skip this pattern.
    }
  }

  // ── Pattern 2: compact case:{caseId}:uid:{uuid} format ───────────────────
  // Generated by `generateQrCode` in convex/cases.ts (non-URL variant):
  //   case:{caseId}:uid:{uuid}
  //
  // Matches the literal prefix "case:" and captures everything up to ":uid:".
  const compactMatch = payload.match(/^case:([^:]+):uid:/);
  if (compactMatch) {
    // Compact payloads do not URL-encode the case ID — return as-is.
    return compactMatch[1];
  }

  // ── Pattern 3: legacy URL — last path segment as case ID ─────────────────
  // Generated by `generateQrCode` in convex/cases.ts (URL variant):
  //   {baseUrl}/{caseId}?uid={uuid}
  //
  // Captures the last path segment before the query separator when it looks
  // like a Convex ID (alphanumeric, at least 8 chars) and a "?uid=" param
  // is present to distinguish it from arbitrary URLs.
  const legacyUrlMatch = payload.match(/\/([a-z0-9]{8,})\?uid=/i);
  if (legacyUrlMatch) {
    try {
      return decodeURIComponent(legacyUrlMatch[1]);
    } catch {
      // Invalid encoding — skip.
    }
  }

  return null;
}

// ─── listCases ────────────────────────────────────────────────────────────────

/**
 * Subscribe to all cases with optional status, mission, or bounding-box filter.
 *
 * Used by the dashboard map views (M1–M5) and the dashboard case list.
 * Convex will re-run this query and push incremental updates to all
 * subscribed dashboard sessions whenever any case row changes.
 *
 * Filtering behaviour:
 *   • `status` provided   → uses `by_status` index (efficient)
 *   • `missionId` provided → uses `by_mission` index (efficient)
 *   • Neither provided    → full scan ordered by `updatedAt` desc
 *   • Both provided       → status index scan, then in-memory mission filter
 *   • Bounds (all four of swLat/swLng/neLat/neLng provided) → additional
 *     in-memory bounding-box filter applied after the index/full scan.
 *     Cases without lat/lng are excluded when bounds are active.
 *
 * Client usage:
 *   // All cases (Fleet Overview)
 *   const cases = useQuery(api.cases.listCases, {});
 *
 *   // Cases in the field
 *   const fieldCases = useQuery(api.cases.listCases, { status: "in_field" });
 *
 *   // Cases on a specific mission
 *   const missionCases = useQuery(api.cases.listCases, { missionId });
 *
 *   // Cases within a map viewport (real-time map subscriptions)
 *   const viewportCases = useQuery(api.cases.listCases, {
 *     swLat: 40.0, swLng: -74.5, neLat: 41.0, neLng: -73.5,
 *   });
 */
export const listCases = query({
  args: {
    status: v.optional(caseStatusValidator),
    missionId: v.optional(v.id("missions")),
    // Geographic bounding box — all four must be provided together.
    // Cases without lat/lng are excluded when bounds are active.
    swLat: v.optional(v.number()),
    swLng: v.optional(v.number()),
    neLat: v.optional(v.number()),
    neLng: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    let results;

    if (args.status !== undefined && args.missionId !== undefined) {
      // Both filters: status index + in-memory mission filter
      const byStatus = await ctx.db
        .query("cases")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
      results = byStatus.filter(
        (c) => c.missionId?.toString() === args.missionId!.toString()
      );
    } else if (args.status !== undefined) {
      // Status index scan — O(|cases with that status|)
      results = await ctx.db
        .query("cases")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else if (args.missionId !== undefined) {
      // Mission index scan — O(|cases on that mission|)
      results = await ctx.db
        .query("cases")
        .withIndex("by_mission", (q) => q.eq("missionId", args.missionId!))
        .collect();
    } else {
      // No filter: full scan ordered by updatedAt desc
      results = await ctx.db
        .query("cases")
        .withIndex("by_updated")
        .order("desc")
        .collect();
    }

    // Apply geographic bounding-box filter in-memory when all four bounds
    // params are provided.  Cases with no lat/lng are excluded.
    const hasBounds =
      args.swLat !== undefined &&
      args.swLng !== undefined &&
      args.neLat !== undefined &&
      args.neLng !== undefined;

    if (hasBounds) {
      results = results.filter(
        (c) =>
          c.lat !== undefined &&
          c.lng !== undefined &&
          c.lat >= args.swLat! &&
          c.lat <= args.neLat! &&
          c.lng >= args.swLng! &&
          c.lng <= args.neLng!
      );
    }

    return results;
  },
});

// ─── BoundsFilter type ────────────────────────────────────────────────────────

/**
 * Geographic bounding box for location-based case queries.
 * All four coordinates must be provided together.
 */
export interface BoundsFilter {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
}

// ─── getCasesInBounds ─────────────────────────────────────────────────────────

/**
 * Subscribe to all cases whose last-known location falls within a geographic
 * bounding box.  An optional `status` filter further narrows results.
 *
 * This is the dedicated real-time watcher for viewport-constrained map views.
 * Convex re-runs this query whenever any case row changes — the subscription
 * automatically reflects position updates, status transitions, and new cases
 * added within the bounds.
 *
 * Cases with no lat/lng are always excluded.
 *
 * Performance:
 *   • No spatial index is available in Convex; the query performs a full
 *     table scan with in-memory bounding-box filtering.  This is acceptable
 *     for fleets up to ~10k cases — the bottleneck is network transfer, not
 *     the O(n) filter pass.
 *   • When `status` is provided, the `by_status` index is used first to
 *     reduce the in-memory filter set.
 *
 * Returns cases sorted by `updatedAt` descending (most recently changed first).
 *
 * Client usage:
 *   const viewportCases = useQuery(api.cases.getCasesInBounds, {
 *     swLat: bounds.swLat,
 *     swLng: bounds.swLng,
 *     neLat: bounds.neLat,
 *     neLng: bounds.neLng,
 *   });
 *
 *   // With status filter (e.g., only show in_field cases in viewport)
 *   const fieldCasesInView = useQuery(api.cases.getCasesInBounds, {
 *     ...bounds,
 *     status: "in_field",
 *   });
 */
export const getCasesInBounds = query({
  args: {
    swLat: v.number(),
    swLng: v.number(),
    neLat: v.number(),
    neLng: v.number(),
    // Optional status filter — applied before the bounds filter using the index
    status: v.optional(caseStatusValidator),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    // Fetch candidates: use by_status index when status is specified,
    // otherwise scan by_updated for consistent desc ordering.
    const candidates = args.status !== undefined
      ? await ctx.db
          .query("cases")
          .withIndex("by_status", (q) => q.eq("status", args.status!))
          .collect()
      : await ctx.db
          .query("cases")
          .withIndex("by_updated")
          .order("desc")
          .collect();

    // In-memory bounding-box filter: exclude cases with no position
    return candidates.filter(
      (c) =>
        c.lat !== undefined &&
        c.lng !== undefined &&
        c.lat >= args.swLat &&
        c.lat <= args.neLat &&
        c.lng >= args.swLng &&
        c.lng <= args.neLng
    );
  },
});

// ─── getCaseStatusCounts ──────────────────────────────────────────────────────

/**
 * Subscribe to aggregate case status counts for the dashboard header.
 *
 * Provides the total case count and a breakdown by status, used to render
 * the summary bar and status filter pills in the INVENTORY dashboard.
 *
 * Convex re-runs this query on any case row change, ensuring the header
 * counts stay accurate within 2 seconds of any SCAN app action.
 *
 * Client usage:
 *   const counts = useQuery(api.cases.getCaseStatusCounts, {});
 *   // → { total: 42, byStatus: { assembled: 5, deployed: 12, ... } }
 */
export const getCaseStatusCounts = query({
  args: {},
  handler: async (ctx): Promise<CaseStatusCounts> => {
    await requireAuth(ctx);
    const allCases = await ctx.db.query("cases").collect();

    const byStatus: Record<CaseStatus, number> = {
      hangar:      0,
      assembled:   0,
      transit_out: 0,
      deployed:    0,
      flagged:     0,
      transit_in:  0,
      received:    0,
      archived:    0,
    };

    for (const c of allCases) {
      if (Object.prototype.hasOwnProperty.call(byStatus, c.status)) {
        byStatus[c.status as CaseStatus]++;
      }
    }

    return {
      total: allCases.length,
      byStatus,
    };
  },
});

// ─── listForMap ───────────────────────────────────────────────────────────────

/**
 * Lightweight case projection for all five INVENTORY map modes (M1–M5).
 *
 * Each row exposes the three field groups required across all map modes:
 *   • Position   — lat, lng, locationName
 *   • Status     — lifecycle status string
 *   • Custody    — current custodian (from latest custodyRecord) + transfer
 *                  provenance (fromUserId / fromUserName / transferredAt)
 *
 * Additional map-support fields included for convenience:
 *   • Assignment — denormalized assigneeId / assigneeName from the cases row
 *                  (available even when no custody record exists)
 *   • Mission    — missionId for M2 grouping and M5 cluster association
 *   • Shipping   — trackingNumber, carrier, shippedAt, destinationLat/Lng
 *                  for M4 Logistics mode (denormalized from cases row)
 *   • Timestamps — updatedAt (sort key), createdAt
 *
 * Custody state semantics
 * ───────────────────────
 * `currentCustodianId` / `currentCustodianName`:
 *   The toUserId / toUserName of the most recent custodyRecord for the case.
 *   Falls back to cases.assigneeId / cases.assigneeName when no custody
 *   record exists (i.e., custody has never been formally transferred via the
 *   SCAN app handoff workflow).
 *
 * `custodyTransferredAt`:
 *   Epoch ms when the latest handoff occurred.  Undefined when no handoff
 *   has been recorded.
 *
 * `custodyFromUserId` / `custodyFromUserName`:
 *   The outgoing holder on the most recent transfer — useful for map tooltip
 *   "Received from Alice" display.  Undefined when no handoff has occurred.
 *
 * Real-time reactivity
 * ────────────────────
 * Convex tracks this query's dependencies on BOTH the `cases` AND
 * `custodyRecords` tables.  Any SCAN app mutation that writes to either table
 * (scanCheckIn, handoffCustody, shipCase, etc.) invalidates all active
 * subscriptions and pushes a re-evaluated result to connected clients within
 * ~100–300 ms — satisfying the ≤ 2-second real-time fidelity requirement.
 *
 * Performance
 * ───────────
 * The query performs two index scans (cases by_updated, custodyRecords full)
 * in a single Promise.all, then joins entirely in-memory:
 *   • O(|custodyRecords|) to build latestCustodyByCase map
 *   • O(|filtered cases|) to project results
 * No per-case sub-queries — N+1 free.
 *
 * Filter semantics
 * ────────────────
 * All filter args are optional.  When not provided, all cases are returned
 * (subject to bounds if provided).
 *   • `status[]`    — includes only cases with a status in the given array
 *   • `assigneeId`  — includes only cases assigned to the given Kinde user ID
 *   • `missionId`   — includes only cases on the given mission
 *   • `swLat/swLng/neLat/neLng` — all four must be provided together;
 *     cases without lat/lng are excluded when bounds are active
 *
 * Client usage:
 *   // All cases for M1 Fleet Overview (real-time fleet pins)
 *   const cases = useQuery(api.cases.listForMap, {});
 *
 *   // Only deployed + flagged cases (M3 Field Mode)
 *   const fieldCases = useQuery(api.cases.listForMap, {
 *     status: ["deployed", "flagged"],
 *   });
 *
 *   // Cases within the current map viewport (M1 viewport-aware)
 *   const viewportCases = useQuery(api.cases.listForMap, {
 *     swLat: 40.0, swLng: -74.5, neLat: 41.0, neLng: -73.5,
 *   });
 *
 *   // Cases on a specific mission (M2 Mission Mode drill-down)
 *   const missionCases = useQuery(api.cases.listForMap, { missionId });
 *
 *   // Cases currently held by a specific technician (M3 assignee filter)
 *   const myCases = useQuery(api.cases.listForMap, { assigneeId: myKindeId });
 */

/**
 * Map-projection shape: position + status + custody state for one case.
 *
 * Used as the return element type of `listForMap`.  All map components that
 * render case pins, tooltips, or detail sidebars should accept this type so
 * they remain compatible with any map mode.
 */
export interface CaseForMapResult {
  _id: string;
  label: string;
  status: CaseStatus;

  // ── Position ──────────────────────────────────────────────────────────────
  /** Last-known latitude.  Undefined when the case has no recorded position. */
  lat?: number;
  /** Last-known longitude.  Undefined when the case has no recorded position. */
  lng?: number;
  /** Human-readable location name (e.g., "Site Alpha — Bay 4"). */
  locationName?: string;

  // ── Assignment (denormalized from cases row) ──────────────────────────────
  /**
   * Kinde user ID of the currently assigned technician.
   * Written by scanCheckIn / handoffCustody mutations to cases.assigneeId.
   * May differ from currentCustodianId when assignee was set without a formal
   * custody handoff.
   */
  assigneeId?: string;
  /** Display name matching assigneeId. */
  assigneeName?: string;

  // ── Custody state (from custodyRecords) ───────────────────────────────────
  /**
   * Kinde user ID of the current physical custodian.
   * Resolved from the toUserId on the most recent custodyRecord.
   * Falls back to assigneeId when no custody record exists.
   */
  currentCustodianId?: string;
  /**
   * Display name of the current physical custodian.
   * Resolved from toUserName on the most recent custodyRecord.
   * Falls back to assigneeName when no custody record exists.
   */
  currentCustodianName?: string;
  /**
   * Epoch ms when the case was last handed off.
   * Undefined when no formal custody transfer has been recorded.
   */
  custodyTransferredAt?: number;
  /**
   * Kinde user ID of the person who last transferred the case OUT.
   * Undefined when no formal custody transfer has been recorded.
   */
  custodyFromUserId?: string;
  /**
   * Display name of the person who last transferred the case OUT.
   * Undefined when no formal custody transfer has been recorded.
   */
  custodyFromUserName?: string;

  // ── Mission association ───────────────────────────────────────────────────
  /** Convex ID of the associated mission (for M2 grouping / M5 clustering). */
  missionId?: string;

  // ── Shipping summary (M4 Logistics mode) ─────────────────────────────────
  /**
   * FedEx tracking number.  Present when the case is in transit_out or
   * transit_in status.  Denormalized from the cases row by shipCase mutation.
   */
  trackingNumber?: string;
  /** Carrier name — always "FedEx" at current implementation. */
  carrier?: string;
  /** Epoch ms when the shipment was created. */
  shippedAt?: number;
  /** Human-readable destination (e.g., "SkySpecs HQ — Ann Arbor"). */
  destinationName?: string;
  /** Destination latitude for M4 logistics pin placement. */
  destinationLat?: number;
  /** Destination longitude for M4 logistics pin placement. */
  destinationLng?: number;

  // ── Carrier tracking state (M4 logistics pin tooltip, T3/T4 panels) ──────
  /**
   * Normalized FedEx carrier tracking status.
   * Written by `updateShipmentStatus` after each FedEx tracking poll.
   * Values: "label_created" | "picked_up" | "in_transit" | "out_for_delivery"
   *        | "delivered" | "exception"
   * Undefined until the first FedEx tracking poll completes.
   */
  carrierStatus?: string;

  /**
   * Estimated delivery date as an ISO 8601 date-time string from FedEx.
   * Written by `updateShipmentStatus`.  Undefined before the first tracking poll.
   */
  estimatedDelivery?: string;

  /**
   * Most recent FedEx scan event for this case.
   * Written by `updateShipmentStatus` with events[0] from the FedEx response.
   * Undefined when no FedEx scan events have been recorded yet.
   */
  lastCarrierEvent?: {
    timestamp:   string;
    eventType:   string;
    description: string;
    location: {
      city?:    string;
      state?:   string;
      country?: string;
    };
  };

  // ── Timestamps ────────────────────────────────────────────────────────────
  /** Epoch ms when the case record was last mutated.  Used as default sort key. */
  updatedAt: number;
  /** Epoch ms when the case record was first created. */
  createdAt: number;
}

export const listForMap = query({
  args: {
    // ── Geographic bounds (all four required together) ──────────────────────
    /** South-West latitude of the map viewport. */
    swLat: v.optional(v.number()),
    /** South-West longitude of the map viewport. */
    swLng: v.optional(v.number()),
    /** North-East latitude of the map viewport. */
    neLat: v.optional(v.number()),
    /** North-East longitude of the map viewport. */
    neLng: v.optional(v.number()),

    // ── Field filters ───────────────────────────────────────────────────────
    /**
     * One or more lifecycle statuses to include.
     * When omitted, all statuses are returned.
     * M3 Field Mode typically passes ["deployed", "flagged"].
     */
    status: v.optional(v.array(caseStatusValidator)),
    /**
     * Kinde user ID to filter by assignment.
     * When provided, only cases where cases.assigneeId === assigneeId are included.
     * Used by the "My Cases" assignee filter in M3 Field Mode.
     */
    assigneeId: v.optional(v.string()),
    /**
     * Convex mission ID string to filter by mission.
     * When provided, only cases where cases.missionId matches are included.
     * Used by M2 Mission Mode single-mission drill-down.
     */
    missionId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<CaseForMapResult[]> => {
    await requireAuth(ctx);

    // ── Single parallel database pass — no sequential awaits ──────────────
    // Both reads are issued concurrently.  Convex tracks the `cases` table
    // dependency (invalidated by scanCheckIn, shipCase, etc.) AND the
    // `custodyRecords` table dependency (invalidated by handoffCustody).
    const [allCases, allCustodyRecords] = await Promise.all([
      ctx.db
        .query("cases")
        .withIndex("by_updated")
        .order("desc")
        .collect(),
      ctx.db.query("custodyRecords").collect(),
    ]);

    // ── Build O(1) latest-custody-per-case map ─────────────────────────────
    // Single linear pass over all custody records — no per-case sub-queries.
    // Picks the record with the highest `transferredAt` (most recent handoff)
    // for each case.  This mirrors the logic in convex/custody.ts
    // `getLatestCustodyRecord` but without the per-case DB call.
    const latestCustodyByCase = new Map<string, {
      toUserId:     string;
      toUserName:   string;
      fromUserId:   string;
      fromUserName: string;
      transferredAt: number;
    }>();

    for (const record of allCustodyRecords) {
      const key = record.caseId.toString();
      const existing = latestCustodyByCase.get(key);
      if (!existing || record.transferredAt > existing.transferredAt) {
        latestCustodyByCase.set(key, {
          toUserId:      record.toUserId,
          toUserName:    record.toUserName,
          fromUserId:    record.fromUserId,
          fromUserName:  record.fromUserName,
          transferredAt: record.transferredAt,
        });
      }
    }

    // ── Apply field filters ────────────────────────────────────────────────
    let filtered = allCases;

    if (args.status !== undefined && args.status.length > 0) {
      filtered = filtered.filter((c) =>
        args.status!.includes(c.status as CaseStatus)
      );
    }
    if (args.assigneeId !== undefined) {
      filtered = filtered.filter((c) => c.assigneeId === args.assigneeId);
    }
    if (args.missionId !== undefined) {
      filtered = filtered.filter(
        (c) => c.missionId?.toString() === args.missionId
      );
    }

    // ── Apply geographic bounds filter ─────────────────────────────────────
    // All four bounds params must be provided together.
    // Cases without lat/lng are excluded when bounds are active.
    const hasBounds =
      args.swLat !== undefined &&
      args.swLng !== undefined &&
      args.neLat !== undefined &&
      args.neLng !== undefined;

    if (hasBounds) {
      filtered = filtered.filter(
        (c) =>
          c.lat !== undefined &&
          c.lng !== undefined &&
          c.lat >= args.swLat! &&
          c.lat <= args.neLat! &&
          c.lng >= args.swLng! &&
          c.lng <= args.neLng!
      );
    }

    // ── Project to map-optimised shape ────────────────────────────────────
    // O(1) custody lookup per case — no additional DB calls.
    return filtered.map((c): CaseForMapResult => {
      const custody = latestCustodyByCase.get(c._id.toString());

      return {
        _id:    c._id.toString(),
        label:  c.label,
        status: c.status as CaseStatus,

        // Position
        lat:          c.lat,
        lng:          c.lng,
        locationName: c.locationName,

        // Assignment (denormalized on cases row)
        assigneeId:   c.assigneeId,
        assigneeName: c.assigneeName,

        // Custody state — prefer custodyRecords; fall back to denormalized
        // assignee fields for cases that have never had a formal handoff.
        currentCustodianId:   custody?.toUserId    ?? c.assigneeId,
        currentCustodianName: custody?.toUserName  ?? c.assigneeName,
        custodyTransferredAt: custody?.transferredAt,
        custodyFromUserId:    custody?.fromUserId,
        custodyFromUserName:  custody?.fromUserName,

        // Mission association
        missionId: c.missionId?.toString(),

        // Shipping summary (M4 Logistics mode)
        trackingNumber:  c.trackingNumber,
        carrier:         c.carrier,
        shippedAt:       c.shippedAt,
        destinationName: c.destinationName,
        destinationLat:  c.destinationLat,
        destinationLng:  c.destinationLng,

        // Carrier tracking state (written by updateShipmentStatus after FedEx poll)
        // Included here so M4 map pin tooltips and T3/T4 panels can show
        // carrier status without a secondary join to the shipments table.
        carrierStatus:    c.carrierStatus,
        estimatedDelivery: c.estimatedDelivery,
        lastCarrierEvent: c.lastCarrierEvent as CaseForMapResult["lastCarrierEvent"],

        // Timestamps
        updatedAt: c.updatedAt,
        createdAt: c.createdAt,
      };
    });
  },
});

// ─── QR code source union validator ──────────────────────────────────────────

/**
 * Convex value validator for the qrCodeSource union.
 * Mirrors the `qrCodeSource` definition in convex/schema.ts.
 * Used by the QR code mutation args.
 */
const qrCodeSourceValidator = v.union(
  v.literal("generated"),
  v.literal("external"),
);

// ─── QR code mutation return types ───────────────────────────────────────────

/**
 * Result returned by `generateQrCode`.
 * Exported so client-side hooks can expose typed results.
 */
export interface GenerateQrCodeResult {
  /** Convex document ID of the case that was updated. */
  caseId: string;
  /**
   * The generated QR code string written to `cases.qrCode`.
   * Format: `{baseUrl}/{caseId}?uid={uuid}` when `baseUrl` is provided,
   * or `case:{caseId}:uid:{uuid}` when no `baseUrl` is given.
   */
  qrCode: string;
  /** Always `"generated"` — indicates this code was system-generated. */
  qrCodeSource: "generated";
}

/**
 * Result returned by `setQrCode`.
 * Exported so client-side hooks can expose typed results.
 */
export interface SetQrCodeResult {
  /** Convex document ID of the case that was updated. */
  caseId: string;
  /** The QR code string now stored on the case. */
  qrCode: string;
  /** Whether this QR code was generated by the system or externally assigned. */
  qrCodeSource: "generated" | "external";
  /**
   * `true` when the QR code was already stored on this exact case with the same
   * source — the mutation succeeded but made no DB write (idempotent no-op).
   * `false` when the QR code was newly written.
   */
  wasAlreadySet: boolean;
}

/**
 * Result returned by `updateQrCode`.
 * Exported so client-side hooks can expose typed results.
 */
export interface UpdateQrCodeResult {
  /** Convex document ID of the case that was updated. */
  caseId: string;
  /** The new QR code string written to `cases.qrCode`. */
  qrCode: string;
  /** Whether the new code is generated or externally assigned. */
  qrCodeSource: "generated" | "external";
  /**
   * The QR code string that was stored on the case BEFORE this update.
   * Useful for audit diff rendering in the T5 panel.
   * `null` when the case had no QR code prior to this update.
   */
  previousQrCode: string | null;
  /**
   * The source classification of the PREVIOUS QR code.
   * `null` when the case had no QR code prior to this update.
   */
  previousQrCodeSource: "generated" | "external" | null;
  /**
   * `true` when the new QR code is identical to the existing one (same value
   * AND same source) — no DB write occurred. Callers can safely retry.
   */
  wasAlreadySet: boolean;
}

// ─── generateQrCode ───────────────────────────────────────────────────────────

/**
 * Generate a UUID-based QR code and associate it with an equipment case.
 *
 * This mutation is the system-initiated path for QR code assignment: it calls
 * `crypto.randomUUID()` to produce a v4 UUID, optionally wraps it in a
 * URL format, writes the result to `cases.qrCode`, and records
 * `cases.qrCodeSource = "generated"`.
 *
 * QR code format
 * ──────────────
 *   • When `baseUrl` is provided (e.g. `"https://scan.skyspecs.com"`):
 *       `{baseUrl}/{caseId}?uid={uuid}`
 *     This produces a scannable URL that the SCAN app can deep-link directly
 *     to the case detail view after decoding the QR image.
 *
 *   • When `baseUrl` is omitted:
 *       `case:{caseId}:uid:{uuid}`
 *     This produces a compact, URL-free payload for offline or print-only labels
 *     where URL deep-linking is not required.
 *
 * Uniqueness guarantee
 * ────────────────────
 * UUID v4 collision probability is negligibly small (~10⁻³⁸ for ≤ 2⁶¹ codes),
 * but the mutation still performs an O(log n) uniqueness check via the
 * `by_qr_code` index for defence-in-depth consistency with `setQrCode`.
 * The check also guards against the (extremely unlikely) case where the same
 * UUID was previously generated and is still mapped to another case.
 *
 * Real-time fidelity
 * ──────────────────
 * Patching `cases.qrCode` triggers reactive re-evaluation of all Convex queries
 * subscribed to the affected case row (getCaseByQrCode, getCaseById, listCases,
 * listForMap, etc.) within ~100–300 ms, satisfying the ≤ 2-second requirement.
 *
 * @param caseId    Convex document ID of the case to assign a QR code to.
 * @param userId    Kinde user ID of the operator initiating the generation.
 * @param userName  Display name of the operator (written to the audit event).
 * @param baseUrl   Optional base URL for constructing a scannable deep-link.
 *                  Must be a non-empty string when provided (no trailing slash).
 *                  Example: `"https://scan.skyspecs.com"`
 *
 * @returns `GenerateQrCodeResult` containing the case ID and the generated
 *          QR code string.
 *
 * @throws When the case does not exist.
 * @throws When the case already has a QR code (use `updateQrCode` instead).
 * @throws When the generated UUID collides with an existing QR code (retry).
 *
 * Client usage:
 *   const generate = useMutation(api.cases.generateQrCode);
 *   const result = await generate({
 *     caseId:   targetCase._id,
 *     userId:   kindeUser.id,
 *     userName: "Jane Pilot",
 *     baseUrl:  "https://scan.skyspecs.com",
 *   });
 *   // result.qrCode → "https://scan.skyspecs.com/j97abc...?uid=4f3d1a9b..."
 */
export const generateQrCode = mutation({
  args: {
    /**
     * Convex document ID of the case to assign a generated QR code to.
     * The case must already exist; no QR code must currently be set on it.
     */
    caseId: v.id("cases"),

    /**
     * Kinde user ID of the operator initiating QR generation.
     * Written to the audit event for attribution.
     */
    userId: v.string(),

    /**
     * Display name of the operator.
     * Written to the audit event so the T5 audit panel can show attribution
     * without a separate user lookup.
     */
    userName: v.string(),

    /**
     * Optional base URL for constructing a scannable deep-link QR payload.
     * When provided, the QR code is formatted as:
     *   `{baseUrl}/{caseId}?uid={uuid}`
     * When omitted, the compact format is used:
     *   `case:{caseId}:uid:{uuid}`
     *
     * Example: `"https://scan.skyspecs.com"` (no trailing slash)
     */
    baseUrl: v.optional(v.string()),
  },

  handler: async (ctx, args): Promise<GenerateQrCodeResult> => {
    await requireAuth(ctx);

    // ── Verify the target case exists (O(1) primary-key lookup) ──────────────
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(
        `generateQrCode: Case "${args.caseId}" not found.`
      );
    }

    // ── Guard: case must not already have a QR code ───────────────────────────
    // Use updateQrCode to reassign an existing QR code.
    if (caseDoc.qrCode && caseDoc.qrCode.trim().length > 0) {
      throw new Error(
        `generateQrCode: Case "${caseDoc.label}" already has a QR code ` +
        `("${caseDoc.qrCode}"). Use updateQrCode to reassign it.`
      );
    }

    // ── Generate UUID and construct QR payload ────────────────────────────────
    // crypto.randomUUID() is available in the Convex Deno / Node.js runtime.
    const uuid = crypto.randomUUID();
    const qrCode = args.baseUrl && args.baseUrl.trim().length > 0
      ? `${args.baseUrl.trim().replace(/\/$/, "")}/${args.caseId}?uid=${uuid}`
      : `case:${args.caseId}:uid:${uuid}`;

    // ── Uniqueness check via by_qr_code index — O(log n) ─────────────────────
    // UUID collision is astronomically unlikely, but we guard for consistency.
    const conflicting = await ctx.db
      .query("cases")
      .withIndex("by_qr_code", (q) => q.eq("qrCode", qrCode))
      .first();

    if (conflicting !== null) {
      // UUID collision detected (practically impossible — indicates a bug).
      throw new Error(
        `generateQrCode: Generated QR code collides with an existing mapping ` +
        `on case "${conflicting.label}" (ID: ${conflicting._id}). ` +
        `Please retry — this is an extremely rare UUID collision.`
      );
    }

    // ── Persist the generated QR code mapping ─────────────────────────────────
    const now = Date.now();
    await ctx.db.patch(args.caseId, {
      qrCode,
      qrCodeSource: "generated",
      updatedAt:    now,
    });

    // ── Immutable audit event ─────────────────────────────────────────────────
    await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "note_added",
      userId:    args.userId,
      userName:  args.userName,
      timestamp: now,
      data: {
        action:       "qr_code_generated",
        qrCode,
        qrCodeSource: "generated",
        uuid,
        caseLabel:    caseDoc.label,
      },
    });

    return {
      caseId:       args.caseId,
      qrCode,
      qrCodeSource: "generated",
    };
  },
});

// ─── setQrCode ────────────────────────────────────────────────────────────────

/**
 * Set a QR code identifier on an equipment case document.
 *
 * This is the general-purpose QR code assignment mutation.  It covers both
 * pathways described in the data model:
 *
 *   • `source: "generated"` — The caller has already generated a UUID-based
 *     string externally (e.g. via a batch-label-print script) and is assigning
 *     it here.  Use `generateQrCode` instead when you want the server to
 *     generate the UUID automatically.
 *
 *   • `source: "external"` — The QR payload was read from an existing physical
 *     label already printed on the case (pre-printed asset tags, third-party
 *     labels, etc.).  The value is stored verbatim.
 *
 * Idempotency
 * ───────────
 * If the QR code AND source are already identical on this case, the mutation
 * returns early with `wasAlreadySet: true` without performing any DB write.
 * Callers can safely retry after transient errors.
 *
 * Conflict handling
 * ─────────────────
 * If the QR code string is already mapped to a DIFFERENT case, the mutation
 * throws with a descriptive error including the conflicting case's label and ID.
 * The caller should surface this to the operator as a conflict warning.
 *
 * Real-time fidelity
 * ──────────────────
 * Patching `cases.qrCode` triggers reactive re-evaluation of all Convex queries
 * subscribed to the affected case row within ~100–300 ms, satisfying the
 * ≤ 2-second fidelity requirement.
 *
 * @param caseId      Convex document ID of the target case.
 * @param qrCode      The QR payload string to associate with the case.
 *                    Must be a non-empty string after trimming.
 * @param source      How this QR code was produced: "generated" or "external".
 * @param userId      Kinde user ID of the operator making the assignment.
 * @param userName    Display name for the audit event.
 *
 * @returns `SetQrCodeResult` indicating whether the code was written or was
 *          already present.
 *
 * @throws When `qrCode` is empty or whitespace-only.
 * @throws When the target case does not exist.
 * @throws When `qrCode` is already mapped to a different case.
 *
 * Client usage:
 *   // Assign a pre-printed external label to a case
 *   const set = useMutation(api.cases.setQrCode);
 *   await set({
 *     caseId:   caseDoc._id,
 *     qrCode:   "SkySpecs-ExtLabel-00421",
 *     source:   "external",
 *     userId:   kindeUser.id,
 *     userName: "Logistics Team",
 *   });
 */
export const setQrCode = mutation({
  args: {
    /**
     * Convex document ID of the case to assign the QR code to.
     * The case must already exist in the database.
     */
    caseId: v.id("cases"),

    /**
     * The QR payload string to write to `cases.qrCode`.
     * Must be a non-empty string after trimming.
     * For external labels: the exact string encoded in the QR image.
     * For generated labels: the UUID-based string constructed by the caller.
     */
    qrCode: v.string(),

    /**
     * How this QR code was produced.
     *   "generated" — UUID-based, system-generated (or caller-generated) string
     *   "external"  — verbatim payload from a pre-existing physical label
     * Written to `cases.qrCodeSource` and recorded in the audit event.
     */
    source: qrCodeSourceValidator,

    /**
     * Kinde user ID of the operator making the QR code assignment.
     * Written to the audit event for attribution.
     */
    userId: v.string(),

    /**
     * Display name of the operator.
     * Written to the audit event for T5 panel display.
     */
    userName: v.string(),
  },

  handler: async (ctx, args): Promise<SetQrCodeResult> => {
    await requireAuth(ctx);

    // ── 1. Validate qrCode is non-empty ───────────────────────────────────────
    const qrCode = args.qrCode.trim();
    if (qrCode.length === 0) {
      throw new Error(
        "setQrCode: qrCode must be a non-empty string."
      );
    }

    // ── 2. Verify the target case exists (O(1) primary-key lookup) ────────────
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(
        `setQrCode: Case "${args.caseId}" not found.`
      );
    }

    // ── 3. Idempotent check — same QR code AND same source already set ─────────
    // Return early without a DB write so callers can safely retry after a
    // transient error. Both value and source must match for a true no-op.
    if (caseDoc.qrCode === qrCode && caseDoc.qrCodeSource === args.source) {
      return {
        caseId:       args.caseId,
        qrCode,
        qrCodeSource: args.source,
        wasAlreadySet: true,
      };
    }

    // ── 4. Uniqueness check via by_qr_code index — O(log n) ──────────────────
    // A QR code may only be mapped to one case at a time.  The by_qr_code
    // index makes this check O(log n) instead of a full table scan.
    const conflicting = await ctx.db
      .query("cases")
      .withIndex("by_qr_code", (q) => q.eq("qrCode", qrCode))
      .first();

    if (conflicting !== null && conflicting._id !== args.caseId) {
      throw new Error(
        `setQrCode: QR code "${qrCode}" is already mapped to case ` +
        `"${conflicting.label}" (ID: ${conflicting._id}). ` +
        `Each QR code may only be associated with one case at a time. ` +
        `Use updateQrCode on the conflicting case to reassign it first.`
      );
    }

    // ── 5. Persist the QR code mapping ────────────────────────────────────────
    const now = Date.now();
    await ctx.db.patch(args.caseId, {
      qrCode,
      qrCodeSource: args.source,
      updatedAt:    now,
    });

    // ── 6. Immutable audit event ──────────────────────────────────────────────
    await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "note_added",
      userId:    args.userId,
      userName:  args.userName,
      timestamp: now,
      data: {
        action:            "qr_code_set",
        qrCode,
        qrCodeSource:      args.source,
        previousQrCode:    caseDoc.qrCode ?? null,
        previousQrCodeSource: caseDoc.qrCodeSource ?? null,
        caseLabel:         caseDoc.label,
      },
    });

    return {
      caseId:       args.caseId,
      qrCode,
      qrCodeSource: args.source,
      wasAlreadySet: false,
    };
  },
});

// ─── updateQrCode ─────────────────────────────────────────────────────────────

/**
 * Update the QR code identifier on an equipment case document.
 *
 * Use this mutation when a case already has a QR code and you need to reassign
 * it — for example:
 *   • A physical label is damaged and replaced with a new one.
 *   • A case is re-labelled with a different barcode format.
 *   • An external code is upgraded to a system-generated URL-based code.
 *   • A data-entry error in the original QR code value must be corrected.
 *
 * Differences from `setQrCode`
 * ────────────────────────────
 *   • `updateQrCode` returns the previous QR code and source in the result,
 *     making it easy for the T5 audit panel to show a "before → after" diff.
 *   • The audit event payload explicitly records `previousQrCode` and
 *     `previousQrCodeSource` for full traceability.
 *   • `updateQrCode` does NOT throw when the case has no existing QR code —
 *     it silently acts as an initial assignment in that case (graceful fallback).
 *
 * Both `setQrCode` and `updateQrCode` write to `cases.qrCode`,
 * `cases.qrCodeSource`, and `cases.updatedAt` atomically in a single
 * `ctx.db.patch` call and append an immutable audit event.
 *
 * Idempotency
 * ───────────
 * If the new QR code AND source are already identical on this case, the
 * mutation returns early with `wasAlreadySet: true` and no DB write occurs.
 *
 * Conflict handling
 * ─────────────────
 * If the new QR code string is already mapped to a DIFFERENT case, the mutation
 * throws.  The caller should surface a conflict warning to the operator.
 *
 * @param caseId      Convex document ID of the target case.
 * @param qrCode      The new QR payload string to write to `cases.qrCode`.
 *                    Must be non-empty after trimming.
 * @param source      Source classification for the new QR code.
 * @param userId      Kinde user ID of the operator making the update.
 * @param userName    Display name for the audit event.
 *
 * @returns `UpdateQrCodeResult` including the previous QR code value and source
 *          for audit diff rendering.
 *
 * @throws When `qrCode` is empty or whitespace-only.
 * @throws When the target case does not exist.
 * @throws When `qrCode` is already mapped to a different case.
 *
 * Client usage:
 *   const update = useMutation(api.cases.updateQrCode);
 *   const result = await update({
 *     caseId:   caseDoc._id,
 *     qrCode:   "https://scan.skyspecs.com/j97abc...?uid=new-uuid",
 *     source:   "generated",
 *     userId:   kindeUser.id,
 *     userName: "Jane Pilot",
 *   });
 *   // result.previousQrCode → "SkySpecs-ExtLabel-00421"
 *   // result.qrCode         → "https://scan.skyspecs.com/...?uid=new-uuid"
 */
export const updateQrCode = mutation({
  args: {
    /**
     * Convex document ID of the case whose QR code is being updated.
     * The case must already exist; it may or may not have an existing QR code.
     */
    caseId: v.id("cases"),

    /**
     * The new QR payload string to write to `cases.qrCode`.
     * Must be a non-empty string after trimming.
     */
    qrCode: v.string(),

    /**
     * Source classification for the new QR code value.
     *   "generated" — UUID-based, system or script generated
     *   "external"  — verbatim from a pre-printed physical label
     */
    source: qrCodeSourceValidator,

    /**
     * Kinde user ID of the operator performing the update.
     * Written to the audit event for attribution.
     */
    userId: v.string(),

    /**
     * Display name of the operator.
     * Written to the audit event for T5 panel display.
     */
    userName: v.string(),
  },

  handler: async (ctx, args): Promise<UpdateQrCodeResult> => {
    await requireAuth(ctx);

    // ── 1. Validate qrCode is non-empty ───────────────────────────────────────
    const qrCode = args.qrCode.trim();
    if (qrCode.length === 0) {
      throw new Error(
        "updateQrCode: qrCode must be a non-empty string."
      );
    }

    // ── 2. Verify the target case exists (O(1) primary-key lookup) ────────────
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(
        `updateQrCode: Case "${args.caseId}" not found.`
      );
    }

    // Capture previous values before any write for the audit event and result.
    const previousQrCode: string | null = caseDoc.qrCode ?? null;
    const previousQrCodeSource: "generated" | "external" | null =
      (caseDoc.qrCodeSource as "generated" | "external" | undefined) ?? null;

    // ── 3. Idempotent check — same QR code AND same source already set ─────────
    if (caseDoc.qrCode === qrCode && caseDoc.qrCodeSource === args.source) {
      return {
        caseId:               args.caseId,
        qrCode,
        qrCodeSource:         args.source,
        previousQrCode,
        previousQrCodeSource,
        wasAlreadySet:        true,
      };
    }

    // ── 4. Uniqueness check via by_qr_code index — O(log n) ──────────────────
    // The new QR code must not be in use on a different case.
    // It IS allowed on this same case (idempotent update is caught above;
    // changing only source is allowed and skips uniqueness concern since the
    // QR payload value is unchanged).
    const conflicting = await ctx.db
      .query("cases")
      .withIndex("by_qr_code", (q) => q.eq("qrCode", qrCode))
      .first();

    if (conflicting !== null && conflicting._id !== args.caseId) {
      throw new Error(
        `updateQrCode: QR code "${qrCode}" is already mapped to case ` +
        `"${conflicting.label}" (ID: ${conflicting._id}). ` +
        `Each QR code may only be associated with one case at a time.`
      );
    }

    // ── 5. Persist the updated QR code mapping ────────────────────────────────
    const now = Date.now();
    await ctx.db.patch(args.caseId, {
      qrCode,
      qrCodeSource: args.source,
      updatedAt:    now,
    });

    // ── 6. Immutable audit event ──────────────────────────────────────────────
    // Record both previous and new values so the T5 panel can render a diff.
    await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "note_added",
      userId:    args.userId,
      userName:  args.userName,
      timestamp: now,
      data: {
        action:               "qr_code_updated",
        qrCode,
        qrCodeSource:         args.source,
        previousQrCode,
        previousQrCodeSource,
        caseLabel:            caseDoc.label,
      },
    });

    return {
      caseId:               args.caseId,
      qrCode,
      qrCodeSource:         args.source,
      previousQrCode,
      previousQrCodeSource,
      wasAlreadySet:        false,
    };
  },
});

// ─── updateCaseStatus ─────────────────────────────────────────────────────────

/**
 * Update the lifecycle status of an equipment case — dashboard inline editor.
 *
 * This mutation is the server-side handler for the INVENTORY dashboard's
 * click-to-edit inline status field (InlineStatusEditor component).
 *
 * Unlike the SCAN app's `scanCheckIn` mutation (which enforces VALID_TRANSITIONS
 * to maintain field-operation data integrity), this dashboard mutation permits
 * any status change so that operators can correct erroneous states.  All changes
 * are recorded in the immutable `events` table with `source: "dashboard_inline"`
 * for full auditability.
 *
 * Idempotency:
 *   When `newStatus` equals the current status, the mutation returns immediately
 *   without writing to the database.  The caller can safely re-invoke without
 *   producing duplicate audit events.
 *
 * Real-time fidelity:
 *   Patching `cases.status` triggers reactive re-evaluation of all Convex queries
 *   subscribed to the affected case row (getCaseById, getCaseStatus, listForMap,
 *   getCaseStatusCounts, etc.) within ~100–300 ms, satisfying the ≤ 2-second
 *   requirement and reflecting the change on all connected INVENTORY dashboards.
 *
 * Optimistic updates:
 *   The InlineStatusEditor component uses `useMutation.withOptimisticUpdate` to
 *   patch the local `getCaseById` query result immediately on submit, providing
 *   an instant UI response before the server round-trip completes.
 *
 * @param caseId    Convex document ID of the case whose status is being changed.
 * @param newStatus Target lifecycle status value.
 * @param userId    Kinde user ID of the operator making the change (for audit).
 * @param userName  Display name of the operator (written to the audit event).
 *
 * @returns `{ caseId, previousStatus, newStatus }` — the previous and new
 *          status values, useful for toast confirmation messages.
 *
 * @throws When the case does not exist.
 *
 * Client usage (via InlineStatusEditor):
 *   const updateStatus = useMutation(api.cases.updateCaseStatus)
 *     .withOptimisticUpdate((localStore, args) => {
 *       const doc = localStore.getQuery(api.cases.getCaseById, { caseId: args.caseId });
 *       if (doc != null) {
 *         localStore.setQuery(api.cases.getCaseById, { caseId: args.caseId },
 *           { ...doc, status: args.newStatus, updatedAt: Date.now() });
 *       }
 *     });
 *
 *   await updateStatus({ caseId, newStatus: "deployed", userId, userName });
 */
export const updateCaseStatus = mutation({
  args: {
    /**
     * Convex document ID of the case whose status is being updated.
     * The case must already exist in the database.
     */
    caseId: v.id("cases"),

    /**
     * Target lifecycle status to write to the case.
     * All valid case status values are accepted (no transition guard —
     * this mutation is intended for dashboard operator overrides).
     */
    newStatus: caseStatusValidator,

    /**
     * Kinde user ID of the operator making the status change.
     * Written to the audit event for attribution.
     */
    userId: v.string(),

    /**
     * Display name of the operator.
     * Written to the audit event for T5 panel display.
     */
    userName: v.string(),
  },

  handler: async (ctx, args): Promise<{
    caseId: string;
    previousStatus: string;
    newStatus: string;
  }> => {
    await requireAuth(ctx);

    // ── 1. Verify the target case exists (O(1) primary-key lookup) ────────────
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(
        `updateCaseStatus: Case "${args.caseId}" not found.`
      );
    }

    const previousStatus = caseDoc.status;

    // ── 2. Idempotent check — no write if status is already correct ──────────
    // Avoids duplicate audit events and unnecessary DB writes.
    if (previousStatus === args.newStatus) {
      return {
        caseId:         args.caseId,
        previousStatus,
        newStatus:      args.newStatus,
      };
    }

    // ── 3. Persist the status change ─────────────────────────────────────────
    const now = Date.now();
    await ctx.db.patch(args.caseId, {
      status:    args.newStatus,
      updatedAt: now,
    });

    // ── 4. Immutable audit event ──────────────────────────────────────────────
    // Recorded even for dashboard overrides so the T5 audit chain is complete.
    // `source: "dashboard_inline"` distinguishes these overrides from SCAN
    // field check-ins (`source: "scan_checkin"`) in the audit log.
    await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "status_change",
      userId:    args.userId,
      userName:  args.userName,
      timestamp: now,
      data: {
        previousStatus,
        newStatus:  args.newStatus,
        source:     "dashboard_inline",
        caseLabel:  caseDoc.label,
      },
    });

    return {
      caseId:         args.caseId,
      previousStatus,
      newStatus:      args.newStatus,
    };
  },
});

// ─── updateCaseHolder ──────────────────────────────────────────────────────────

/**
 * Update the holder (assignee) name of an equipment case — dashboard inline editor.
 *
 * This mutation is the server-side handler for the INVENTORY dashboard's
 * click-to-edit inline holder field (InlineHolderEditor component).
 *
 * Operators can click the edit icon next to the "Assigned to" field in the T1
 * Summary panel (and the FF_INV_REDESIGN Dossier Overview panel) to open a
 * text input, type a new holder name, and save.
 *
 * The mutation updates `assigneeName` on the case document.  The `assigneeId`
 * field is left unchanged so that any previously resolved Kinde user link is
 * preserved.  Clearing the holder (empty string) sets `assigneeName` to
 * `undefined` so the field renders the "Unassigned" placeholder.
 *
 * All changes are recorded in the immutable `events` table with
 * `source: "dashboard_inline"` for full auditability.
 *
 * Idempotency:
 *   When `newHolderName` equals the current `assigneeName`, the mutation
 *   returns immediately without writing to the database.
 *
 * Real-time fidelity:
 *   Patching `cases.assigneeName` triggers reactive re-evaluation of all Convex
 *   queries subscribed to the affected case row (getCaseById, getCaseStatus,
 *   listForMap, etc.) within ~100–300 ms, satisfying the ≤ 2-second requirement.
 *
 * @param caseId        Convex document ID of the case whose holder is being changed.
 * @param newHolderName New assignee display name (empty string = clear holder).
 * @param userId        Kinde user ID of the operator making the change (for audit).
 * @param userName      Display name of the operator (written to the audit event).
 *
 * @returns `{ caseId, previousHolder, newHolder }` — the previous and new holder
 *          names, useful for toast confirmation messages.
 *
 * @throws When the case does not exist.
 */
export const updateCaseHolder = mutation({
  args: {
    /** Convex document ID of the case whose holder is being updated. */
    caseId: v.id("cases"),

    /**
     * New assignee display name.  Pass an empty string to clear the holder
     * (assigneeName becomes undefined on the document).
     */
    newHolderName: v.string(),

    /**
     * Kinde user ID of the operator making the change.
     * Written to the audit event for attribution.
     */
    userId: v.string(),

    /**
     * Display name of the operator.
     * Written to the audit event for T5 panel display.
     */
    userName: v.string(),
  },

  handler: async (ctx, args): Promise<{
    caseId: string;
    previousHolder: string | null;
    newHolder: string | null;
  }> => {
    await requireAuth(ctx);

    // ── 1. Verify the target case exists ─────────────────────────────────────
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(
        `updateCaseHolder: Case "${args.caseId}" not found.`
      );
    }

    const previousHolder = caseDoc.assigneeName ?? null;
    const trimmedName = args.newHolderName.trim();
    const newHolder = trimmedName.length > 0 ? trimmedName : null;

    // ── 2. Idempotent check — no write if name hasn't changed ────────────────
    if (previousHolder === newHolder) {
      return { caseId: args.caseId, previousHolder, newHolder };
    }

    // ── 3. Persist the holder change ─────────────────────────────────────────
    const now = Date.now();
    await ctx.db.patch(args.caseId, {
      assigneeName: newHolder ?? undefined,
      updatedAt: now,
    });

    // ── 4. Immutable audit event ──────────────────────────────────────────────
    await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "note_added",    // closest semantic match for a field update
      userId:    args.userId,
      userName:  args.userName,
      timestamp: now,
      data: {
        field:          "assigneeName",
        previousHolder,
        newHolder,
        source:         "dashboard_inline",
        caseLabel:      caseDoc.label,
      },
    });

    return { caseId: args.caseId, previousHolder, newHolder };
  },
});

// ─── updateCaseSite ────────────────────────────────────────────────────────────

/**
 * Update the site (locationName) of an equipment case — dashboard inline editor.
 *
 * This mutation is the server-side handler for the INVENTORY dashboard's
 * click-to-edit inline site field (InlineSiteEditor component).
 *
 * Operators can click the edit icon next to the "Site" / "Location" field in
 * the T1 Summary panel (and the FF_INV_REDESIGN Dossier Overview panel) to
 * open a text input, type a new site name, and save.
 *
 * The mutation updates `locationName` on the case document.  Clearing the site
 * (empty string) sets `locationName` to `undefined` so the field renders the
 * "No site" placeholder.
 *
 * All changes are recorded in the immutable `events` table with
 * `source: "dashboard_inline"` for full auditability.
 *
 * Idempotency:
 *   When `newSiteName` equals the current `locationName`, the mutation returns
 *   immediately without writing to the database.
 *
 * Real-time fidelity:
 *   Patching `cases.locationName` triggers reactive re-evaluation of all Convex
 *   queries subscribed to the affected case row (getCaseById, getCaseStatus,
 *   listForMap, etc.) within ~100–300 ms, satisfying the ≤ 2-second requirement.
 *
 * @param caseId      Convex document ID of the case whose site is being changed.
 * @param newSiteName New site / location name (empty string = clear site).
 * @param userId      Kinde user ID of the operator making the change (for audit).
 * @param userName    Display name of the operator (written to the audit event).
 *
 * @returns `{ caseId, previousSite, newSite }` — the previous and new site
 *          names, useful for toast confirmation messages.
 *
 * @throws When the case does not exist.
 */
export const updateCaseSite = mutation({
  args: {
    /** Convex document ID of the case whose site is being updated. */
    caseId: v.id("cases"),

    /**
     * New site / location name.  Pass an empty string to clear the site
     * (locationName becomes undefined on the document).
     */
    newSiteName: v.string(),

    /**
     * Kinde user ID of the operator making the change.
     * Written to the audit event for attribution.
     */
    userId: v.string(),

    /**
     * Display name of the operator.
     * Written to the audit event for T5 panel display.
     */
    userName: v.string(),
  },

  handler: async (ctx, args): Promise<{
    caseId: string;
    previousSite: string | null;
    newSite: string | null;
  }> => {
    await requireAuth(ctx);

    // ── 1. Verify the target case exists ─────────────────────────────────────
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(
        `updateCaseSite: Case "${args.caseId}" not found.`
      );
    }

    const previousSite = caseDoc.locationName ?? null;
    const trimmedName = args.newSiteName.trim();
    const newSite = trimmedName.length > 0 ? trimmedName : null;

    // ── 2. Idempotent check — no write if site name hasn't changed ───────────
    if (previousSite === newSite) {
      return { caseId: args.caseId, previousSite, newSite };
    }

    // ── 3. Persist the site name change ──────────────────────────────────────
    const now = Date.now();
    await ctx.db.patch(args.caseId, {
      locationName: newSite ?? undefined,
      updatedAt: now,
    });

    // ── 4. Immutable audit event ──────────────────────────────────────────────
    await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "note_added",    // closest semantic match for a field update
      userId:    args.userId,
      userName:  args.userName,
      timestamp: now,
      data: {
        field:        "locationName",
        previousSite,
        newSite,
        source:       "dashboard_inline",
        caseLabel:    caseDoc.label,
      },
    });

    return { caseId: args.caseId, previousSite, newSite };
  },
});

// ─── listCasesByStatus ────────────────────────────────────────────────────────

/**
 * Retrieve every case that currently holds a specific lifecycle status.
 *
 * Dedicated single-purpose retrieval function for AC 350003 / Sub-AC 3 —
 * "by status".  Provides a crisp, discoverable API for the dashboard's
 * status-pill drill-downs and the SCAN app's "All deployed cases" lists
 * without requiring callers to construct a combined-args call to `listCases`.
 *
 * Reactive subscription support
 * ─────────────────────────────
 * Defined as a public Convex `query`.  When consumed via the `useQuery` hook
 * in a React client (`useQuery(api.cases.listCasesByStatus, { status })`),
 * Convex automatically tracks the dependency on the `cases` table and
 * pushes a re-evaluated result to the subscriber whenever any case row is
 * inserted, patched, or deleted — typically within ~100–300 ms, satisfying
 * the ≤ 2-second real-time fidelity requirement.
 *
 * Performance
 * ───────────
 *   • Uses the `by_status` index on `cases.status` — O(|cases with status|).
 *   • Result ordering: most-recently-updated first (within the index scan).
 *
 * Authentication
 * ──────────────
 * Throws `[AUTH_REQUIRED]` when the calling client is unauthenticated.
 *
 * @param status   The case lifecycle status to filter by.  Must be one of the
 *                 eight values from the `CaseStatus` union.
 *
 * @returns        Array of full `Doc<"cases">` rows matching the status.
 *                 Returns an empty array (never `null`) when no case has the
 *                 specified status.
 *
 * Client usage:
 *   const deployedCases = useQuery(api.cases.listCasesByStatus, {
 *     status: "deployed",
 *   });
 *   if (deployedCases === undefined) return <Loading />;
 *   return <CaseList rows={deployedCases} />;
 */
export const listCasesByStatus = query({
  args: {
    /**
     * The lifecycle status to filter cases by.
     * Mirrors the `caseStatus` union in convex/schema.ts.
     */
    status: caseStatusValidator,
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    // O(|cases with status|) via the by_status index.
    // Convex re-evaluates this query whenever any case row changes, so
    // subscribers receive an updated array within ~100–300 ms of any mutation
    // that affects a case in the queried status (status transitions in/out,
    // field updates on matching cases, etc.).
    return await ctx.db
      .query("cases")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .collect();
  },
});

// ─── listCasesByLocation ──────────────────────────────────────────────────────

/**
 * Retrieve every case currently associated with a specific human-readable
 * `locationName` (e.g., "Site Alpha — Bay 4", "SkySpecs HQ — Ann Arbor").
 *
 * Dedicated single-purpose retrieval function for AC 350003 / Sub-AC 3 —
 * "by location".  Complements `getCasesInBounds` (geographic bounding-box
 * lookup) by offering a name-based location filter for the dashboard's
 * site/depot drill-down panels and the SCAN app's "All cases at this site"
 * lists.
 *
 * Comparison semantics
 * ────────────────────
 * Location names are stored verbatim and compared exactly (case-sensitive).
 * The caller must supply the same casing and spacing as is stored on the
 * case row.  Whitespace is trimmed server-side to absorb minor padding
 * artefacts from manual entry, but no other normalisation is performed.
 *
 * An empty or whitespace-only `locationName` argument returns an empty array
 * (rather than every case with no locationName) — this avoids accidental
 * "show me everything" queries from misconfigured clients.
 *
 * Performance
 * ───────────
 * The `cases` table does not have a dedicated `by_locationName` index.
 * Implementation uses a scan over the `by_updated` index (O(|cases|)) with
 * an in-memory equality filter on `locationName`.  This is acceptable for
 * a single-tenant fleet up to ~10k cases — the bottleneck is network
 * transfer, not the in-memory filter.  When fleets exceed this scale,
 * adding a `by_location` index in `convex/schema.ts` would convert this
 * to an O(log n) index scan without changing the public API.
 *
 * Reactive subscription support
 * ─────────────────────────────
 * Defined as a public Convex `query`.  Consumed via `useQuery`, Convex
 * tracks the dependency on the `cases` table and pushes incremental updates
 * to all subscribers whenever a case row is created, patched, or deleted
 * — including when `locationName` itself changes (case moves between sites).
 * Re-evaluation latency is typically ~100–300 ms, satisfying the ≤ 2-second
 * real-time fidelity requirement.
 *
 * Authentication
 * ──────────────
 * Throws `[AUTH_REQUIRED]` when the calling client is unauthenticated.
 *
 * @param locationName  Exact (case-sensitive, whitespace-trimmed) location
 *                      name to filter cases by.  Empty / whitespace-only
 *                      values return an empty array.
 *
 * @returns             Array of full `Doc<"cases">` rows whose `locationName`
 *                      equals the provided value.  Returns an empty array
 *                      (never `null`) when no case matches.
 *
 * Client usage:
 *   const siteCases = useQuery(api.cases.listCasesByLocation, {
 *     locationName: "Site Alpha — Bay 4",
 *   });
 *   if (siteCases === undefined) return <Loading />;
 *   return <CaseList rows={siteCases} />;
 */
export const listCasesByLocation = query({
  args: {
    /**
     * The human-readable location name to filter cases by.
     * Whitespace is trimmed server-side; otherwise the comparison is exact.
     */
    locationName: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    // ── Normalize input: trim whitespace ─────────────────────────────────────
    // Absorbs padding artefacts from manual entry while preserving casing.
    const target = args.locationName.trim();

    // ── Guard: empty / whitespace-only input → empty result ─────────────────
    // Prevents accidental "match every case with no locationName" semantics.
    if (target.length === 0) {
      return [];
    }

    // ── Scan + in-memory filter ───────────────────────────────────────────────
    // The `by_updated` index gives a stable desc-by-updatedAt ordering that
    // makes the result list useful for the dashboard "Cases at this site"
    // panel without a client-side sort.  In-memory equality filter on
    // `locationName` is O(|cases|) — acceptable up to ~10k cases.
    const all = await ctx.db
      .query("cases")
      .withIndex("by_updated")
      .order("desc")
      .collect();

    return all.filter((c) => c.locationName === target);
  },
});
