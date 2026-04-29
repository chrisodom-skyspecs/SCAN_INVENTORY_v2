/**
 * @vitest-environment node
 *
 * Convex Endpoint Latency Benchmark
 * ──────────────────────────────────
 * Asserts that key Convex query endpoint logic executes with p50 < 200ms
 * against a seed-scale in-memory dataset (50 cases, 6 missions, 15 shipments,
 * 42 inspections, 60 custody records — mirrors convex/seed.ts counts).
 *
 * Endpoints benchmarked:
 *   1. Case list      — listCases handler logic (full-scan + in-memory filter)
 *   2. Case detail    — getCaseById handler logic (O(1) primary-key lookup)
 *   3. Map mode M1    — assembleM1 (fleet overview, all cases)
 *   4. Map mode M2    — assembleM2 (mission-grouped cases)
 *   5. Map mode M3    — assembleM3 (field mode + inspection progress)
 *   6. Map mode M4    — assembleM4 (logistics / in-transit shipments)
 *   7. Map mode M5    — assembleM5 (mission control, feature-enabled)
 *   8. listForMap     — listForMap handler logic (custody join + projection)
 *
 * Architecture
 * ────────────
 * The Convex query handlers (convex/cases.ts, convex/mapData.ts) use `query()`
 * wrappers that are not directly callable in a unit test context.  Instead we:
 *
 *   a) Call the pure assembler functions from convex/maps.ts directly —
 *      these are exported and require no Convex runtime.
 *
 *   b) For handler-level benchmarks (case list, case detail, listForMap),
 *      we replicate the handler body with an in-memory mock ctx that
 *      resolves auth and DB calls synchronously (via Promise.resolve), matching
 *      the near-zero I/O overhead of Convex's in-region query execution.
 *
 * Why synchronous mock DB calls are appropriate
 * ─────────────────────────────────────────────
 * The 200ms p50 budget is for the end-to-end server-side execution of a Convex
 * query: DB fetch time + in-memory assembly.  In a live Convex deployment,
 * DB fetches for small-to-medium tables (≤ 10k rows) complete in <5ms due to
 * Convex's in-region storage layer.  By using near-zero-latency Promise.resolve
 * mocks we isolate and measure the assembly/business-logic overhead — which is
 * the dominant CPU-bound cost that could realistically exceed 200ms for large
 * datasets.  The goal: verify that 50-case seed-scale data processing stays well
 * within the p50 budget.
 *
 * Run:
 *   npx vitest run src/lib/__tests__/convex-endpoint-latency.bench.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  assembleM1,
  assembleM2,
  assembleM3,
  assembleM4,
  assembleM5,
  type CustodySnapshot,
} from "../../../convex/maps";

// ─── Seed dataset constants (mirrors convex/seed.ts scale) ───────────────────

const SEED_CASE_COUNT        = 50;
const SEED_MISSION_COUNT     = 6;
const SEED_SHIPMENT_COUNT    = 15;
const SEED_INSPECTION_COUNT  = 42;
const SEED_CUSTODY_COUNT     = 60;
const BENCHMARK_ITERATIONS   = 101;
const P50_BUDGET_MS          = 200;

// ─── Status distributions matching seed.ts ───────────────────────────────────

const CASE_STATUSES = [
  "hangar",
  "assembled",
  "transit_out",
  "deployed",
  "flagged",
  "transit_in",
  "received",
  "archived",
] as const;

const MISSION_STATUSES = ["planning", "active", "completed", "cancelled"] as const;
const INSPECTION_STATUSES = ["pending", "in_progress", "completed", "flagged"] as const;
const SHIPMENT_STATUSES = [
  "label_created",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "exception",
] as const;

// ─── Seed dataset builders ────────────────────────────────────────────────────

/** Geographic centers for wind farm sites (from seed.ts SITES) */
const SITE_COORDS = [
  { lat: 43.234,  lng: -86.250 },  // Lake Michigan Offshore
  { lat: 40.484,  lng: -88.993 },  // Illinois Prairie
  { lat: 41.499,  lng: -81.694 },  // Lake Erie Basin
  { lat: 40.486,  lng: -86.133 },  // Indiana Hoosier
  { lat: 46.543,  lng: -87.395 },  // Upper Michigan
  { lat: 41.448,  lng: -82.707 },  // Ohio Emergency
];

/**
 * Build a seed-scale array of mock case documents.
 * Matches the shape of Doc<"cases"> without importing Convex internals.
 */
