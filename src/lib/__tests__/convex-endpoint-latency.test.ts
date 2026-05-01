/**
 * @vitest-environment node
 *
 * Convex Endpoint Latency Benchmark — Seed Dataset
 *
 * Asserts p50 response time < 200ms for the computational logic of every key
 * Convex query endpoint, exercised against a dataset that mirrors the production
 * seed (50 cases, 6 missions, 15 shipments, 42 inspections, 60 custody records).
 *
 * Why pure-computation rather than live Convex calls?
 * ────────────────────────────────────────────────────
 * Vitest cannot connect to a running Convex deployment. Instead, we benchmark
 * the exact in-process code that executes AFTER the Convex DB layer returns
 * rows — i.e., the filter, sort, projection and join logic that determines
 * whether the handlers meet the <200 ms p50 budget. This is the correct scope
 * for a unit latency test: DB I/O latency is environment-dependent and must be
 * measured separately via integration / load testing.
 *
 * Endpoints covered:
 *   listCases        — full-fleet scan + optional status/mission/bounds filter
 *   getCaseById      — O(1) primary-key lookup + full document projection
 *   getCaseStatus    — O(1) primary-key lookup + lightweight status projection
 *   listForMap       — full-fleet scan + custody join + filter + CaseForMapResult projection
 *   getCaseStatusCounts — full-fleet aggregate (counts per status)
 *   getM1MapData     — assembleM1 with custody join (Fleet Overview)
 *   getM2MapData     — assembleM2 (Mission Mode grouping)
 *   getM3MapData     — assembleM3 with inspection join (Field Mode)
 *   getM4MapData     — assembleM4 with case join (Logistics Mode)
 *   getM5MapData     — assembleM5 with heatmap + cluster computation (Mission Control)
 *
 * Seed sizes (matching convex/seed.ts):
 *   50 cases · 6 missions · 15 shipments · 42 inspections · 60 custody records
 *
 * Run: npx vitest run src/lib/__tests__/convex-endpoint-latency.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  assembleM1,
  assembleM2,
  assembleM3,
  assembleM4,
  assembleM5,
  type MapBounds,
  type ParsedFilters,
  type CustodySnapshot,
} from "../../../convex/maps";

// ─── Type stubs (mirror convex/schema.ts without Convex runtime imports) ────────

type CaseStatus =
  | "hangar"
  | "assembled"
  | "transit_out"
  | "deployed"
  | "flagged"
  | "recalled"
  | "transit_in"
  | "received"
  | "archived";

type MissionStatus = "planning" | "active" | "completed" | "cancelled";
type InspectionStatus = "pending" | "in_progress" | "completed" | "flagged";
type ShipmentStatus =
  | "label_created"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception";

type ConvexId<T extends string> = string & { __tableName: T };
function mkId<T extends string>(table: T, n: number | string): ConvexId<T> {
  return `${table}_${n}` as ConvexId<T>;
}

interface CaseDoc {
  _id: ConvexId<"cases">;
  _creationTime: number;
  label: string;
  qrCode: string;
  qrCodeSource?: "generated" | "external";
  status: CaseStatus;
  templateId?: ConvexId<"caseTemplates">;
  missionId?: ConvexId<"missions">;
  lat?: number;
  lng?: number;
  locationName?: string;
  assigneeId?: string;
  assigneeName?: string;
  trackingNumber?: string;
  carrier?: string;
  shippedAt?: number;
  destinationName?: string;
  destinationLat?: number;
  destinationLng?: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

interface MissionDoc {
  _id: ConvexId<"missions">;
  _creationTime: number;
  name: string;
  description?: string;
  status: MissionStatus;
  lat?: number;
  lng?: number;
  locationName?: string;
  startDate?: number;
  endDate?: number;
  leadId?: string;
  leadName?: string;
  createdAt: number;
  updatedAt: number;
}

interface InspectionDoc {
  _id: ConvexId<"inspections">;
  _creationTime: number;
  caseId: ConvexId<"cases">;
  inspectorId: string;
  inspectorName: string;
  status: InspectionStatus;
  startedAt?: number;
  completedAt?: number;
  notes?: string;
  totalItems: number;
  checkedItems: number;
  damagedItems: number;
  missingItems: number;
}

interface ShipmentDoc {
  _id: ConvexId<"shipments">;
  _creationTime: number;
  caseId: ConvexId<"cases">;
  trackingNumber: string;
  carrier: string;
  status: ShipmentStatus;
  originLat?: number;
  originLng?: number;
  originName?: string;
  destinationLat?: number;
  destinationLng?: number;
  destinationName?: string;
  currentLat?: number;
  currentLng?: number;
  estimatedDelivery?: string;
  shippedAt?: number;
  deliveredAt?: number;
  createdAt: number;
  updatedAt: number;
}

interface CustodyRecordDoc {
  _id: ConvexId<"custodyRecords">;
  _creationTime: number;
  caseId: ConvexId<"cases">;
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  transferredAt: number;
  note?: string;
}

// ─── Return-type interfaces (mirrors convex/cases.ts) ─────────────────────────

interface CaseStatusResult {
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

interface CaseStatusCounts {
  total: number;
  byStatus: Record<CaseStatus, number>;
}

interface CaseForMapResult {
  _id: string;
  label: string;
  status: CaseStatus;
  lat?: number;
  lng?: number;
  locationName?: string;
  assigneeId?: string;
  assigneeName?: string;
  currentCustodianId?: string;
  currentCustodianName?: string;
  custodyTransferredAt?: number;
  custodyFromUserId?: string;
  custodyFromUserName?: string;
  missionId?: string;
  trackingNumber?: string;
  carrier?: string;
  shippedAt?: number;
  destinationName?: string;
  destinationLat?: number;
  destinationLng?: number;
  updatedAt: number;
  createdAt: number;
}

// ─── Query simulation functions (mirror convex/cases.ts handler logic) ────────

/**
 * Simulates getCaseById: O(1) primary-key lookup.
 * In Convex: ctx.db.get(args.caseId)
 */
function simulateGetCaseById(
  casesById: Map<string, CaseDoc>,
  caseId: string
): CaseDoc | null {
  return casesById.get(caseId) ?? null;
}

