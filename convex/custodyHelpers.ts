/**
 * convex/custodyHelpers.ts
 *
 * Pure, Convex-runtime-free helper functions for the custody records module.
 *
 * These functions are extracted from convex/custody.ts so they can be
 * imported and unit-tested without a live Convex environment.  The Convex
 * query functions in custody.ts import from this module; unit tests also
 * import directly from here.
 *
 * No imports from convex/server, convex/values, or _generated/* — this file
 * must remain safe to import in any JavaScript environment (Node test env,
 * browser, or Convex runtime).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A normalised projection of a single custody handoff record.
 * Returned by all query functions in convex/custody.ts.
 */
export interface CustodyRecord {
  /** Convex document ID of the custody record row. */
  _id: string;
  /** Convex creation timestamp (epoch ms). */
  _creationTime: number;
  /** The case this handoff belongs to. */
  caseId: string;
  /** Kinde user ID of the person relinquishing custody. */
  fromUserId: string;
  /** Display name of the person relinquishing custody. */
  fromUserName: string;
  /** Kinde user ID of the person receiving custody. */
  toUserId: string;
  /** Display name of the person receiving custody. */
  toUserName: string;
  /** Epoch ms timestamp when the transfer was recorded. */
  transferredAt: number;
  /** Optional technician notes entered at transfer time. */
  notes?: string;
  /**
   * Optional Convex file storage ID for a signature captured in the SCAN app.
   * Resolve to a download URL via Convex's `ctx.storage.getUrl()` server-side
   * or via the `useStorageURL` hook client-side.
   */
  signatureStorageId?: string;
}

/**
 * Fleet-wide summary of custody transfer activity for a given period.
 * Used by the INVENTORY dashboard overview panel.
 */
export interface CustodyTransferSummary {
  /** Total number of handoffs recorded across the fleet in the requested range. */
  totalTransfers: number;
  /**
   * Most active transfer recipient during the period.
   * null when no transfers exist.
   */
  mostActiveTo: { userId: string; userName: string; count: number } | null;
  /**
   * Epoch ms of the earliest transfer in the result set.
   * null when no transfers exist.
   */
  earliestTransferAt: number | null;
  /**
   * Epoch ms of the most recent transfer in the result set.
   * null when no transfers exist.
   */
  latestTransferAt: number | null;
}

/**
 * Summary of a user's custodian identity — which cases they currently hold
 * and their full transfer history.
 *
 * "Currently holding" means the user is the most recent `toUserId` for a given
 * case, i.e., the case has not been handed off to anyone else since this user
 * received it.
 */
export interface CustodianIdentitySummary {
  /** Kinde user ID this summary describes. */
  userId: string;
  /** All distinct cases currently held by this user (they are the latest toUserId). */
  currentCaseIds: string[];
  /**
   * Number of cases currently held by this user.
   * Derived from currentCaseIds.length for convenience.
   */
  currentCaseCount: number;
  /**
   * Total number of times this user has received a custody transfer
   * (sum of all records where toUserId = userId, regardless of current holder).
   */
  totalReceived: number;
  /**
   * Total number of times this user has transferred custody to someone else
   * (sum of all records where fromUserId = userId).
   */
  totalTransferred: number;
}

// ─── Raw row type ─────────────────────────────────────────────────────────────

/**
 * Minimal shape expected from a raw custodyRecords DB row.
 * The real Convex document carries additional internal fields; this interface
 * captures only what the helpers need — keeping them testable without Convex.
 */
export interface RawCustodyRow {
  _id: { toString(): string };
  _creationTime: number;
  caseId: { toString(): string };
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  transferredAt: number;
  notes?: string;
  signatureStorageId?: string;
}

// ─── Pure helper functions ────────────────────────────────────────────────────