function buildSeedCases(count = SEED_CASE_COUNT): Record<string, unknown>[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const idx = i + 1;
    const status = CASE_STATUSES[i % CASE_STATUSES.length];
    const siteIdx = i % SITE_COORDS.length;
    const site = SITE_COORDS[siteIdx];
    // ~80% of cases have coordinates (matches seed distribution)
    const hasCoords = idx % 5 !== 0;
    // ~70% of cases have mission assignment
    const hasMission = idx % 10 !== 0 && idx % 7 !== 0;
    // ~60% of transit/deployed/flagged cases have tracking data
    const hasTracking = (status === "transit_out" || status === "transit_in") && idx % 3 !== 0;

    return {
      _id:            `cases_seed_${String(idx).padStart(4, "0")}`,
      _creationTime:  now - (count - i) * 3600_000,
      label:          `CASE-${String(idx).padStart(4, "0")}`,
      qrCode:         `case:cases_seed_${String(idx).padStart(4, "0")}:uid:seed-uuid-${idx}`,
      qrCodeSource:   "generated",
      status,
      templateId:     `templates_seed_${(i % 5) + 1}`,
      missionId:      hasMission ? `missions_seed_${(i % SEED_MISSION_COUNT) + 1}` : undefined,
      lat:            hasCoords ? site.lat + (i % 10) * 0.04 : undefined,
      lng:            hasCoords ? site.lng + (i % 10) * 0.04 : undefined,
      locationName:   hasCoords ? `Site ${siteIdx + 1} — Bay ${(i % 8) + 1}` : undefined,
      assigneeId:     idx % 4 !== 0 ? `seed_usr_tech_${idx % 8}` : undefined,
      assigneeName:   idx % 4 !== 0 ? `Technician ${(idx % 8) + 1}` : undefined,
      trackingNumber: hasTracking ? `79464${String(idx * 7).padStart(8, "0")}` : undefined,
      carrier:        hasTracking ? "FedEx" : undefined,
      shippedAt:      hasTracking ? now - idx * 86400_000 : undefined,
      destinationName: hasTracking ? "SkySpecs HQ — Ann Arbor, MI" : undefined,
      destinationLat:  hasTracking ? 42.2808 : undefined,
      destinationLng:  hasTracking ? -83.7430 : undefined,
      notes:           idx % 5 === 0 ? "Seed note for case " + idx : undefined,
      createdAt:       now - (count - i + 10) * 3600_000,
      updatedAt:       now - (count - i) * 3600_000,
    };
  });
}

/**
 * Build a seed-scale array of mock mission documents.
 * Matches the shape of Doc<"missions"> without importing Convex internals.
 */
function buildSeedMissions(count = SEED_MISSION_COUNT): Record<string, unknown>[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const idx = i + 1;
    const site = SITE_COORDS[i % SITE_COORDS.length];
    return {
      _id:           `missions_seed_${idx}`,
      _creationTime: now - (count - i + 20) * 3600_000,
      name:          `Mission ${idx} — Wind Farm ${String.fromCharCode(65 + i)}`,
      description:   `Inspection and maintenance mission at site ${idx}`,
      status:        MISSION_STATUSES[i % MISSION_STATUSES.length],
      lat:           site.lat,
      lng:           site.lng,
      locationName:  `Wind Farm Site ${idx}`,
      startDate:     now - (30 - i * 3) * 86400_000,
      endDate:       now + (10 + i * 5) * 86400_000,
      leadId:        `seed_usr_ops_mgr`,
      leadName:      "Morgan Reeves",
      createdAt:     now - (count - i + 20) * 3600_000,
      updatedAt:     now - (count - i + 5) * 3600_000,
    };
  });
}

/**
 * Build a seed-scale array of mock inspection documents.
 * Matches the shape of Doc<"inspections"> without importing Convex internals.
 */
function buildSeedInspections(
  cases: Record<string, unknown>[],
  count = SEED_INSPECTION_COUNT
): Record<string, unknown>[] {
  const now = Date.now();
  // Attach inspections to field-relevant cases (deployed/flagged)
  const fieldCases = cases.filter(
    (c) => c["status"] === "deployed" || c["status"] === "flagged"
  );
  return Array.from({ length: Math.min(count, fieldCases.length) }, (_, i) => {
    const fieldCase = fieldCases[i % fieldCases.length];
    const totalItems = 8 + (i % 7);
    const checkedItems = Math.floor(totalItems * (0.4 + (i % 6) * 0.1));
    const damagedItems = i % 5 === 0 ? 1 : 0;
    const missingItems = i % 7 === 0 ? 1 : 0;
    return {
      _id:           `inspections_seed_${String(i + 1).padStart(4, "0")}`,
      _creationTime: now - (count - i) * 1800_000,
      caseId:        fieldCase["_id"],
      status:        INSPECTION_STATUSES[i % INSPECTION_STATUSES.length],
      technicianId:  `seed_usr_tech_${(i % 5) + 1}`,
      inspectorName: `Technician ${(i % 5) + 1}`,
      startedAt:     now - (count - i) * 1800_000,
      completedAt:   i % 3 === 0 ? now - (count - i) * 900_000 : undefined,
      totalItems,
      checkedItems,
      damagedItems,
      missingItems,
      createdAt:     now - (count - i) * 1800_000,
      updatedAt:     now - (count - i) * 900_000,
    };
  });
}