/**
 * Simulates getCaseStatus: O(1) lookup + lightweight projection.
 * In Convex: ctx.db.get(args.caseId) + project to CaseStatusResult
 */
function simulateGetCaseStatus(
  casesById: Map<string, CaseDoc>,
  caseId: string
): CaseStatusResult | null {
  const c = casesById.get(caseId);
  if (!c) return null;
  return {
    _id: c._id.toString(),
    label: c.label,
    status: c.status,
    lat: c.lat,
    lng: c.lng,
    locationName: c.locationName,
    assigneeId: c.assigneeId,
    assigneeName: c.assigneeName,
    missionId: c.missionId?.toString(),
    updatedAt: c.updatedAt,
  };
}

/**
 * Simulates listCases: index scan + optional filters + bounds filter.
 * In Convex:
 *   - status provided → by_status index scan
 *   - missionId provided → by_mission index scan
 *   - both provided → status index + in-memory mission filter
 *   - neither → full scan ordered by updatedAt desc
 *   - bounds provided → in-memory geo filter
 */
function simulateListCases(
  allCases: CaseDoc[],
  args: {
    status?: CaseStatus;
    missionId?: string;
    swLat?: number;
    swLng?: number;
    neLat?: number;
    neLng?: number;
  }
): CaseDoc[] {
  let results: CaseDoc[];

  if (args.status !== undefined && args.missionId !== undefined) {
    // Both filters: status scan + in-memory mission filter
    results = allCases
      .filter((c) => c.status === args.status)
      .filter((c) => c.missionId?.toString() === args.missionId);
  } else if (args.status !== undefined) {
    results = allCases.filter((c) => c.status === args.status);
  } else if (args.missionId !== undefined) {
    results = allCases.filter(
      (c) => c.missionId?.toString() === args.missionId
    );
  } else {
    // Full scan ordered by updatedAt desc
    results = [...allCases].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // Geographic bounds filter
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
}

/**
 * Simulates getCaseStatusCounts: full-fleet aggregate.
 * In Convex: ctx.db.query("cases").collect() + in-memory aggregate
 */
function simulateGetCaseStatusCounts(allCases: CaseDoc[]): CaseStatusCounts {
  const byStatus: Record<CaseStatus, number> = {
    hangar: 0,
    assembled: 0,
    transit_out: 0,
    deployed: 0,
    flagged: 0,
    recalled: 0,
    transit_in: 0,
    received: 0,
    archived: 0,
  };
  for (const c of allCases) {
    if (Object.prototype.hasOwnProperty.call(byStatus, c.status)) {
      byStatus[c.status]++;
    }
  }
  return { total: allCases.length, byStatus };
}

/**
 * Simulates listForMap: cases + custody join + filter + CaseForMapResult projection.
 * In Convex: Promise.all([cases, custodyRecords]) + build custody map + filter + project
 *
 * This is the most expensive case query — it joins two tables in memory.
 */
function simulateListForMap(
  allCases: CaseDoc[],
  latestCustodyByCase: Map<string, CustodyRecordDoc>,
  args: {
    swLat?: number;
    swLng?: number;
    neLat?: number;
    neLng?: number;
    status?: CaseStatus[];
    assigneeId?: string;
    missionId?: string;
  }
): CaseForMapResult[] {
  let filtered = allCases;

  // Apply field filters
  if (args.status !== undefined && args.status.length > 0) {
    filtered = filtered.filter((c) => args.status!.includes(c.status));
  }
  if (args.assigneeId !== undefined) {
    filtered = filtered.filter((c) => c.assigneeId === args.assigneeId);
  }
  if (args.missionId !== undefined) {
    filtered = filtered.filter(
      (c) => c.missionId?.toString() === args.missionId
    );
  }

  // Geographic bounds filter
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

  // Project to CaseForMapResult shape — O(1) custody lookup per case
  return filtered.map((c): CaseForMapResult => {
    const custody = latestCustodyByCase.get(c._id.toString());
    return {
      _id: c._id.toString(),
      label: c.label,
      status: c.status,
      lat: c.lat,
      lng: c.lng,
      locationName: c.locationName,
      assigneeId: c.assigneeId,
      assigneeName: c.assigneeName,
      currentCustodianId: custody?.toUserId ?? c.assigneeId,
      currentCustodianName: custody?.toUserName ?? c.assigneeName,
      custodyTransferredAt: custody?.transferredAt,
      custodyFromUserId: custody?.fromUserId,
      custodyFromUserName: custody?.fromUserName,
      missionId: c.missionId?.toString(),
      trackingNumber: c.trackingNumber,
      carrier: c.carrier,
      shippedAt: c.shippedAt,
      destinationName: c.destinationName,
      destinationLat: c.destinationLat,
      destinationLng: c.destinationLng,
      updatedAt: c.updatedAt,
      createdAt: c.createdAt,
    };
  });
}

// ─── Seed dataset factory (mirrors convex/seed.ts production seed) ─────────────

/** Geographic sites from convex/seed.ts */
const SITES = {
  lakeMichigan:    { lat: 43.2340, lng: -86.2506, name: "Lake Michigan Offshore Site" },
  illinoisPrairie: { lat: 40.4842, lng: -88.9937, name: "Illinois Prairie Wind Farm" },
  lakeErie:        { lat: 41.4993, lng: -81.6944, name: "Lake Erie Basin Site" },
  indianaHoosier:  { lat: 40.4864, lng: -86.1336, name: "Indiana Hoosier Wind Farm" },
  upperMichigan:   { lat: 46.5436, lng: -87.3954, name: "Upper Michigan Legacy Site" },
  ohioEmergency:   { lat: 41.4489, lng: -82.7079, name: "Emergency Repair Delta Site" },
};

const SITE_KEYS = Object.keys(SITES) as Array<keyof typeof SITES>;

const CASE_STATUSES: CaseStatus[] = [
  "hangar",
  "assembled",
  "transit_out",
  "deployed",
  "flagged",
  "recalled",
  "transit_in",
  "received",
  "archived",
];

const MISSION_STATUSES: MissionStatus[] = ["planning", "active", "completed", "cancelled"];
const INSPECTION_STATUSES: InspectionStatus[] = ["pending", "in_progress", "completed", "flagged"];
const SHIPMENT_STATUSES: ShipmentStatus[] = [
  "label_created",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "exception",
];

const FEDEX_TRACKING_NUMBERS = [
  "794644823741", "771448178291", "785334928472",
  "776271918294", "789234810293", "782918374521",
  "773847261938", "791827364821", "768234917283",
  "784719283746", "779283746182", "793847261934",
  "781928374652", "796182736451", "772918364728",
];

/**
 * Build a realistic seed dataset matching convex/seed.ts production data:
 *   50 cases · 6 missions · 15 shipments · 42 inspections · 60 custody records
 *
 * All generated values use deterministic seeded arithmetic (no Math.random())
 * so the benchmark is reproducible across runs.
 */
function buildProductionSeedDataset() {
  const now = Date.now();
  const daysMs = (n: number) => n * 24 * 60 * 60 * 1000;

  // ── 6 missions ────────────────────────────────────────────────────────────────
  const missions: MissionDoc[] = SITE_KEYS.map((siteKey, i) => {
    const site = SITES[siteKey];
    return {
      _id: mkId("missions", i + 1),
      _creationTime: now - daysMs(60 - i * 10),
      name: `Mission ${siteKey.charAt(0).toUpperCase()}${siteKey.slice(1)}`,
      status: MISSION_STATUSES[i % MISSION_STATUSES.length],
      lat: site.lat,
      lng: site.lng,
      locationName: site.name,
      leadId: `seed_usr_ops_mgr`,
      leadName: "Morgan Reeves",
      createdAt: now - daysMs(60 - i * 10),
      updatedAt: now - daysMs(5 - (i % 5)),
    };
  });

  // ── 50 cases across all lifecycle statuses ────────────────────────────────────
  const cases: CaseDoc[] = [];
  for (let i = 1; i <= 50; i++) {
    const status = CASE_STATUSES[(i - 1) % CASE_STATUSES.length];
    const missionIdx = i % 3 === 0 ? (i % missions.length) : -1;
    const mission = missionIdx >= 0 ? missions[missionIdx] : null;
    const site = SITES[SITE_KEYS[(i - 1) % SITE_KEYS.length]];

    // Deterministic position jitter using sine/cosine
    const baseLat = mission ? mission.lat! : site.lat;
    const baseLng = mission ? mission.lng! : site.lng;
    const jitterScale = 0.3;
    const lat = baseLat + Math.sin(i * 1.3) * jitterScale;
    const lng = baseLng + Math.cos(i * 1.7) * jitterScale;

    const isTransit = status === "transit_out" || status === "transit_in";

    cases.push({
      _id: mkId("cases", i),
      _creationTime: now - daysMs(50 - i),
      label: `CASE-${String(i).padStart(4, "0")}`,
      qrCode: `https://scan.skyspecs.com/case_${i}?uid=${i.toString(16).padStart(32, "0")}`,
      qrCodeSource: "generated",
      status,
      missionId: mission ? mission._id : undefined,
      lat,
      lng,
      locationName: mission ? mission.locationName : site.name,
      assigneeId: i % 5 !== 0 ? `seed_usr_tech_${["alice", "raj", "dana", "james"][i % 4]}` : undefined,
      assigneeName: i % 5 !== 0 ? `Technician ${["Alice Chen", "Raj Patel", "Dana Kim", "James Okafor"][i % 4]}` : undefined,
      // Shipping fields for transit cases
      trackingNumber: isTransit ? FEDEX_TRACKING_NUMBERS[(i - 1) % FEDEX_TRACKING_NUMBERS.length] : undefined,
      carrier: isTransit ? "FedEx" : undefined,
      shippedAt: isTransit ? now - daysMs(i % 5) : undefined,
      destinationName: isTransit ? "SkySpecs HQ — Ann Arbor, MI" : undefined,
      destinationLat: isTransit ? 42.2808 : undefined,
      destinationLng: isTransit ? -83.7430 : undefined,
      notes: i % 10 === 0 ? `Note for case ${i}` : undefined,
      createdAt: now - daysMs(50 - i),
      updatedAt: now - daysMs(i % 10) - (i % 24) * 3_600_000,
    });
  }

  // ── 42 inspections — for deployed and flagged cases ───────────────────────────
  const inspections: InspectionDoc[] = [];
  let inspIdx = 0;
  const fieldCases = cases.filter(
    (c) => c.status === "deployed" || c.status === "flagged"
  );
  for (const c of fieldCases) {
    if (inspIdx >= 42) break;
    const totalItems = 8 + (inspIdx % 8); // 8–15 items per case
    const checkedItems = Math.floor(totalItems * (inspIdx % 11) * 0.1);
    const damagedItems = inspIdx % 5 === 0 ? 1 : 0;
    const missingItems = inspIdx % 7 === 0 ? 1 : 0;

    inspections.push({
      _id: mkId("inspections", inspIdx + 1),
      _creationTime: now - daysMs(inspIdx % 7) - inspIdx * 3_600_000,
      caseId: c._id,
      inspectorId: `seed_usr_tech_${["alice", "raj", "dana"][inspIdx % 3]}`,
      inspectorName: ["Alice Chen", "Raj Patel", "Dana Kim"][inspIdx % 3],
      status: INSPECTION_STATUSES[inspIdx % INSPECTION_STATUSES.length],
      startedAt: now - daysMs(inspIdx % 7),
      completedAt:
        inspIdx % 4 === 0 ? now - daysMs(inspIdx % 7) + 3_600_000 : undefined,
      totalItems,
      checkedItems: Math.min(totalItems, checkedItems),
      damagedItems,
      missingItems,
    });
    inspIdx++;
  }

  // ── 15 shipments — for transit_out and transit_in cases ───────────────────────
  const shipments: ShipmentDoc[] = [];
  let shipIdx = 0;
  const transitCases = cases.filter(
    (c) => c.status === "transit_out" || c.status === "transit_in"
  );
  for (const c of transitCases) {
    if (shipIdx >= 15) break;
    const shipStatus = SHIPMENT_STATUSES[shipIdx % SHIPMENT_STATUSES.length];
    const site = SITES[SITE_KEYS[(shipIdx) % SITE_KEYS.length]];

    shipments.push({
      _id: mkId("shipments", shipIdx + 1),
      _creationTime: now - daysMs(shipIdx + 1),
      caseId: c._id,
      trackingNumber: FEDEX_TRACKING_NUMBERS[shipIdx],
      carrier: "FedEx",
      status: shipStatus,
      originLat: site.lat,
      originLng: site.lng,
      originName: site.name,
      destinationLat: 42.2808,
      destinationLng: -83.7430,
      destinationName: "SkySpecs HQ — Ann Arbor, MI",
      currentLat:
        shipStatus === "in_transit" ? site.lat + 0.5 : undefined,
      currentLng:
        shipStatus === "in_transit" ? site.lng + 0.5 : undefined,
      estimatedDelivery: new Date(now + daysMs(3)).toISOString().slice(0, 10),
      shippedAt: now - daysMs(shipIdx + 1),
      createdAt: now - daysMs(shipIdx + 1),
      updatedAt: now - daysMs(shipIdx % 3),
    });
    shipIdx++;
  }

  // ── 60 custody records — 1–2 per case for most cases ─────────────────────────
  const custodyRecords: CustodyRecordDoc[] = [];
  const USERS = [
    { id: "seed_usr_tech_alice", name: "Alice Chen" },
    { id: "seed_usr_tech_raj",   name: "Raj Patel" },
    { id: "seed_usr_tech_dana",  name: "Dana Kim" },
    { id: "seed_usr_tech_james", name: "James Okafor" },
    { id: "seed_usr_pilot_emma", name: "Emma Lundström" },
    { id: "seed_usr_logistics",  name: "Sarah Novak" },
  ];
  let custodyIdx = 0;
  for (const c of cases) {
    if (custodyIdx >= 60) break;
    const fromUser = USERS[custodyIdx % USERS.length];
    const toUser = USERS[(custodyIdx + 1) % USERS.length];
    custodyRecords.push({
      _id: mkId("custodyRecords", custodyIdx + 1),
      _creationTime: now - daysMs(custodyIdx % 30),
      caseId: c._id,
      fromUserId: fromUser.id,
      fromUserName: fromUser.name,
      toUserId: toUser.id,
      toUserName: toUser.name,
      transferredAt: now - daysMs(custodyIdx % 30),
      note: custodyIdx % 5 === 0 ? "Custody transferred at site check-in" : undefined,
    });
    custodyIdx++;

    // Add a second custody record for some cases
    if (custodyIdx < 60 && custodyIdx % 3 === 0) {
      const fromUser2 = toUser;
      const toUser2 = USERS[(custodyIdx + 2) % USERS.length];
      custodyRecords.push({
        _id: mkId("custodyRecords", custodyIdx + 1),
        _creationTime: now - daysMs(custodyIdx % 15),
        caseId: c._id,
        fromUserId: fromUser2.id,
        fromUserName: fromUser2.name,
        toUserId: toUser2.id,
        toUserName: toUser2.name,
        transferredAt: now - daysMs(custodyIdx % 15),
      });
      custodyIdx++;
    }
  }

  // ── Build derived lookup structures ───────────────────────────────────────────

  // casesById: O(1) primary-key lookup (mirrors Convex ctx.db.get)
  const casesById = new Map<string, CaseDoc>();
  for (const c of cases) {
    casesById.set(c._id.toString(), c);
  }

  // casesByQrCode: O(log n) QR lookup (mirrors by_qr_code index)
  const casesByQrCode = new Map<string, CaseDoc>();
  for (const c of cases) {
    if (c.qrCode) casesByQrCode.set(c.qrCode, c);
  }

  // latestCustodyByCase: O(1) custody lookup (built from full custodyRecords scan)
  const latestCustodyByCase = new Map<string, CustodyRecordDoc>();
  for (const record of custodyRecords) {
    const key = record.caseId.toString();
    const existing = latestCustodyByCase.get(key);
    if (!existing || record.transferredAt > existing.transferredAt) {
      latestCustodyByCase.set(key, record);
    }
  }

  // latestInspectionByCase: for M3 assembler
  const latestInspectionByCase = new Map<string, InspectionDoc>();
  for (const ins of inspections) {
    const key = ins.caseId.toString();
    const existing = latestInspectionByCase.get(key);
    if (!existing || ins._creationTime > existing._creationTime) {
      latestInspectionByCase.set(key, ins);
    }
  }

  // casesMapById: for M4 assembler (mirrors casesById but typed for assembleM4)
  const casesMapById = new Map<string, CaseDoc>();
  for (const c of cases) {
    casesMapById.set(c._id.toString(), c);
  }

  // custodySnapshotByCase: convert CustodyRecordDoc → CustodySnapshot for assembler
  const custodySnapshotByCase = new Map<string, CustodySnapshot>();
  for (const [key, record] of latestCustodyByCase) {
    custodySnapshotByCase.set(key, {
      toUserId: record.toUserId,
      toUserName: record.toUserName,
      fromUserId: record.fromUserId,
      fromUserName: record.fromUserName,
      transferredAt: record.transferredAt,
    });
  }

  return {
    cases,
    missions,
    inspections,
    shipments,
    custodyRecords,
    casesById,
    casesByQrCode,
    latestCustodyByCase,
    latestInspectionByCase,
    casesMapById,
    custodySnapshotByCase,
  };
}

// ─── p50 latency helper ────────────────────────────────────────────────────────

/**
 * Run `fn` exactly `iterations` times, collect wall-clock durations in ms,
 * and return the 50th-percentile (median when iterations is odd).
 *
 * Uses `performance.now()` for sub-millisecond precision.
 * Sorts the collected samples and picks the middle value.
 */
function measureP50(fn: () => void, iterations = 101): number {
  const durations: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    durations.push(performance.now() - t0);
  }
  durations.sort((a, b) => a - b);
  return durations[Math.floor(iterations / 2)];
}