/**
 * Project a raw custodyRecords DB row to a plain, serializable CustodyRecord.
 *
 * Converts Convex ID objects (`{ toString(): string }`) to plain strings so
 * the projected record is safe to return to the client without runtime Convex
 * types leaking across the API boundary.
 *
 * Pure function — no DB calls.  Exported for unit testing.
 *
 * @example
 * const records = rawRows.map(projectCustodyRecord);
 */
export function projectCustodyRecord(row: RawCustodyRow): CustodyRecord {
  return {
    _id:              row._id.toString(),
    _creationTime:    row._creationTime,
    caseId:           row.caseId.toString(),
    fromUserId:       row.fromUserId,
    fromUserName:     row.fromUserName,
    toUserId:         row.toUserId,
    toUserName:       row.toUserName,
    transferredAt:    row.transferredAt,
    notes:            row.notes,
    signatureStorageId: row.signatureStorageId,
  };
}

/**
 * Sort an array of custody records descending by `transferredAt` (most recent
 * handoff first).  Returns a new array — does not mutate the input.
 *
 * This is the default sort order for all dashboard UX lists where the user
 * wants to see the most recent activity at the top.
 *
 * Pure function — no DB calls.  Exported for unit testing.
 */
export function sortRecordsDescending(records: CustodyRecord[]): CustodyRecord[] {
  return [...records].sort((a, b) => b.transferredAt - a.transferredAt);
}

/**
 * Sort an array of custody records ascending by `transferredAt` (oldest
 * transfer first, newest last).  Returns a new array — does not mutate input.
 *
 * Used for audit-trail views (getCustodyChain) where chronological order is
 * the natural reading direction.
 *
 * Pure function — no DB calls.  Exported for unit testing.
 */
export function sortRecordsAscending(records: CustodyRecord[]): CustodyRecord[] {
  return [...records].sort((a, b) => a.transferredAt - b.transferredAt);
}

/**
 * Pick the single most recent custody record from an array of records for one
 * case.  Returns `null` when the array is empty.
 *
 * More efficient than sorting the full array and taking index 0 when the caller
 * only needs the latest record — O(n) instead of O(n log n).
 *
 * Assumes all records belong to the same case (i.e., the array was already
 * filtered by caseId before calling this helper).
 *
 * Pure function — no DB calls.  Exported for unit testing.
 */
export function pickLatestRecord(
  records: CustodyRecord[],
): CustodyRecord | null {
  if (records.length === 0) return null;

  let latest = records[0];
  for (const record of records) {
    if (record.transferredAt > latest.transferredAt) {
      latest = record;
    }
  }
  return latest;
}

/**
 * Apply an optional date-range filter to an array of custody records.
 *
 * `since` — include only records with `transferredAt >= since` (epoch ms).
 * `until` — include only records with `transferredAt <= until` (epoch ms).
 *
 * Pass both to get a closed [since, until] time window.
 * Pass neither to get all records unchanged (identity).
 *
 * Returns a new array — does not mutate the input.
 *
 * Pure function — no DB calls.  Exported for unit testing and used by both
 * `listAllCustodyTransfers` and `getCustodyTransferSummary`.
 */
export function applyDateRangeFilter(
  records: CustodyRecord[],
  since?: number,
  until?: number,
): CustodyRecord[] {
  if (since === undefined && until === undefined) return records;
  return records.filter((r) => {
    if (since !== undefined && r.transferredAt < since) return false;
    if (until !== undefined && r.transferredAt > until) return false;
    return true;
  });
}

/**
 * Compute aggregate transfer statistics from a (pre-filtered) array of
 * custody records.
 *
 * Returns:
 *   - totalTransfers    — count of records in the input array
 *   - mostActiveTo      — the toUserId/toUserName entry with the highest count
 *   - earliestTransferAt — minimum transferredAt in the set, or null if empty
 *   - latestTransferAt  — maximum transferredAt in the set, or null if empty
 *
 * Returns all-null/zero values when the input array is empty.
 *
 * Pure function — no DB calls.  Exported for unit testing and shared between
 * `getCustodyTransferSummary` and related analytics queries.
 */