/**
 * Build a seed-scale array of mock shipment documents.
 * Matches the shape of Doc<"shipments"> without importing Convex internals.
 */
function buildSeedShipments(
  cases: Record<string, unknown>[],
  count = SEED_SHIPMENT_COUNT
): Record<string, unknown>[] {
  const now = Date.now();
  const transitCases = cases.filter(
    (c) => c["status"] === "transit_out" || c["status"] === "transit_in"
  );
  return Array.from({ length: Math.min(count, transitCases.length + 3) }, (_, i) => {
    const transitCase = transitCases[i % Math.max(transitCases.length, 1)];
    const caseId = transitCase?.["_id"] ?? cases[i]?.["_id"] ?? `cases_seed_${i + 1}`;
    const site = SITE_COORDS[i % SITE_COORDS.length];
    return {
      _id:                `shipments_seed_${String(i + 1).padStart(3, "0")}`,
      _creationTime:      now - (count - i) * 86400_000,
      caseId,
      trackingNumber:     `79464482${String(i * 1000 + 3741).padStart(7, "0")}`,
      carrier:            "FedEx",
      status:             SHIPMENT_STATUSES[i % SHIPMENT_STATUSES.length],
      originLat:          site.lat,
      originLng:          site.lng,
      originName:         `Site ${(i % SITE_COORDS.length) + 1}`,
      destinationLat:     42.2808,
      destinationLng:     -83.7430,
      destinationName:    "SkySpecs HQ — Ann Arbor, MI",
      currentLat:         i % 2 === 0 ? site.lat + 0.5 : undefined,
      currentLng:         i % 2 === 0 ? site.lng + 0.5 : undefined,
      estimatedDelivery:  now + (3 + i % 5) * 86400_000,
      shippedAt:          now - (count - i) * 86400_000,
      updatedAt:          now - (count - i) * 3600_000,
    };
  });
}

/**
 * Build a seed-scale custody record array.
 * Used to construct the latestCustodyByCase map for map assemblers.
 */
function buildSeedCustodyRecords(
  cases: Record<string, unknown>[],
  count = SEED_CUSTODY_COUNT
): Array<{ caseId: string; toUserId: string; toUserName: string; fromUserId: string; fromUserName: string; transferredAt: number }> {
  const now = Date.now();
  const users = [
    { id: "seed_usr_tech_alice", name: "Alice Chen" },
    { id: "seed_usr_tech_raj",   name: "Raj Patel"  },
    { id: "seed_usr_tech_dana",  name: "Dana Kim"   },
    { id: "seed_usr_tech_james", name: "James Okafor" },
    { id: "seed_usr_pilot_emma", name: "Emma Lundström" },
    { id: "seed_usr_pilot_marc", name: "Marcus Brown" },
    { id: "seed_usr_logistics",  name: "Sarah Novak" },
    { id: "seed_usr_ops_mgr",    name: "Morgan Reeves" },
  ];
  return Array.from({ length: count }, (_, i) => {
    const caseIdx   = i % cases.length;
    const toUserIdx = i % users.length;
    const fromUserIdx = (i + 1) % users.length;
    return {
      caseId:        cases[caseIdx]["_id"] as string,
      toUserId:      users[toUserIdx].id,
      toUserName:    users[toUserIdx].name,
      fromUserId:    users[fromUserIdx].id,
      fromUserName:  users[fromUserIdx].name,
      transferredAt: now - (count - i) * 3600_000,
    };
  });
}

// ─── Build seed dataset once (module-level — shared across all benchmarks) ────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SEED_CASES = buildSeedCases(SEED_CASE_COUNT) as any[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SEED_MISSIONS = buildSeedMissions(SEED_MISSION_COUNT) as any[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SEED_INSPECTIONS = buildSeedInspections(SEED_CASES, SEED_INSPECTION_COUNT) as any[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SEED_SHIPMENTS = buildSeedShipments(SEED_CASES, SEED_SHIPMENT_COUNT) as any[];
const SEED_CUSTODY_RECORDS = buildSeedCustodyRecords(SEED_CASES, SEED_CUSTODY_COUNT);

/** O(1) case-by-ID map for getCaseById and listForMap benchmarks */
const SEED_CASES_BY_ID = new Map<string, Record<string, unknown>>(
  SEED_CASES.map((c) => [c["_id"] as string, c])
);