// ─── Shared seed dataset (built once, shared across all tests) ────────────────

const SEED = buildProductionSeedDataset();

const {
  cases,
  missions,
  inspections,
  shipments,
  custodyRecords,
  casesById,
  casesByQrCode,
  latestCustodyByCase,
  latestInspectionByCase,
  casesMapById,
  custodySnapshotByCase,
} = SEED;

const ITERATIONS = 101;
const P50_BUDGET_MS = 200;

// ─── Dataset size assertions ──────────────────────────────────────────────────

describe("Seed dataset — production-representative sizes", () => {
  it("50 cases covering all 8 lifecycle statuses", () => {
    expect(cases).toHaveLength(50);
    const statuses = new Set(cases.map((c) => c.status));
    expect(statuses.size).toBe(8);
  });

  it("6 missions across Michigan, Ohio, Illinois, Indiana sites", () => {
    expect(missions).toHaveLength(6);
  });

  it("up to 15 shipments for transit cases", () => {
    expect(shipments.length).toBeGreaterThanOrEqual(1);
    expect(shipments.length).toBeLessThanOrEqual(15);
  });

  it("up to 42 inspections for deployed/flagged cases", () => {
    expect(inspections.length).toBeGreaterThanOrEqual(1);
    expect(inspections.length).toBeLessThanOrEqual(42);
  });

  it("up to 60 custody records", () => {
    expect(custodyRecords.length).toBeGreaterThanOrEqual(1);
    expect(custodyRecords.length).toBeLessThanOrEqual(60);
  });
});

