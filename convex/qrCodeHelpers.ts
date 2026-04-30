/**
 * convex/qrCodeHelpers.ts
 *
 * Pure, Convex-runtime-free helper functions for QR-code-to-case association
 * duplicate detection.
 *
 * These helpers are the single source of truth for the rule:
 *
 *   "A QR code may be associated with at most ONE case at any time."
 *
 * They're extracted from the per-mutation guards previously inlined in
 * `convex/qrCodes.ts` and `convex/cases.ts` so that:
 *
 *   1. The conflict-detection contract is documented and tested in one place.
 *   2. New mutations that write `cases.qrCode` (e.g. admin recovery flows,
 *      bulk import scripts, future re-label tooling) cannot accidentally bypass
 *      the uniqueness invariant — they call `detectQrCodeConflict()` and act
 *      on its structured outcome.
 *   3. Unit tests can exercise every branch without standing up a Convex
 *      runtime — the helpers are pure functions parameterized by a tiny
 *      `QrCodeConflictDeps` interface.
 *
 * No imports from `convex/server`, `convex/values`, or `_generated/*` — this
 * file MUST remain safe to import in any JavaScript environment, including
 * Vitest unit tests and Next.js client bundles.
 *
 * Sub-AC 1 contract
 * ─────────────────
 *   Implement duplicate QR detection logic that checks for existing
 *   QR-to-case associations and rejects or flags conflicts before write.
 *
 * The "rejects" branch is `outcome.kind === "conflict"` — callers throw.
 * The "flags" branch is `outcome.kind === "available"` with a populated
 * `conflict` field for cases where the caller wants to surface a soft warning
 * (e.g. the dashboard "QR already mapped" banner) instead of refusing the
 * operation.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Minimal projection of a `cases` table row for conflict detection.
 *
 * Helpers only need three fields — keeping the dependency surface tiny lets
 * tests build mock data trivially.  Match this shape to the real Convex
 * `Doc<"cases">` so callers can pass `caseDoc` directly without copying.
 */
export interface QrCodeCaseRow {
  /** Convex document ID (or any opaque case identifier). */
  _id:    string;
  /** Human-readable case label, e.g. "CASE-001". */
  label:  string;
  /** The QR code string currently stored on this case (may be empty). */
  qrCode: string;
}

/**
 * Dependencies injected into pure detection helpers.
 *
 * Convex callers wrap `ctx.db.query("cases").withIndex("by_qr_code", …)` here.
 * Unit tests pass a `Map<string, QrCodeCaseRow>` instead.
 */
export interface QrCodeConflictDeps {
  /**
   * Look up the case (if any) currently carrying the given QR code.
   *
   * MUST use the `by_qr_code` index for O(log n) performance.  The Convex
   * implementation is:
   *
   *   ctx.db
   *     .query("cases")
   *     .withIndex("by_qr_code", (q) => q.eq("qrCode", qrCode))
   *     .first()
   *
   * Returns `null` when no case carries the QR code.
   */
  findCaseByQrCode(qrCode: string): Promise<QrCodeCaseRow | null>;
}

/**
 * Structured outcome of a duplicate-QR check.
 *
 * The discriminated union forces callers to handle every case explicitly —
 * the TypeScript compiler will flag any branch that forgets the conflict
 * path, which is exactly what we want for an invariant this critical.
 */
export type QrCodeConflictOutcome =
  /**
   * QR code is empty / whitespace-only.  Callers should reject the input
   * (mutations) or surface an input-validation error (queries).
   */
  | {
      kind:   "invalid";
      reason: string;
    }
  /**
   * QR code is not yet associated with any case — safe to write.
   */
  | {
      kind: "available";
    }
  /**
   * QR code is already on the target case.  Callers should treat this as
   * an idempotent no-op (no DB write needed).
   */
  | {
      kind: "mapped_to_this_case";
    }
  /**
   * QR code is associated with a DIFFERENT case.  Callers MUST either
   * reject the operation (default behaviour for write mutations) or
   * surface a flag/warning to the operator (queries powering UI banners).
   */
  | {
      kind:                 "conflict";
      conflictingCaseId:    string;
      conflictingCaseLabel: string;
    };

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Trim and validate that a QR payload is non-empty after whitespace removal.
 *
 * Returns the normalized (trimmed) payload, or `null` when the input is
 * empty / whitespace-only.  Centralized so every write path normalizes
 * identically — preventing `"  abc  "` and `"abc"` from being treated as
 * different QR codes by the index.
 *
 * @param raw  The raw QR code string from the client.
 * @returns    The trimmed string, or `null` when empty after trim.
 */