/** Latest-custody-per-case map (mirrors what getM1MapData builds at runtime) */
function buildLatestCustodyMap(): Map<string, CustodySnapshot> {
  const map = new Map<string, CustodySnapshot>();
  for (const record of SEED_CUSTODY_RECORDS) {
    const existing = map.get(record.caseId);
    if (!existing || record.transferredAt > existing.transferredAt) {
      map.set(record.caseId, {
        toUserId:      record.toUserId,
        toUserName:    record.toUserName,
        fromUserId:    record.fromUserId,
        fromUserName:  record.fromUserName,
        transferredAt: record.transferredAt,
      });
    }
  }
  return map;
}

/** Latest-inspection-per-case map (mirrors what getM3MapData builds at runtime) */
function buildLatestInspectionMap(): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const ins of SEED_INSPECTIONS) {
    const key  = ins["caseId"] as string;
    const existing = map.get(key);
    if (!existing || (ins["_creationTime"] as number) > (existing["_creationTime"] as number)) {
      map.set(key, ins);
    }
  }
  return map;
}

const SEED_CUSTODY_MAP    = buildLatestCustodyMap();
const SEED_INSPECTION_MAP = buildLatestInspectionMap();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SEED_CASES_BY_ID_FOR_M4 = new Map<string, any>(
  SEED_CASES.map((c) => [c["_id"] as string, c])
);

// ─── Mock Convex auth + db context ───────────────────────────────────────────

/** Mock Kinde identity returned by ctx.auth.getUserIdentity() */
const MOCK_IDENTITY = {
  subject:         "kinde_bench_user_001",
  tokenIdentifier: "kinde_bench_user_001|https://skyspecs.kinde.com",
  issuer:          "https://skyspecs.kinde.com",
  name:            "Bench Test User",
  email:           "bench@skyspecs.com",
  givenName:       "Bench",
  familyName:      "User",
  pictureUrl:      undefined,
};

/**
 * Build a mock ctx for query handler simulations.
 * The db methods resolve asynchronously (Promise.resolve) to model Convex's
 * async query API while keeping I/O overhead near zero.
 *
 * Supports:
 *   ctx.auth.getUserIdentity()   → Promise<MOCK_IDENTITY>
 *   ctx.db.get(id)               → Promise<case | null>
 *   ctx.db.query("cases")
 *     .withIndex("by_updated").order("desc").collect()  → Promise<cases[]>
 *     .withIndex("by_status", fn).collect()             → Promise<filtered[]>
 *     .withIndex("by_mission", fn).collect()            → Promise<filtered[]>
 *   ctx.db.query("custodyRecords").collect()            → Promise<custody[]>
 *   ctx.db.query("inspections").collect()               → Promise<inspections[]>
 *   ctx.db.query("shipments").collect()                 → Promise<shipments[]>
 *   ctx.db.query("missions").withIndex(...).collect()   → Promise<missions[]>
 */