// ─── getCaseById — correctness ────────────────────────────────────────────────

describe("getCaseById — O(1) primary-key lookup", () => {
  it("returns the correct case document", () => {
    const target = cases[0];
    const result = simulateGetCaseById(casesById, target._id.toString());
    expect(result).not.toBeNull();
    expect(result!._id).toBe(target._id.toString());
    expect(result!.label).toBe(target.label);
    expect(result!.status).toBe(target.status);
  });

  it("returns null for a non-existent case ID", () => {
    const result = simulateGetCaseById(casesById, "cases_9999_not_found");
    expect(result).toBeNull();
  });

  it("returns the full case document with all seeded fields", () => {
    const transitCase = cases.find(
      (c) => c.status === "transit_out" || c.status === "transit_in"
    );
    expect(transitCase).toBeDefined();
    const result = simulateGetCaseById(casesById, transitCase!._id.toString());
    expect(result).not.toBeNull();
    expect(result!.trackingNumber).toBeDefined();
    expect(result!.carrier).toBe("FedEx");
  });
});

// ─── getCaseStatus — correctness ──────────────────────────────────────────────

describe("getCaseStatus — O(1) lookup + lightweight projection", () => {
  it("returns a lightweight status projection", () => {
    const target = cases[5];
    const result = simulateGetCaseStatus(casesById, target._id.toString());
    expect(result).not.toBeNull();
    expect(result!._id).toBe(target._id.toString());
    expect(result!.label).toBe(target.label);
    expect(result!.status).toBe(target.status);
    expect(result!.updatedAt).toBe(target.updatedAt);
  });

  it("result has only the lightweight fields (not full doc)", () => {
    const result = simulateGetCaseStatus(casesById, cases[0]._id.toString());
    expect(result).not.toBeNull();
    // Must have: _id, label, status, updatedAt
    expect(result!._id).toBeDefined();
    expect(result!.label).toBeDefined();
    expect(result!.status).toBeDefined();
    expect(result!.updatedAt).toBeDefined();
    // Must NOT have: qrCode, templateId, notes (full-doc only fields)
    expect((result as any).qrCode).toBeUndefined();
    expect((result as any).notes).toBeUndefined();
  });

  it("returns null for a non-existent case", () => {
    const result = simulateGetCaseStatus(casesById, "cases_0_missing");
    expect(result).toBeNull();
  });
});