export function normalizeQrPayload(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Detect whether a QR-to-case write would violate the uniqueness invariant.
 *
 * This is the centralized rule enforced by every mutation that writes
 * `cases.qrCode`.  It returns a structured outcome so callers can decide
 * whether to reject the operation, no-op idempotently, or simply flag the
 * conflict in a query result.
 *
 * Pre-write protocol
 * ──────────────────
 *   1. Call `detectQrCodeConflict(...)` BEFORE issuing `ctx.db.patch`.
 *   2. Branch on `outcome.kind`:
 *        • "invalid"            → throw / return validation error
 *        • "conflict"           → throw / return conflict error
 *        • "mapped_to_this_case" → return idempotent success (no DB write)
 *        • "available"          → proceed with `ctx.db.patch`
 *   3. Refresh `cases.updatedAt` and append an audit event after the patch.
 *
 * @param qrCode      The raw QR payload to check (will be trimmed).
 * @param targetCaseId The case the caller intends to associate the QR with.
 *                    Used to distinguish "already on this case" from "on a
 *                    different case".
 * @param deps        Injected lookup dependency.  Convex code wraps the
 *                    `by_qr_code` index query; tests pass an in-memory map.
 *
 * @returns A discriminated-union `QrCodeConflictOutcome`.
 */
export async function detectQrCodeConflict(
  qrCode:       string,
  targetCaseId: string,
  deps:         QrCodeConflictDeps,
): Promise<QrCodeConflictOutcome> {
  // ── 1. Normalize and reject empty payloads ───────────────────────────────
  const normalized = normalizeQrPayload(qrCode);
  if (normalized === null) {
    return {
      kind:   "invalid",
      reason: "QR code must not be empty.",
    };
  }

  // ── 2. Index lookup — O(log n) via `by_qr_code` ──────────────────────────
  const existing = await deps.findCaseByQrCode(normalized);

  // ── 3. No case carries this QR — safe to associate ───────────────────────
  if (existing === null) {
    return { kind: "available" };
  }

  // ── 4. QR is already on the target case — idempotent no-op ───────────────
  if (existing._id === targetCaseId) {
    return { kind: "mapped_to_this_case" };
  }

  // ── 5. QR belongs to a different case — uniqueness violation ─────────────
  return {
    kind:                 "conflict",
    conflictingCaseId:    existing._id,
    conflictingCaseLabel: existing.label,
  };
}

/**
 * Build a human-readable error message for a "conflict" outcome.
 *
 * Centralized so mutations across `qrCodes.ts` and `cases.ts` produce
 * consistent, parseable error strings.  The exact format is asserted by
 * unit tests so client-side error toasts can rely on it.
 *
 * @param mutationName  Name of the calling mutation (for log/error prefix).
 * @param outcome       The detection outcome with kind === "conflict".
 *
 * @returns A descriptive multi-line error message safe to throw.
 */
export function formatQrCodeConflictMessage(
  mutationName: string,
  outcome:      Extract<QrCodeConflictOutcome, { kind: "conflict" }>,
): string {
  return (
    `${mutationName}: QR code is already mapped to case ` +
    `"${outcome.conflictingCaseLabel}" (ID: ${outcome.conflictingCaseId}). ` +
    `Each QR code may only be associated with one case at a time.`
  );
}

/**
 * Convenience wrapper that throws on "conflict" / "invalid" and returns a
 * boolean indicating whether the caller should perform the DB write.
 *
 *   true  → proceed with `ctx.db.patch`  (kind === "available")
 *   false → idempotent no-op             (kind === "mapped_to_this_case")
 *
 * Mutations that don't need to distinguish "no-op" from "wrote" can use this
 * for a one-liner conflict guard.  Mutations that DO need the distinction
 * (e.g. to set `wasAlreadyMapped: true` in the result) should call
 * `detectQrCodeConflict` directly and switch on the outcome.
 *
 * @param mutationName  Name of the calling mutation (for error messages).
 * @param qrCode        The raw QR payload.
 * @param targetCaseId  The target case ID.
 * @param deps          Lookup dependency.
 *
 * @throws Error("…non-empty…") when the QR code is empty.
 * @throws Error("…already mapped…") when the QR code is on another case.
 */
export async function assertQrCodeAvailable(
  mutationName: string,
  qrCode:       string,
  targetCaseId: string,
  deps:         QrCodeConflictDeps,
): Promise<boolean> {
  const outcome = await detectQrCodeConflict(qrCode, targetCaseId, deps);

  switch (outcome.kind) {
    case "invalid":
      throw new Error(`${mutationName}: qrCode must be a non-empty string.`);
    case "conflict":
      throw new Error(formatQrCodeConflictMessage(mutationName, outcome));
    case "mapped_to_this_case":
      return false; // idempotent — caller should skip the DB write
    case "available":
      return true;  // caller should proceed with the patch
  }
}