function buildMockCtx() {
  return {
    auth: {
      getUserIdentity: () => Promise.resolve(MOCK_IDENTITY),
    },
    db: {
      get: (id: string) =>
        Promise.resolve(SEED_CASES_BY_ID.get(id) ?? null),

      query: (table: string) => {
        const makeCollectable = (rows: unknown[]) => ({
          collect: () => Promise.resolve(rows),
          first:   () => Promise.resolve(rows[0] ?? null),
          order:   (_dir: string) => ({
            collect: () => Promise.resolve([...rows].reverse()),
          }),
        });

        if (table === "cases") {
          return {
            withIndex: (indexName: string, filterFn?: (q: unknown) => unknown) => {
              // Simulate index filter evaluation for latency testing purposes.
              // We don't execute the actual Convex query filter builder — instead
              // we return all rows for unfiltered indexes and pre-filtered rows
              // for status/mission indexes to avoid Convex SDK dependency.
              if (indexName === "by_status" && filterFn) {
                // Extract eq value from filter function args by running it
                // against a minimal fake query builder.
                let eqStatus: string | undefined;
                let eqMissionId: string | undefined;
                try {
                  filterFn({
                    eq: (_field: string, value: string) => {
                      if (_field === "status")   eqStatus    = value;
                      if (_field === "missionId") eqMissionId = value;
                      return {};
                    },
                  });
                } catch {
                  // filter fn may throw — ignore
                }
                const filtered = eqStatus
                  ? SEED_CASES.filter((c) => c["status"] === eqStatus)
                  : SEED_CASES;
                return makeCollectable(filtered);
              }
              if (indexName === "by_mission" && filterFn) {
                let eqMissionId: string | undefined;
                try {
                  filterFn({
                    eq: (_field: string, value: string) => {
                      if (_field === "missionId") eqMissionId = value;
                      return {};
                    },
                  });
                } catch { /* ignore */ }
                const filtered = eqMissionId
                  ? SEED_CASES.filter((c) => c["missionId"] === eqMissionId)
                  : SEED_CASES;
                return makeCollectable(filtered);
              }
              if (indexName === "by_qr_code" && filterFn) {
                let eqQrCode: string | undefined;
                try {
                  filterFn({
                    eq: (_field: string, value: string) => {
                      if (_field === "qrCode") eqQrCode = value;
                      return {};
                    },
                  });
                } catch { /* ignore */ }
                const filtered = eqQrCode
                  ? SEED_CASES.filter((c) => c["qrCode"] === eqQrCode)
                  : [];
                return makeCollectable(filtered);
              }
              // by_updated or unknown index → return all cases
              return {
                ...makeCollectable(SEED_CASES),
                order: (_dir: string) => makeCollectable([...SEED_CASES]),
              };
            },
            collect: () => Promise.resolve(SEED_CASES),
          };
        }

        if (table === "missions") {
          return {
            withIndex: (_indexName: string, _filterFn?: unknown) => ({
              ...makeCollectable(SEED_MISSIONS),
              order: (_dir: string) => makeCollectable([...SEED_MISSIONS]),
            }),
            collect: () => Promise.resolve(SEED_MISSIONS),
          };
        }

        if (table === "inspections") {
          return {
            withIndex: (_indexName: string, _filterFn?: unknown) =>
              makeCollectable(SEED_INSPECTIONS),
            collect: () => Promise.resolve(SEED_INSPECTIONS),
          };
        }

        if (table === "shipments") {
          return {
            withIndex: (_indexName: string, _filterFn?: unknown) =>
              makeCollectable(SEED_SHIPMENTS),
            collect: () => Promise.resolve(SEED_SHIPMENTS),
          };
        }

        if (table === "custodyRecords") {
          return {
            withIndex: (_indexName: string, _filterFn?: unknown) =>
              makeCollectable(SEED_CUSTODY_RECORDS),
            collect: () => Promise.resolve(SEED_CUSTODY_RECORDS),
          };
        }

        // Unknown table → return empty
        return {
          withIndex: () => makeCollectable([]),
          collect:   () => Promise.resolve([]),
        };
      },
    },
  };
}

// ─── p50 measurement helper ───────────────────────────────────────────────────

/**
 * Run `fn` exactly `iterations` times, collect wall-clock durations in ms,
 * and return the 50th-percentile (median) value.
 */
async function measureP50(
  fn:         () => Promise<unknown>,
  iterations: number = BENCHMARK_ITERATIONS
): Promise<number> {
  const durations: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await fn();
    durations.push(performance.now() - t0);
  }
  durations.sort((a, b) => a - b);
  return durations[Math.floor(iterations / 2)];
}

// ─── Simulated Convex handler implementations ─────────────────────────────────
// These replicate the handler bodies from convex/cases.ts and convex/mapData.ts
// using the mock ctx, testing the full auth-check + DB-query + assembly pipeline.

/**
 * Simulated getCaseById handler.
 * Mirrors: convex/cases.ts getCaseById
 */
async function simulateCaseDetail(ctx: ReturnType<typeof buildMockCtx>, caseId: string) {
  await ctx.auth.getUserIdentity(); // auth check
  return await ctx.db.get(caseId);
}

/**
 * Simulated listCases handler — no filters (full scan).
 * Mirrors: convex/cases.ts listCases (no-filter path)
 */
async function simulateListCases(ctx: ReturnType<typeof buildMockCtx>) {
  await ctx.auth.getUserIdentity(); // auth check
  // Full scan ordered by updatedAt desc (no-filter path)
  const results = await ctx.db
    .query("cases")
    .withIndex("by_updated")
    .order("desc")
    .collect();
  return results;
}

/**
 * Simulated listCases handler — status filter.
 * Mirrors: convex/cases.ts listCases (status-filter path)
 */
async function simulateListCasesFiltered(ctx: ReturnType<typeof buildMockCtx>, status: string) {
  await ctx.auth.getUserIdentity(); // auth check
  return await ctx.db
    .query("cases")
    .withIndex(
      "by_status",
      (q: unknown) =>
        (q as { eq: (f: "status", v: string) => unknown }).eq("status", status)
    )
    .collect();
}

/**
 * Simulated listForMap handler.
 * Mirrors: convex/cases.ts listForMap (no-filter path) — parallel Promise.all
 * for cases + custodyRecords, then O(1) join + projection.
 */