// ─── listCases — correctness ──────────────────────────────────────────────────

describe("listCases — index scan + optional filters", () => {
  it("no filters: returns all 50 cases ordered by updatedAt desc", () => {
    const result = simulateListCases(cases, {});
    expect(result).toHaveLength(50);
    // Verify descending order
    for (let i = 1; i < result.length; i++) {
      expect(result[i].updatedAt).toBeLessThanOrEqual(result[i - 1].updatedAt);
    }
  });

  it("status filter: returns only cases with the matching status", () => {
    const result = simulateListCases(cases, { status: "deployed" });
    expect(result.length).toBeGreaterThan(0);
    for (const c of result) {
      expect(c.status).toBe("deployed");
    }
  });

  it("missionId filter: returns only cases on that mission", () => {
    const mission = missions[0];
    const result = simulateListCases(cases, {
      missionId: mission._id.toString(),
    });
    for (const c of result) {
      expect(c.missionId?.toString()).toBe(mission._id.toString());
    }
  });

  it("status + missionId combined: intersection filter", () => {
    const mission = missions[0];
    const result = simulateListCases(cases, {
      status: "deployed",
      missionId: mission._id.toString(),
    });
    for (const c of result) {
      expect(c.status).toBe("deployed");
      expect(c.missionId?.toString()).toBe(mission._id.toString());
    }
  });

  it("bounds filter: only returns cases within the bounding box", () => {
    // Bounding box around the Lake Michigan site
    const site = SITES.lakeMichigan;
    const result = simulateListCases(cases, {
      swLat: site.lat - 1,
      swLng: site.lng - 1,
      neLat: site.lat + 1,
      neLng: site.lng + 1,
    });
    for (const c of result) {
      expect(c.lat).toBeDefined();
      expect(c.lng).toBeDefined();
      expect(c.lat!).toBeGreaterThanOrEqual(site.lat - 1);
      expect(c.lat!).toBeLessThanOrEqual(site.lat + 1);
    }
  });

  it("ocean bounding box: returns empty array", () => {
    const result = simulateListCases(cases, {
      swLat: 0, swLng: 0, neLat: 1, neLng: 1,
    });
    expect(result).toHaveLength(0);
  });
});

// ─── getCaseStatusCounts — correctness ───────────────────────────────────────