export function computeTransferSummary(
  records: CustodyRecord[],
): CustodyTransferSummary {
  if (records.length === 0) {
    return {
      totalTransfers:    0,
      mostActiveTo:      null,
      earliestTransferAt: null,
      latestTransferAt:  null,
    };
  }

  const countByRecipient = new Map<
    string,
    { userId: string; userName: string; count: number }
  >();

  let earliest = records[0].transferredAt;
  let latest   = records[0].transferredAt;

  for (const record of records) {
    if (record.transferredAt < earliest) earliest = record.transferredAt;
    if (record.transferredAt > latest)   latest   = record.transferredAt;

    const existing = countByRecipient.get(record.toUserId);
    if (existing) {
      existing.count++;
    } else {
      countByRecipient.set(record.toUserId, {
        userId:   record.toUserId,
        userName: record.toUserName,
        count:    1,
      });
    }
  }

  let mostActiveTo: { userId: string; userName: string; count: number } | null =
    null;
  for (const entry of countByRecipient.values()) {
    if (!mostActiveTo || entry.count > mostActiveTo.count) {
      mostActiveTo = entry;
    }
  }

  return {
    totalTransfers:    records.length,
    mostActiveTo,
    earliestTransferAt: earliest,
    latestTransferAt:   latest,
  };
}

/**
 * Compute the custodian identity summary for a single user from a set of
 * custody records.
 *
 * Determines which cases the user currently holds by grouping all records by
 * `caseId` and checking whether the user is the `toUserId` on the record with
 * the highest `transferredAt` for that case.
 *
 * This is a pure in-memory computation — no DB calls.  The server-side
 * `getCustodianIdentitySummary` query feeds pre-fetched records to this helper.
 *
 * @param userId         Kinde user ID of the custodian to describe.
 * @param allUserRecords All custody records involving this user (as either
 *                       `fromUserId` or `toUserId`).  Callers should union the
 *                       results of the `by_to_user` and `by_from_user` index
 *                       scans before passing them here.
 *
 * Pure function — no DB calls.  Exported for unit testing.
 */
export function computeCustodianIdentitySummary(
  userId: string,
  allUserRecords: CustodyRecord[],
): CustodianIdentitySummary {
  // Group all records by caseId to determine the latest record per case.
  const byCaseId = new Map<string, CustodyRecord[]>();
  for (const record of allUserRecords) {
    const group = byCaseId.get(record.caseId) ?? [];
    group.push(record);
    byCaseId.set(record.caseId, group);
  }

  const currentCaseIds: string[] = [];

  // For each case this user has been involved with, check if they are the
  // current holder (their `toUserId` record is the latest one).
  for (const [caseId, records] of byCaseId.entries()) {
    const latest = pickLatestRecord(records);
    if (latest && latest.toUserId === userId) {
      currentCaseIds.push(caseId);
    }
  }

  const totalReceived   = allUserRecords.filter((r) => r.toUserId   === userId).length;
  const totalTransferred = allUserRecords.filter((r) => r.fromUserId === userId).length;

  return {
    userId,
    currentCaseIds,
    currentCaseCount: currentCaseIds.length,
    totalReceived,
    totalTransferred,
  };
}

/**
 * Filter an array of custody records to those where the given user was
 * involved as either the outgoing holder (`fromUserId`) or the incoming
 * holder (`toUserId`).
 *
 * Used by `getCustodyRecordsByParticipant` to merge the results of two index
 * scans into a single deduplicated, unified participant view.
 *
 * Returns a new array — does not mutate the input.
 *
 * Pure function — no DB calls.  Exported for unit testing.
 */
export function filterByParticipant(
  records: CustodyRecord[],
  userId: string,
): CustodyRecord[] {
  return records.filter(
    (r) => r.fromUserId === userId || r.toUserId === userId,
  );
}