async function simulateListForMap(ctx: ReturnType<typeof buildMockCtx>) {
  await ctx.auth.getUserIdentity(); // auth check

  const [allCases, allCustodyRecords] = await Promise.all([
    ctx.db.query("cases").withIndex("by_updated").order("desc").collect(),
    ctx.db.query("custodyRecords").collect(),
  ]);

  // Build O(1) latest-custody-per-case map (mirrors cases.ts listForMap)
  const latestCustodyByCase = new Map<string, { toUserId: string; toUserName: string; fromUserId: string; fromUserName: string; transferredAt: number }>();
  for (const record of allCustodyRecords as Array<{ caseId: string; toUserId: string; toUserName: string; fromUserId: string; fromUserName: string; transferredAt: number }>) {
    const key = record.caseId;
    const existing = latestCustodyByCase.get(key);
    if (!existing || record.transferredAt > existing.transferredAt) {
      latestCustodyByCase.set(key, record);
    }
  }

  // Project to CaseForMapResult shape
  return (allCases as Array<Record<string, unknown>>).map((c) => {
    const custody = latestCustodyByCase.get(c["_id"] as string);
    return {
      _id:                  c["_id"] as string,
      label:                c["label"] as string,
      status:               c["status"] as string,
      lat:                  c["lat"] as number | undefined,
      lng:                  c["lng"] as number | undefined,
      locationName:         c["locationName"] as string | undefined,
      assigneeId:           c["assigneeId"] as string | undefined,
      assigneeName:         c["assigneeName"] as string | undefined,
      currentCustodianId:   custody?.toUserId   ?? c["assigneeId"] as string | undefined,
      currentCustodianName: custody?.toUserName ?? c["assigneeName"] as string | undefined,
      custodyTransferredAt: custody?.transferredAt,
      missionId:            c["missionId"] as string | undefined,
      trackingNumber:       c["trackingNumber"] as string | undefined,
      carrier:              c["carrier"] as string | undefined,
      shippedAt:            c["shippedAt"] as number | undefined,
      updatedAt:            c["updatedAt"] as number,
      createdAt:            c["createdAt"] as number,
    };
  });
}

// ─── Sanity checks ────────────────────────────────────────────────────────────
// Verify seed data shape and handler correctness before running benchmarks.

describe("Convex Endpoint Latency — seed dataset sanity checks", () => {
  it("seed dataset has expected counts", () => {
    expect(SEED_CASES.length).toBe(SEED_CASE_COUNT);
    expect(SEED_MISSIONS.length).toBe(SEED_MISSION_COUNT);
    expect(SEED_INSPECTIONS.length).toBeLessThanOrEqual(SEED_INSPECTION_COUNT);
    expect(SEED_SHIPMENTS.length).toBeLessThanOrEqual(SEED_SHIPMENT_COUNT);
    expect(SEED_CUSTODY_RECORDS.length).toBe(SEED_CUSTODY_COUNT);
  });

  it("seed cases have valid status values", () => {
    for (const c of SEED_CASES) {
      expect(CASE_STATUSES).toContain(c["status"]);
    }
  });

  it("seed missions have valid status values", () => {
    for (const m of SEED_MISSIONS) {
      expect(MISSION_STATUSES).toContain(m["status"]);
    }
  });

  it("SEED_CASES_BY_ID covers all seed cases", () => {
    expect(SEED_CASES_BY_ID.size).toBe(SEED_CASE_COUNT);
    for (const c of SEED_CASES) {
      expect(SEED_CASES_BY_ID.has(c["_id"] as string)).toBe(true);
    }
  });

  it("custody map covers deployed/transit cases", () => {
    expect(SEED_CUSTODY_MAP.size).toBeGreaterThan(0);
  });

  it("inspection map covers deployed/flagged cases", () => {
    expect(SEED_INSPECTION_MAP.size).toBeGreaterThan(0);
  });

  it("getCaseById mock returns a case for a valid ID", async () => {
    const ctx = buildMockCtx();
    const firstId = SEED_CASES[0]["_id"] as string;
    const result = await simulateCaseDetail(ctx, firstId);
    expect(result).not.toBeNull();
    expect(result?.["_id"]).toBe(firstId);
  });

  it("listCases mock returns all 50 cases", async () => {
    const ctx = buildMockCtx();
    const results = await simulateListCases(ctx);
    expect(results.length).toBe(SEED_CASE_COUNT);
  });

  it("listForMap mock returns all 50 cases with custody state", async () => {
    const ctx = buildMockCtx();
    const results = await simulateListForMap(ctx);
    expect(results.length).toBe(SEED_CASE_COUNT);
    expect(results[0]).toHaveProperty("currentCustodianId");
    expect(results[0]).toHaveProperty("updatedAt");
  });

  it("assembleM1 returns M1Response with correct summary", () => {
    const result = assembleM1(SEED_CASES, null, {}, SEED_CUSTODY_MAP);
    expect(result.mode).toBe("M1");
    expect(result.summary.total).toBe(SEED_CASE_COUNT);
    expect(result.cases.length).toBeGreaterThan(0);
  });

  it("assembleM2 returns M2Response with mission groups", () => {
    const result = assembleM2(SEED_CASES, SEED_MISSIONS, null, {}, SEED_CUSTODY_MAP);
    expect(result.mode).toBe("M2");
    expect(result.summary.totalMissions).toBe(SEED_MISSION_COUNT);
  });

  it("assembleM3 returns M3Response with field cases only", () => {
    const result = assembleM3(SEED_CASES, SEED_INSPECTION_MAP as Map<string, unknown> as Parameters<typeof assembleM3>[1], null, {}, SEED_CUSTODY_MAP);
    expect(result.mode).toBe("M3");
    // All M3 cases must be deployed or flagged
    for (const pin of result.cases) {
      expect(["deployed", "flagged"]).toContain(pin.status);
    }
  });

  it("assembleM4 returns M4Response with shipment pins", () => {
    const result = assembleM4(SEED_SHIPMENTS, SEED_CASES_BY_ID_FOR_M4, null, {});
    expect(result.mode).toBe("M4");
    expect(result.shipments.length).toBeGreaterThan(0);
  });

  it("assembleM5 returns M5Response with feature enabled", () => {
    const result = assembleM5(SEED_CASES, SEED_MISSIONS, true, null);
    expect(result.mode).toBe("M5");
    expect(result.featureEnabled).toBe(true);
    expect(result.clusters.length).toBeGreaterThan(0);
  });
});