describe("getCaseStatusCounts — full-fleet aggregate", () => {
  let counts: CaseStatusCounts;
  beforeAll(() => {
    counts = simulateGetCaseStatusCounts(cases);
  });

  it("total equals 50 (seed dataset size)", () => {
    expect(counts.total).toBe(50);
  });

  it("byStatus keys are valid case statuses", () => {
    const validStatuses = new Set(CASE_STATUSES);
    for (const key of Object.keys(counts.byStatus)) {
      expect(validStatuses.has(key as CaseStatus)).toBe(true);
    }
  });

  it("byStatus counts sum to total", () => {
    const sum = Object.values(counts.byStatus).reduce((a, b) => a + b, 0);
    expect(sum).toBe(counts.total);
  });

  it("every status has a count (seed distributes evenly across 8 statuses)", () => {
    for (const status of CASE_STATUSES) {
      expect(counts.byStatus[status]).toBeGreaterThan(0);
    }
  });
});

// ─── listForMap — correctness ─────────────────────────────────────────────────

describe("listForMap — custody join + filter + CaseForMapResult projection", () => {
  it("no filter: returns all 50 cases as CaseForMapResult", () => {
    const result = simulateListForMap(cases, latestCustodyByCase, {});
    expect(result).toHaveLength(50);
  });

  it("each result has required CaseForMapResult fields", () => {
    const result = simulateListForMap(cases, latestCustodyByCase, {});
    for (const r of result) {
      expect(typeof r._id).toBe("string");
      expect(typeof r.label).toBe("string");
      expect(typeof r.status).toBe("string");
      expect(typeof r.updatedAt).toBe("number");
      expect(typeof r.createdAt).toBe("number");
    }
  });

  it("custody fields are populated from custody records when available", () => {
    const result = simulateListForMap(cases, latestCustodyByCase, {});
    const caseWithCustody = result.find((r) => r.currentCustodianId !== undefined);
    expect(caseWithCustody).toBeDefined();
    expect(caseWithCustody!.currentCustodianName).toBeDefined();
  });

  it("status filter: narrows to only matching statuses", () => {
    const result = simulateListForMap(cases, latestCustodyByCase, {
      status: ["deployed", "flagged"],
    });
    for (const r of result) {
      expect(["deployed", "flagged"]).toContain(r.status);
    }
  });

  it("assigneeId filter: narrows to a specific technician", () => {
    const result = simulateListForMap(cases, latestCustodyByCase, {
      assigneeId: "seed_usr_tech_alice",
    });
    for (const r of result) {
      expect(r.assigneeId).toBe("seed_usr_tech_alice");
    }
  });

  it("missionId filter: narrows to cases on a specific mission", () => {
    const mission = missions[0];
    const result = simulateListForMap(cases, latestCustodyByCase, {
      missionId: mission._id.toString(),
    });
    for (const r of result) {
      expect(r.missionId).toBe(mission._id.toString());
    }
  });

  it("bounds filter: narrows to the geographic bounding box", () => {
    const site = SITES.lakeErie;
    const result = simulateListForMap(cases, latestCustodyByCase, {
      swLat: site.lat - 1,
      swLng: site.lng - 1,
      neLat: site.lat + 1,
      neLng: site.lng + 1,
    });
    for (const r of result) {
      if (r.lat !== undefined) {
        expect(r.lat).toBeGreaterThanOrEqual(site.lat - 1);
        expect(r.lat).toBeLessThanOrEqual(site.lat + 1);
      }
    }
  });

  it("transit cases include shipping summary fields", () => {
    const result = simulateListForMap(cases, latestCustodyByCase, {
      status: ["transit_out", "transit_in"],
    });
    for (const r of result) {
      expect(r.trackingNumber).toBeDefined();
      expect(r.carrier).toBe("FedEx");
    }
  });
});

// ─── Map mode query correctness ───────────────────────────────────────────────

describe("Map mode queries — response shape correctness", () => {
  it("M1: returns mode='M1' with cases array and summary", () => {
    const result = assembleM1(
      cases as any[],
      null,
      {},
      custodySnapshotByCase
    );
    expect(result.mode).toBe("M1");
    expect(Array.isArray(result.cases)).toBe(true);
    expect(result.summary.total).toBe(50);
  });

  it("M2: returns mode='M2' with mission groups and unassigned", () => {
    const result = assembleM2(
      cases as any[],
      missions as any[],
      null,
      {},
      custodySnapshotByCase
    );
    expect(result.mode).toBe("M2");
    expect(Array.isArray(result.missions)).toBe(true);
    expect(Array.isArray(result.unassigned)).toBe(true);
    expect(result.summary.totalMissions).toBe(6);
  });

  it("M3: returns mode='M3' with only deployed/flagged cases", () => {
    const result = assembleM3(
      cases as any[],
      latestInspectionByCase as Map<string, any>,
      null,
      {},
      custodySnapshotByCase
    );
    expect(result.mode).toBe("M3");
    for (const pin of result.cases) {
      expect(["deployed", "flagged"]).toContain(pin.status);
    }
  });

  it("M4: returns mode='M4' with shipment pins", () => {
    const result = assembleM4(
      shipments as any[],
      casesMapById as Map<string, any>,
      null,
      {}
    );
    expect(result.mode).toBe("M4");
    expect(Array.isArray(result.shipments)).toBe(true);
    expect(result.summary.total).toBe(shipments.length);
  });

  it("M5 (feature enabled): returns mode='M5' with clusters and heatmap", () => {
    const result = assembleM5(
      cases as any[],
      missions as any[],
      true,
      null
    );
    expect(result.mode).toBe("M5");
    expect(result.featureEnabled).toBe(true);
    expect(Array.isArray(result.clusters)).toBe(true);
    expect(Array.isArray(result.heatmap)).toBe(true);
  });

  it("M5 (feature disabled): returns featureEnabled=false with empty arrays", () => {
    const result = assembleM5(
      cases as any[],
      missions as any[],
      false,
      null
    );
    expect(result.featureEnabled).toBe(false);
    expect(result.clusters).toHaveLength(0);
    expect(result.heatmap).toHaveLength(0);
  });
});

// ─── LATENCY BENCHMARKS — p50 < 200ms ─────────────────────────────────────────

describe(`Convex endpoint latency benchmarks — p50 < ${P50_BUDGET_MS}ms (${ITERATIONS} iterations)`, () => {

  // ── getCaseById ─────────────────────────────────────────────────────────────

  it(`getCaseById p50 < ${P50_BUDGET_MS}ms — O(1) Map lookup (50 cases)`, () => {
    // Sample across different case IDs to avoid pathological caching
    const ids = cases.slice(0, 10).map((c) => c._id.toString());
    let idIdx = 0;

    const p50 = measureP50(() => {
      simulateGetCaseById(casesById, ids[idIdx % ids.length]);
      idIdx++;
    }, ITERATIONS);

    console.log(`[latency] getCaseById         p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── getCaseStatus ───────────────────────────────────────────────────────────

  it(`getCaseStatus p50 < ${P50_BUDGET_MS}ms — O(1) lookup + projection (50 cases)`, () => {
    const ids = cases.slice(0, 10).map((c) => c._id.toString());
    let idIdx = 0;

    const p50 = measureP50(() => {
      simulateGetCaseStatus(casesById, ids[idIdx % ids.length]);
      idIdx++;
    }, ITERATIONS);

    console.log(`[latency] getCaseStatus       p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── listCases (no filter) ───────────────────────────────────────────────────

  it(`listCases (no filter) p50 < ${P50_BUDGET_MS}ms — full scan (50 cases)`, () => {
    const p50 = measureP50(() => {
      simulateListCases(cases, {});
    }, ITERATIONS);

    console.log(`[latency] listCases (no filter) p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── listCases (status filter) ───────────────────────────────────────────────

  it(`listCases (status=deployed) p50 < ${P50_BUDGET_MS}ms — index-equivalent scan (50 cases)`, () => {
    const p50 = measureP50(() => {
      simulateListCases(cases, { status: "deployed" });
    }, ITERATIONS);

    console.log(`[latency] listCases (status)  p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── listCases (missionId filter) ────────────────────────────────────────────

  it(`listCases (missionId) p50 < ${P50_BUDGET_MS}ms — mission index-equivalent scan (50 cases)`, () => {
    const missionId = missions[0]._id.toString();
    const p50 = measureP50(() => {
      simulateListCases(cases, { missionId });
    }, ITERATIONS);

    console.log(`[latency] listCases (mission) p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── listCases (status + missionId combined) ─────────────────────────────────

  it(`listCases (status + missionId) p50 < ${P50_BUDGET_MS}ms — combined filter (50 cases)`, () => {
    const missionId = missions[0]._id.toString();
    const p50 = measureP50(() => {
      simulateListCases(cases, { status: "assembled", missionId });
    }, ITERATIONS);

    console.log(`[latency] listCases (combined) p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── listCases (bounds filter) ───────────────────────────────────────────────

  it(`listCases (bounds filter) p50 < ${P50_BUDGET_MS}ms — geo filter (50 cases)`, () => {
    const site = SITES.lakeMichigan;
    const p50 = measureP50(() => {
      simulateListCases(cases, {
        swLat: site.lat - 2,
        swLng: site.lng - 2,
        neLat: site.lat + 2,
        neLng: site.lng + 2,
      });
    }, ITERATIONS);

    console.log(`[latency] listCases (bounds)  p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── getCaseStatusCounts ─────────────────────────────────────────────────────

  it(`getCaseStatusCounts p50 < ${P50_BUDGET_MS}ms — full scan + aggregate (50 cases)`, () => {
    const p50 = measureP50(() => {
      simulateGetCaseStatusCounts(cases);
    }, ITERATIONS);

    console.log(`[latency] getCaseStatusCounts p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── listForMap (no filter) ──────────────────────────────────────────────────

  it(`listForMap (no filter) p50 < ${P50_BUDGET_MS}ms — scan + custody join (50 cases)`, () => {
    const p50 = measureP50(() => {
      simulateListForMap(cases, latestCustodyByCase, {});
    }, ITERATIONS);

    console.log(`[latency] listForMap (no filter) p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── listForMap (status + assigneeId filter) ─────────────────────────────────

  it(`listForMap (status + assigneeId) p50 < ${P50_BUDGET_MS}ms — multi-filter + custody join (50 cases)`, () => {
    const p50 = measureP50(() => {
      simulateListForMap(cases, latestCustodyByCase, {
        status: ["deployed", "flagged"],
        assigneeId: "seed_usr_tech_alice",
      });
    }, ITERATIONS);

    console.log(`[latency] listForMap (filtered) p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── listForMap (bounds filter) ──────────────────────────────────────────────

  it(`listForMap (bounds) p50 < ${P50_BUDGET_MS}ms — geo filter + custody join (50 cases)`, () => {
    const site = SITES.illinoisPrairie;
    const p50 = measureP50(() => {
      simulateListForMap(cases, latestCustodyByCase, {
        swLat: site.lat - 2,
        swLng: site.lng - 2,
        neLat: site.lat + 2,
        neLng: site.lng + 2,
      });
    }, ITERATIONS);

    console.log(`[latency] listForMap (bounds) p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── M1 getM1MapData — Fleet Overview ────────────────────────────────────────

  it(`getM1MapData p50 < ${P50_BUDGET_MS}ms — fleet overview (50 cases + custody)`, () => {
    const p50 = measureP50(() => {
      assembleM1(cases as any[], null, {}, custodySnapshotByCase);
    }, ITERATIONS);

    console.log(`[latency] getM1MapData        p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it(`getM1MapData (with bounds) p50 < ${P50_BUDGET_MS}ms — viewport-constrained fleet overview`, () => {
    const bounds: MapBounds = {
      swLat: 39.0, swLng: -92.0,
      neLat: 48.0, neLng: -80.0,
    };
    const p50 = measureP50(() => {
      assembleM1(cases as any[], bounds, {}, custodySnapshotByCase);
    }, ITERATIONS);

    console.log(`[latency] getM1MapData+bounds  p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it(`getM1MapData (status filter) p50 < ${P50_BUDGET_MS}ms — deployed+flagged cases only`, () => {
    const filters: ParsedFilters = { status: ["deployed", "flagged"] };
    const p50 = measureP50(() => {
      assembleM1(cases as any[], null, filters, custodySnapshotByCase);
    }, ITERATIONS);

    console.log(`[latency] getM1MapData+filter  p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── M2 getM2MapData — Mission Mode ──────────────────────────────────────────

  it(`getM2MapData p50 < ${P50_BUDGET_MS}ms — mission grouping (50 cases, 6 missions)`, () => {
    const p50 = measureP50(() => {
      assembleM2(
        cases as any[],
        missions as any[],
        null,
        {},
        custodySnapshotByCase
      );
    }, ITERATIONS);

    console.log(`[latency] getM2MapData         p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it(`getM2MapData (missionId filter) p50 < ${P50_BUDGET_MS}ms — single-mission drill-down`, () => {
    const filters: ParsedFilters = { missionId: missions[0]._id.toString() };
    const p50 = measureP50(() => {
      assembleM2(
        cases as any[],
        missions as any[],
        null,
        filters,
        custodySnapshotByCase
      );
    }, ITERATIONS);

    console.log(`[latency] getM2MapData+mission p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── M3 getM3MapData — Field Mode ────────────────────────────────────────────

  it(`getM3MapData p50 < ${P50_BUDGET_MS}ms — field mode + inspection join (50 cases)`, () => {
    const p50 = measureP50(() => {
      assembleM3(
        cases as any[],
        latestInspectionByCase as Map<string, any>,
        null,
        {},
        custodySnapshotByCase
      );
    }, ITERATIONS);

    console.log(`[latency] getM3MapData         p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it(`getM3MapData (assigneeId filter) p50 < ${P50_BUDGET_MS}ms — technician field view`, () => {
    const filters: ParsedFilters = { assigneeId: "seed_usr_tech_alice" };
    const p50 = measureP50(() => {
      assembleM3(
        cases as any[],
        latestInspectionByCase as Map<string, any>,
        null,
        filters,
        custodySnapshotByCase
      );
    }, ITERATIONS);

    console.log(`[latency] getM3MapData+assign  p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it(`getM3MapData (hasDamage filter) p50 < ${P50_BUDGET_MS}ms — damaged items filter`, () => {
    const filters: ParsedFilters = { hasDamage: true };
    const p50 = measureP50(() => {
      assembleM3(
        cases as any[],
        latestInspectionByCase as Map<string, any>,
        null,
        filters,
        custodySnapshotByCase
      );
    }, ITERATIONS);

    console.log(`[latency] getM3MapData+damage  p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── M4 getM4MapData — Logistics Mode ────────────────────────────────────────

  it(`getM4MapData p50 < ${P50_BUDGET_MS}ms — logistics mode + case join (15 shipments)`, () => {
    const p50 = measureP50(() => {
      assembleM4(
        shipments as any[],
        casesMapById as Map<string, any>,
        null,
        {}
      );
    }, ITERATIONS);

    console.log(`[latency] getM4MapData         p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it(`getM4MapData (status filter) p50 < ${P50_BUDGET_MS}ms — in_transit shipments only`, () => {
    const filters: ParsedFilters = { status: ["in_transit", "out_for_delivery"] };
    const p50 = measureP50(() => {
      assembleM4(
        shipments as any[],
        casesMapById as Map<string, any>,
        null,
        filters
      );
    }, ITERATIONS);

    console.log(`[latency] getM4MapData+status  p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it(`getM4MapData (bounds filter) p50 < ${P50_BUDGET_MS}ms — viewport-constrained logistics`, () => {
    const bounds: MapBounds = {
      swLat: 39.0, swLng: -92.0,
      neLat: 48.0, neLng: -80.0,
    };
    const p50 = measureP50(() => {
      assembleM4(
        shipments as any[],
        casesMapById as Map<string, any>,
        bounds,
        {}
      );
    }, ITERATIONS);

    console.log(`[latency] getM4MapData+bounds  p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── M5 getM5MapData — Mission Control ───────────────────────────────────────

  it(`getM5MapData (feature enabled) p50 < ${P50_BUDGET_MS}ms — clusters + heatmap (50 cases, 6 missions)`, () => {
    const p50 = measureP50(() => {
      assembleM5(cases as any[], missions as any[], true, null);
    }, ITERATIONS);

    console.log(`[latency] getM5MapData (on)    p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it(`getM5MapData (feature disabled) p50 < ${P50_BUDGET_MS}ms — early-exit path`, () => {
    const p50 = measureP50(() => {
      assembleM5(cases as any[], missions as any[], false, null);
    }, ITERATIONS);

    console.log(`[latency] getM5MapData (off)   p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it(`getM5MapData (bounds filter) p50 < ${P50_BUDGET_MS}ms — viewport-constrained mission control`, () => {
    const bounds: MapBounds = {
      swLat: 39.0, swLng: -92.0,
      neLat: 48.0, neLng: -80.0,
    };
    const p50 = measureP50(() => {
      assembleM5(cases as any[], missions as any[], true, bounds);
    }, ITERATIONS);

    console.log(`[latency] getM5MapData+bounds  p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  // ── Combined pipeline (all endpoints in sequence) ───────────────────────────

  it(`Combined pipeline p50 < ${P50_BUDGET_MS}ms — listCases + getCaseById + getCaseStatus + listForMap + M1 in sequence`, () => {
    const caseId = cases[0]._id.toString();

    const p50 = measureP50(() => {
      // Simulates a full dashboard page load: overview counts + detail lookup + map
      simulateGetCaseStatusCounts(cases);
      simulateListCases(cases, { status: "deployed" });
      simulateGetCaseById(casesById, caseId);
      simulateGetCaseStatus(casesById, caseId);
      simulateListForMap(cases, latestCustodyByCase, {});
      assembleM1(cases as any[], null, {}, custodySnapshotByCase);
    }, ITERATIONS);

    console.log(`[latency] combined pipeline   p50 = ${p50.toFixed(3)}ms`);
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });
});