// ─── p50 Latency Benchmarks ───────────────────────────────────────────────────

describe(`Convex endpoint p50 latency < ${P50_BUDGET_MS}ms (${BENCHMARK_ITERATIONS} iterations, ${SEED_CASE_COUNT}-case seed dataset)`, () => {
  // ── Case detail (getCaseById) ────────────────────────────────────────────────

  it(`getCaseById: p50 < ${P50_BUDGET_MS}ms — O(1) primary-key lookup`, async () => {
    const ctx    = buildMockCtx();
    const caseId = SEED_CASES[Math.floor(SEED_CASE_COUNT / 2)]["_id"] as string;

    const p50 = await measureP50(async () => {
      await simulateCaseDetail(ctx, caseId);
    });

    console.log(`[latency] getCaseById          p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── Case list (listCases) ────────────────────────────────────────────────────

  it(`listCases (no filter): p50 < ${P50_BUDGET_MS}ms — full scan ${SEED_CASE_COUNT} cases`, async () => {
    const ctx = buildMockCtx();

    const p50 = await measureP50(async () => {
      await simulateListCases(ctx);
    });

    console.log(`[latency] listCases (all)      p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it(`listCases (status=deployed): p50 < ${P50_BUDGET_MS}ms — index scan`, async () => {
    const ctx = buildMockCtx();

    const p50 = await measureP50(async () => {
      await simulateListCasesFiltered(ctx, "deployed");
    });

    console.log(`[latency] listCases (deployed) p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── listForMap ───────────────────────────────────────────────────────────────

  it(`listForMap (no filter): p50 < ${P50_BUDGET_MS}ms — cases+custody join`, async () => {
    const ctx = buildMockCtx();

    const p50 = await measureP50(async () => {
      await simulateListForMap(ctx);
    });

    console.log(`[latency] listForMap           p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── Map mode M1 (assembleM1) ────────────────────────────────────────────────

  it(`assembleM1 (no filter): p50 < ${P50_BUDGET_MS}ms — fleet overview ${SEED_CASE_COUNT} cases`, async () => {
    const p50 = await measureP50(async () => {
      assembleM1(SEED_CASES, null, {}, SEED_CUSTODY_MAP);
    });

    console.log(`[latency] assembleM1 (all)     p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it(`assembleM1 (status filter): p50 < ${P50_BUDGET_MS}ms — fleet overview filtered`, async () => {
    const p50 = await measureP50(async () => {
      assembleM1(
        SEED_CASES,
        null,
        { status: ["deployed", "flagged"] },
        SEED_CUSTODY_MAP
      );
    });

    console.log(`[latency] assembleM1 (filtered) p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it(`assembleM1 (with bounds): p50 < ${P50_BUDGET_MS}ms — viewport-constrained fleet`, async () => {
    const bounds = { swLat: 39.0, swLng: -92.0, neLat: 48.0, neLng: -79.0 };

    const p50 = await measureP50(async () => {
      assembleM1(SEED_CASES, bounds, {}, SEED_CUSTODY_MAP);
    });

    console.log(`[latency] assembleM1 (bounds)  p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── Map mode M2 (assembleM2) ────────────────────────────────────────────────

  it(`assembleM2 (no filter): p50 < ${P50_BUDGET_MS}ms — mission grouping`, async () => {
    const p50 = await measureP50(async () => {
      assembleM2(SEED_CASES, SEED_MISSIONS, null, {}, SEED_CUSTODY_MAP);
    });

    console.log(`[latency] assembleM2 (all)     p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it(`assembleM2 (missionId filter): p50 < ${P50_BUDGET_MS}ms — single mission drill-down`, async () => {
    const missionId = SEED_MISSIONS[0]["_id"] as string;

    const p50 = await measureP50(async () => {
      assembleM2(SEED_CASES, SEED_MISSIONS, null, { missionId }, SEED_CUSTODY_MAP);
    });

    console.log(`[latency] assembleM2 (mission) p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── Map mode M3 (assembleM3) ────────────────────────────────────────────────

  it(`assembleM3 (no filter): p50 < ${P50_BUDGET_MS}ms — field mode with inspection data`, async () => {
    const p50 = await measureP50(async () => {
      assembleM3(
        SEED_CASES,
        SEED_INSPECTION_MAP as unknown as Parameters<typeof assembleM3>[1],
        null,
        {},
        SEED_CUSTODY_MAP
      );
    });

    console.log(`[latency] assembleM3 (all)     p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it(`assembleM3 (hasInspection=true): p50 < ${P50_BUDGET_MS}ms — field mode filtered`, async () => {
    const p50 = await measureP50(async () => {
      assembleM3(
        SEED_CASES,
        SEED_INSPECTION_MAP as unknown as Parameters<typeof assembleM3>[1],
        null,
        { hasInspection: true },
        SEED_CUSTODY_MAP
      );
    });

    console.log(`[latency] assembleM3 (insp)    p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── Map mode M4 (assembleM4) ────────────────────────────────────────────────

  it(`assembleM4 (no filter): p50 < ${P50_BUDGET_MS}ms — logistics / ${SEED_SHIPMENT_COUNT} shipments`, async () => {
    const p50 = await measureP50(async () => {
      assembleM4(SEED_SHIPMENTS, SEED_CASES_BY_ID_FOR_M4, null, {});
    });

    console.log(`[latency] assembleM4 (all)     p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it(`assembleM4 (status filter): p50 < ${P50_BUDGET_MS}ms — logistics in-transit only`, async () => {
    const p50 = await measureP50(async () => {
      assembleM4(
        SEED_SHIPMENTS,
        SEED_CASES_BY_ID_FOR_M4,
        null,
        { status: ["in_transit", "out_for_delivery"] }
      );
    });

    console.log(`[latency] assembleM4 (transit) p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── Map mode M5 (assembleM5) ────────────────────────────────────────────────

  it(`assembleM5 (feature enabled): p50 < ${P50_BUDGET_MS}ms — mission control clusters`, async () => {
    const p50 = await measureP50(async () => {
      assembleM5(SEED_CASES, SEED_MISSIONS, true, null);
    });

    console.log(`[latency] assembleM5 (enabled) p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it(`assembleM5 (feature disabled): p50 < ${P50_BUDGET_MS}ms — disabled flag fast path`, async () => {
    const p50 = await measureP50(async () => {
      assembleM5(SEED_CASES, SEED_MISSIONS, false, null);
    });

    console.log(`[latency] assembleM5 (disabled) p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it(`assembleM5 (with bounds): p50 < ${P50_BUDGET_MS}ms — mission control viewport-constrained`, async () => {
    const bounds = { swLat: 39.0, swLng: -92.0, neLat: 48.0, neLng: -79.0 };

    const p50 = await measureP50(async () => {
      assembleM5(SEED_CASES, SEED_MISSIONS, true, bounds);
    });

    console.log(`[latency] assembleM5 (bounds)  p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── Combined: all map modes in sequence ────────────────────────────────────

  it(`all map modes combined: p50 < ${P50_BUDGET_MS}ms — full M1+M2+M3+M4+M5 assembly pipeline`, async () => {
    const p50 = await measureP50(async () => {
      assembleM1(SEED_CASES, null, {}, SEED_CUSTODY_MAP);
      assembleM2(SEED_CASES, SEED_MISSIONS, null, {}, SEED_CUSTODY_MAP);
      assembleM3(
        SEED_CASES,
        SEED_INSPECTION_MAP as unknown as Parameters<typeof assembleM3>[1],
        null,
        {},
        SEED_CUSTODY_MAP
      );
      assembleM4(SEED_SHIPMENTS, SEED_CASES_BY_ID_FOR_M4, null, {});
      assembleM5(SEED_CASES, SEED_MISSIONS, true, null);
    });

    console.log(`[latency] all M1-M5 combined   p50 = ${p50.toFixed(2)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });
});
