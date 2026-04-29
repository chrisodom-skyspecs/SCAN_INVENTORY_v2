/**
 * Integration test: GET /api/cases/map
 *
 * Exercises the full map-data assembly pipeline with a seeded dataset:
 *   - HTTP request parameter validation (mirrors convex/http.ts logic)
 *   - Response shape correctness for all 5 map modes (M1–M5)
 *   - Bounds and filter param behaviour
 *   - p50 assembly latency under 200 ms for a realistically-sized fleet
 *
 * Architecture note:
 *   The Convex HTTP handler delegates all work to pure assembler functions
 *   (assembleM1–M5) exported from convex/maps.ts. These functions have zero
 *   Convex runtime dependencies — they accept plain JS arrays and Maps and
 *   return plain JS objects. This test exercises them directly with seeded
 *   data, giving us both correctness and latency guarantees without needing
 *   a live Convex deployment.
 *
 * Run: npx vitest run
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  assembleM1,
  assembleM2,
  assembleM3,
  assembleM4,
  assembleM5,
  parseBounds,
  parseFilters,
  type M1Response,
  type M2Response,
  type M3Response,
  type M4Response,
  type M5Response,
  type MapBounds,
  type ParsedFilters,
} from "../../../convex/maps";

// ─── Typed stubs for Convex Doc shapes ───────────────────────────────────────
// convex/_generated/dataModel.ts exports Doc<T> = any (stub before codegen).
// We define explicit interfaces here so the test is fully type-checked against
// the Convex schema without importing Convex server internals.

type ConvexId<T extends string> = string & { __tableName: T };

function mkId<T extends string>(table: T, n: number | string): ConvexId<T> {
  return `${table}_${n}` as ConvexId<T>;
}

interface CaseDoc {
  _id: ConvexId<"cases">;
  _creationTime: number;
  label: string;
  qrCode: string;
  status: "hangar" | "assembled" | "transit_out" | "deployed" | "flagged" | "transit_in" | "received" | "archived";
  templateId?: ConvexId<"caseTemplates">;
  missionId?: ConvexId<"missions">;
  lat?: number;
  lng?: number;
  locationName?: string;
  assigneeId?: string;
  assigneeName?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

interface MissionDoc {
  _id: ConvexId<"missions">;
  _creationTime: number;
  name: string;
  description?: string;
  status: "planning" | "active" | "completed" | "cancelled";
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
  status: "pending" | "in_progress" | "completed" | "flagged";
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
  status:
    | "label_created"
    | "picked_up"
    | "in_transit"
    | "out_for_delivery"
    | "delivered"
    | "exception";
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

// ─── Seeded dataset factory ───────────────────────────────────────────────────

const CASE_STATUSES: CaseDoc["status"][] = [
  "hangar",
  "assembled",
  "transit_out",
  "deployed",
  "flagged",
  "transit_in",
  "received",
  "archived",
];

const MISSION_STATUSES: MissionDoc["status"][] = [
  "planning",
  "active",
  "completed",
  "cancelled",
];

const INSPECTION_STATUSES: InspectionDoc["status"][] = [
  "pending",
  "in_progress",
  "completed",
  "flagged",
];

const SHIPMENT_STATUSES: ShipmentDoc["status"][] = [
  "label_created",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "exception",
];

/**
 * Build a seeded dataset with `caseCount` cases spread across all statuses
 * and missions. This dataset is shared across correctness + latency tests.
 */
function buildSeedDataset(caseCount = 250) {
  const now = Date.now();

  // 5 missions — spread across the continental US
  const missions: MissionDoc[] = [
    {
      _id: mkId("missions", 1),
      _creationTime: now - 86_400_000 * 30,
      name: "Mission Alpha",
      status: "active",
      lat: 47.6062,
      lng: -122.3321,
      locationName: "Seattle, WA",
      leadId: "user_lead_1",
      leadName: "Alice Lead",
      createdAt: now - 86_400_000 * 30,
      updatedAt: now - 3_600_000,
    },
    {
      _id: mkId("missions", 2),
      _creationTime: now - 86_400_000 * 20,
      name: "Mission Bravo",
      status: "active",
      lat: 41.8781,
      lng: -87.6298,
      locationName: "Chicago, IL",
      leadId: "user_lead_2",
      leadName: "Bob Lead",
      createdAt: now - 86_400_000 * 20,
      updatedAt: now - 7_200_000,
    },
    {
      _id: mkId("missions", 3),
      _creationTime: now - 86_400_000 * 10,
      name: "Mission Charlie",
      status: "planning",
      lat: 29.7604,
      lng: -95.3698,
      locationName: "Houston, TX",
      createdAt: now - 86_400_000 * 10,
      updatedAt: now - 86_400_000,
    },
    {
      _id: mkId("missions", 4),
      _creationTime: now - 86_400_000 * 5,
      name: "Mission Delta",
      status: "completed",
      lat: 40.7128,
      lng: -74.006,
      locationName: "New York, NY",
      createdAt: now - 86_400_000 * 5,
      updatedAt: now - 172_800_000,
    },
    {
      _id: mkId("missions", 5),
      _creationTime: now - 86_400_000 * 2,
      name: "Mission Echo",
      status: "cancelled",
      lat: 34.0522,
      lng: -118.2437,
      locationName: "Los Angeles, CA",
      createdAt: now - 86_400_000 * 2,
      updatedAt: now - 43_200_000,
    },
  ];

  // Build cases — cycle through statuses and spread across missions
  const cases: CaseDoc[] = [];
  for (let i = 1; i <= caseCount; i++) {
    const status = CASE_STATUSES[(i - 1) % CASE_STATUSES.length];
    // Assign every 3rd case to a mission
    const missionIdx = i % 3 === 0 ? (i % missions.length) : null;
    const mission = missionIdx !== null ? missions[missionIdx] : null;

    // Position: cases near their mission site, or scattered
    const lat = mission
      ? mission.lat! + (Math.sin(i) * 0.5)
      : 35 + (i % 20) * 0.4;
    const lng = mission
      ? mission.lng! + (Math.cos(i) * 0.5)
      : -100 + (i % 30) * 0.8;

    cases.push({
      _id: mkId("cases", i),
      _creationTime: now - 86_400_000 * (caseCount - i),
      label: `CASE-${String(i).padStart(4, "0")}`,
      qrCode: `QR-${i}`,
      status,
      missionId: mission ? mission._id : undefined,
      lat,
      lng,
      locationName: mission ? mission.locationName : `Site-${i}`,
      assigneeId: i % 4 !== 0 ? `user_${(i % 10) + 1}` : undefined,
      assigneeName: i % 4 !== 0 ? `Technician ${(i % 10) + 1}` : undefined,
      createdAt: now - 86_400_000 * (caseCount - i),
      updatedAt: now - 3_600_000 * (i % 24),
    });
  }

  // Build inspections — one per "deployed" or "flagged" case
  const inspections: InspectionDoc[] = [];
  let inspIdx = 1;
  for (const c of cases) {
    if (c.status === "deployed" || c.status === "flagged") {
      const inspStatus =
        INSPECTION_STATUSES[inspIdx % INSPECTION_STATUSES.length];
      const totalItems = 10;
      const checkedItems = Math.min(
        totalItems,
        Math.floor(totalItems * (inspIdx % 11) * 0.1)
      );
      const damagedItems = inspIdx % 5 === 0 ? 1 : 0;
      const missingItems = inspIdx % 7 === 0 ? 1 : 0;

      inspections.push({
        _id: mkId("inspections", inspIdx),
        _creationTime: now - 3_600_000 * inspIdx,
        caseId: c._id,
        inspectorId: `user_insp_${inspIdx % 5}`,
        inspectorName: `Inspector ${inspIdx % 5}`,
        status: inspStatus,
        startedAt: now - 7_200_000,
        totalItems,
        checkedItems,
        damagedItems,
        missingItems,
      });
      inspIdx++;
    }
  }

  // Build shipments — one per "transit_out" or "transit_in" case
  const shipments: ShipmentDoc[] = [];
  let shipIdx = 1;
  for (const c of cases) {
    if (c.status === "transit_out" || c.status === "transit_in") {
      const shipStatus =
        SHIPMENT_STATUSES[shipIdx % SHIPMENT_STATUSES.length];
      shipments.push({
        _id: mkId("shipments", shipIdx),
        _creationTime: now - 86_400_000 * shipIdx,
        caseId: c._id,
        trackingNumber: `1Z999AA1${String(shipIdx).padStart(10, "0")}`,
        carrier: "FedEx",
        status: shipStatus,
        originLat: c.lat,
        originLng: c.lng,
        originName: c.locationName ?? "Origin Warehouse",
        destinationLat: 39.7392,
        destinationLng: -104.9903,
        destinationName: "Denver, CO",
        currentLat:
          shipStatus === "in_transit" ? c.lat! + 1 : undefined,
        currentLng:
          shipStatus === "in_transit" ? c.lng! + 1 : undefined,
        estimatedDelivery: new Date(now + 86_400_000 * 3).toISOString().split("T")[0],
        shippedAt: now - 86_400_000,
        createdAt: now - 86_400_000,
        updatedAt: now - 7_200_000,
      });
      shipIdx++;
    }
  }

  // Build latestInspectionByCase map
  const latestInspectionByCase = new Map<string, InspectionDoc>();
  for (const ins of inspections) {
    const key = ins.caseId.toString();
    const existing = latestInspectionByCase.get(key);
    if (!existing || ins._creationTime > existing._creationTime) {
      latestInspectionByCase.set(key, ins);
    }
  }

  // Build casesById map
  const casesById = new Map<string, CaseDoc>();
  for (const c of cases) {
    casesById.set(c._id.toString(), c);
  }

  return {
    cases,
    missions,
    inspections,
    shipments,
    latestInspectionByCase,
    casesById,
  };
}

// ─── HTTP-level request simulator ─────────────────────────────────────────────
// Mirrors the validation + dispatch logic in convex/http.ts casesMapHandler.

type MapMode = "M1" | "M2" | "M3" | "M4" | "M5";
const VALID_MODES: MapMode[] = ["M1", "M2", "M3", "M4", "M5"];

interface HttpSimResult {
  status: number;
  body: unknown;
  durationMs: number;
}

function simulateMapApiRequest(
  queryParams: Record<string, string>,
  seededData: ReturnType<typeof buildSeedDataset>
): HttpSimResult {
  const t0 = performance.now();

  // Validate mode
  const rawMode = queryParams.mode ?? "M1";
  if (!VALID_MODES.includes(rawMode as MapMode)) {
    return {
      status: 400,
      body: { error: `Invalid mode "${rawMode}"`, status: 400 },
      durationMs: performance.now() - t0,
    };
  }
  const mode = rawMode as MapMode;

  // Validate filters JSON
  if (queryParams.filters) {
    try {
      JSON.parse(queryParams.filters);
    } catch {
      return {
        status: 400,
        body: { error: 'Invalid "filters" parameter', status: 400 },
        durationMs: performance.now() - t0,
      };
    }
  }

  // Validate bounds consistency (all four or none)
  const rawBounds = [
    queryParams.swLat,
    queryParams.swLng,
    queryParams.neLat,
    queryParams.neLng,
  ];
  const providedCount = rawBounds.filter(Boolean).length;
  if (providedCount > 0 && providedCount < 4) {
    return {
      status: 400,
      body: {
        error: "Bounds require all four params: swLat, swLng, neLat, neLng",
        status: 400,
      },
      durationMs: performance.now() - t0,
    };
  }

  const bounds = parseBounds(
    queryParams.swLat,
    queryParams.swLng,
    queryParams.neLat,
    queryParams.neLng
  );
  const filters = parseFilters(queryParams.filters);
  const {
    cases,
    missions,
    latestInspectionByCase,
    shipments,
    casesById,
  } = seededData;

  let data: unknown;
  switch (mode) {
    case "M1":
      data = assembleM1(cases as any[], bounds, filters);
      break;
    case "M2":
      data = assembleM2(cases as any[], missions as any[], bounds, filters);
      break;
    case "M3":
      data = assembleM3(
        cases as any[],
        latestInspectionByCase as Map<string, any>,
        bounds,
        filters
      );
      break;
    case "M4":
      data = assembleM4(
        shipments as any[],
        casesById as Map<string, any>,
        bounds,
        filters
      );
      break;
    case "M5":
      data = assembleM5(
        cases as any[],
        missions as any[],
        /* featureEnabled */ true,
        bounds
      );
      break;
  }

  return { status: 200, body: data, durationMs: performance.now() - t0 };
}

// ─── p50 latency helper ────────────────────────────────────────────────────────

/**
 * Run `fn` exactly `iterations` times, collect durations in ms,
 * and return the 50th-percentile value (median when iterations is odd).
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

// ─── Test suite ───────────────────────────────────────────────────────────────

const SEED_250 = buildSeedDataset(250);
const SEED_500 = buildSeedDataset(500); // latency tests use larger fleet

// ── HTTP request validation ────────────────────────────────────────────────────

describe("GET /api/cases/map — HTTP request validation", () => {
  it("defaults to mode=M1 when no mode param is provided", () => {
    const result = simulateMapApiRequest({}, SEED_250);
    expect(result.status).toBe(200);
    expect((result.body as M1Response).mode).toBe("M1");
  });

  it("returns 400 for an invalid mode", () => {
    const result = simulateMapApiRequest({ mode: "M6" }, SEED_250);
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toMatch(/Invalid mode/i);
  });

  it("accepts all valid modes M1–M5", () => {
    for (const mode of VALID_MODES) {
      const result = simulateMapApiRequest({ mode }, SEED_250);
      expect(result.status).toBe(200);
      expect((result.body as { mode: string }).mode).toBe(mode);
    }
  });

  it("returns 400 for malformed filters JSON", () => {
    const result = simulateMapApiRequest(
      { mode: "M1", filters: "{invalid json" },
      SEED_250
    );
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toMatch(/filters/i);
  });

  it("returns 400 when only some bounds params are provided", () => {
    const result = simulateMapApiRequest(
      { mode: "M1", swLat: "45.0", swLng: "-100.0" }, // missing neLat/neLng
      SEED_250
    );
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toMatch(/bounds/i);
  });

  it("accepts valid bounds with all four params", () => {
    const result = simulateMapApiRequest(
      {
        mode: "M1",
        swLat: "40.0",
        swLng: "-130.0",
        neLat: "50.0",
        neLng: "-60.0",
      },
      SEED_250
    );
    expect(result.status).toBe(200);
  });
});

// ── M1 response shape ─────────────────────────────────────────────────────────

describe("GET /api/cases/map?mode=M1 — response shape", () => {
  let response: M1Response;

  beforeAll(() => {
    response = simulateMapApiRequest({ mode: "M1" }, SEED_250).body as M1Response;
  });

  it("has mode='M1'", () => expect(response.mode).toBe("M1"));
  it("has ts as a number", () => expect(typeof response.ts).toBe("number"));

  it("cases is an array", () =>
    expect(Array.isArray(response.cases)).toBe(true));

  it("each case pin has required fields", () => {
    for (const pin of response.cases) {
      expect(typeof pin._id).toBe("string");
      expect(typeof pin.label).toBe("string");
      expect(typeof pin.status).toBe("string");
      expect(typeof pin.updatedAt).toBe("number");
    }
  });

  it("summary has total, withLocation, byStatus", () => {
    expect(typeof response.summary.total).toBe("number");
    expect(typeof response.summary.withLocation).toBe("number");
    expect(typeof response.summary.byStatus).toBe("object");
  });

  it("summary.total equals the seeded case count (no filter applied)", () => {
    expect(response.summary.total).toBe(SEED_250.cases.length);
  });

  it("byStatus keys are valid case statuses", () => {
    const validStatuses = new Set(CASE_STATUSES);
    for (const key of Object.keys(response.summary.byStatus)) {
      expect(validStatuses.has(key as CaseDoc["status"])).toBe(true);
    }
  });

  it("byStatus counts sum to total", () => {
    const sum = Object.values(response.summary.byStatus).reduce(
      (a, b) => a + b,
      0
    );
    expect(sum).toBe(response.summary.total);
  });
});

// ── M2 response shape ─────────────────────────────────────────────────────────

describe("GET /api/cases/map?mode=M2 — response shape", () => {
  let response: M2Response;

  beforeAll(() => {
    response = simulateMapApiRequest({ mode: "M2" }, SEED_250).body as M2Response;
  });

  it("has mode='M2'", () => expect(response.mode).toBe("M2"));
  it("missions is an array", () =>
    expect(Array.isArray(response.missions)).toBe(true));
  it("unassigned is an array", () =>
    expect(Array.isArray(response.unassigned)).toBe(true));

  it("each mission group has required fields", () => {
    for (const m of response.missions) {
      expect(typeof m._id).toBe("string");
      expect(typeof m.name).toBe("string");
      expect(typeof m.status).toBe("string");
      expect(typeof m.caseCount).toBe("number");
      expect(Array.isArray(m.cases)).toBe(true);
      expect(typeof m.byStatus).toBe("object");
    }
  });

  it("summary has total, totalMissions, byMissionStatus", () => {
    expect(typeof response.summary.total).toBe("number");
    expect(typeof response.summary.totalMissions).toBe("number");
    expect(typeof response.summary.byMissionStatus).toBe("object");
  });

  it("summary.totalMissions equals the seeded mission count", () => {
    expect(response.summary.totalMissions).toBe(SEED_250.missions.length);
  });

  it("mission cases have _id, label, status, updatedAt", () => {
    for (const m of response.missions) {
      for (const c of m.cases) {
        expect(typeof c._id).toBe("string");
        expect(typeof c.label).toBe("string");
        expect(typeof c.status).toBe("string");
        expect(typeof c.updatedAt).toBe("number");
      }
    }
  });
});

// ── M3 response shape ─────────────────────────────────────────────────────────

describe("GET /api/cases/map?mode=M3 — response shape", () => {
  let response: M3Response;

  beforeAll(() => {
    response = simulateMapApiRequest({ mode: "M3" }, SEED_250).body as M3Response;
  });

  it("has mode='M3'", () => expect(response.mode).toBe("M3"));
  it("cases is an array", () =>
    expect(Array.isArray(response.cases)).toBe(true));

  it("only returns deployed or flagged cases", () => {
    for (const pin of response.cases) {
      expect(["deployed", "flagged"]).toContain(pin.status);
    }
  });

  it("each M3 case pin has inspection numeric fields", () => {
    for (const pin of response.cases) {
      expect(typeof pin.checkedItems).toBe("number");
      expect(typeof pin.totalItems).toBe("number");
      expect(typeof pin.damagedItems).toBe("number");
      expect(typeof pin.missingItems).toBe("number");
      expect(typeof pin.inspectionProgress).toBe("number");
    }
  });

  it("inspectionProgress is in range 0–100", () => {
    for (const pin of response.cases) {
      expect(pin.inspectionProgress).toBeGreaterThanOrEqual(0);
      expect(pin.inspectionProgress).toBeLessThanOrEqual(100);
    }
  });

  it("summary has total, byInspectionStatus, totalDamaged, totalMissing", () => {
    expect(typeof response.summary.total).toBe("number");
    expect(typeof response.summary.byInspectionStatus).toBe("object");
    expect(typeof response.summary.totalDamaged).toBe("number");
    expect(typeof response.summary.totalMissing).toBe("number");
  });
});

// ── M4 response shape ─────────────────────────────────────────────────────────

describe("GET /api/cases/map?mode=M4 — response shape", () => {
  let response: M4Response;

  beforeAll(() => {
    response = simulateMapApiRequest({ mode: "M4" }, SEED_250).body as M4Response;
  });

  it("has mode='M4'", () => expect(response.mode).toBe("M4"));
  it("shipments is an array", () =>
    expect(Array.isArray(response.shipments)).toBe(true));

  it("each shipment pin has required fields", () => {
    for (const pin of response.shipments) {
      expect(typeof pin._id).toBe("string");
      expect(typeof pin.caseId).toBe("string");
      expect(typeof pin.caseLabel).toBe("string");
      expect(typeof pin.trackingNumber).toBe("string");
      expect(typeof pin.carrier).toBe("string");
      expect(typeof pin.status).toBe("string");
      expect(typeof pin.origin).toBe("object");
      expect(typeof pin.destination).toBe("object");
      expect(typeof pin.updatedAt).toBe("number");
    }
  });

  it("shipment pin carrier is FedEx", () => {
    for (const pin of response.shipments) {
      expect(pin.carrier).toBe("FedEx");
    }
  });

  it("summary has total, byStatus, inTransit", () => {
    expect(typeof response.summary.total).toBe("number");
    expect(typeof response.summary.byStatus).toBe("object");
    expect(typeof response.summary.inTransit).toBe("number");
  });

  it("summary.total equals total seeded shipment count", () => {
    expect(response.summary.total).toBe(SEED_250.shipments.length);
  });

  it("shipment case labels are resolved (not 'Unknown')", () => {
    // All seeded shipments have a matching case
    for (const pin of response.shipments) {
      expect(pin.caseLabel).not.toBe("Unknown");
    }
  });
});

// ── M5 response shape ─────────────────────────────────────────────────────────

describe("GET /api/cases/map?mode=M5 — response shape", () => {
  let response: M5Response;
  let disabledResponse: M5Response;

  beforeAll(() => {
    response = simulateMapApiRequest({ mode: "M5" }, SEED_250).body as M5Response;

    // Test feature-disabled path
    const { cases, missions } = SEED_250;
    disabledResponse = assembleM5(
      cases as any[],
      missions as any[],
      false,
      null
    ) as M5Response;
  });

  it("has mode='M5'", () => expect(response.mode).toBe("M5"));
  it("featureEnabled is a boolean", () =>
    expect(typeof response.featureEnabled).toBe("boolean"));
  it("clusters is an array", () =>
    expect(Array.isArray(response.clusters)).toBe(true));
  it("heatmap is an array", () =>
    expect(Array.isArray(response.heatmap)).toBe(true));
  it("timeline has startTs, endTs, snapshots", () => {
    expect(typeof response.timeline.startTs).toBe("number");
    expect(typeof response.timeline.endTs).toBe("number");
    expect(Array.isArray(response.timeline.snapshots)).toBe(true);
  });

  it("each cluster has lat, lng, count, radius, byStatus, missionIds", () => {
    for (const cluster of response.clusters) {
      expect(typeof cluster.lat).toBe("number");
      expect(typeof cluster.lng).toBe("number");
      expect(typeof cluster.count).toBe("number");
      expect(typeof cluster.radius).toBe("number");
      expect(typeof cluster.byStatus).toBe("object");
      expect(Array.isArray(cluster.missionIds)).toBe(true);
    }
  });

  it("each heatmap point has lat, lng, weight (0–1)", () => {
    for (const pt of response.heatmap) {
      expect(typeof pt.lat).toBe("number");
      expect(typeof pt.lng).toBe("number");
      expect(pt.weight).toBeGreaterThanOrEqual(0);
      expect(pt.weight).toBeLessThanOrEqual(1);
    }
  });

  it("summary has totalCases, totalMissions, activeMissions, byStatus", () => {
    expect(typeof response.summary.totalCases).toBe("number");
    expect(typeof response.summary.totalMissions).toBe("number");
    expect(typeof response.summary.activeMissions).toBe("number");
    expect(typeof response.summary.byStatus).toBe("object");
  });

  it("when featureEnabled=false, clusters and heatmap are empty", () => {
    expect(disabledResponse.featureEnabled).toBe(false);
    expect(disabledResponse.clusters).toHaveLength(0);
    expect(disabledResponse.heatmap).toHaveLength(0);
    expect(disabledResponse.timeline.snapshots).toHaveLength(0);
  });
});

// ── Bounds filtering ──────────────────────────────────────────────────────────

describe("GET /api/cases/map — bounds filtering", () => {
  it("M1: only returns cases within the bounding box", () => {
    // Pacific Northwest bounding box — captures some seeded cases
    const result = simulateMapApiRequest(
      {
        mode: "M1",
        swLat: "46.0",
        swLng: "-125.0",
        neLat: "50.0",
        neLng: "-119.0",
      },
      SEED_250
    );
    expect(result.status).toBe(200);
    const body = result.body as M1Response;
    // All returned cases must be within the box
    for (const pin of body.cases) {
      if (pin.lat !== undefined) {
        expect(pin.lat).toBeGreaterThanOrEqual(46.0);
        expect(pin.lat).toBeLessThanOrEqual(50.0);
      }
      if (pin.lng !== undefined) {
        expect(pin.lng).toBeGreaterThanOrEqual(-125.0);
        expect(pin.lng).toBeLessThanOrEqual(-119.0);
      }
    }
  });

  it("M4: empty bbox returns no shipments", () => {
    // Ocean bounding box — no seeded cases there
    const result = simulateMapApiRequest(
      {
        mode: "M4",
        swLat: "0.0",
        swLng: "0.0",
        neLat: "1.0",
        neLng: "1.0",
      },
      SEED_250
    );
    expect(result.status).toBe(200);
    expect((result.body as M4Response).shipments).toHaveLength(0);
  });
});

// ── Status filter ─────────────────────────────────────────────────────────────

describe("GET /api/cases/map — filter params", () => {
  it("M1: status filter returns only matching cases", () => {
    const result = simulateMapApiRequest(
      {
        mode: "M1",
        filters: JSON.stringify({ status: ["assembled"] }),
      },
      SEED_250
    );
    expect(result.status).toBe(200);
    const body = result.body as M1Response;
    for (const pin of body.cases) {
      expect(pin.status).toBe("assembled");
    }
  });

  it("M1: missionId filter scopes to cases on that mission", () => {
    const missionId = SEED_250.missions[0]._id;
    const result = simulateMapApiRequest(
      {
        mode: "M1",
        filters: JSON.stringify({ missionId }),
      },
      SEED_250
    );
    expect(result.status).toBe(200);
    const body = result.body as M1Response;
    for (const pin of body.cases) {
      expect(pin.missionId).toBe(missionId);
    }
  });

  it("M1: assigneeId filter scopes to cases for that assignee", () => {
    const assigneeId = "user_3";
    const result = simulateMapApiRequest(
      {
        mode: "M1",
        filters: JSON.stringify({ assigneeId }),
      },
      SEED_250
    );
    expect(result.status).toBe(200);
    const body = result.body as M1Response;
    for (const pin of body.cases) {
      // Pins in response should belong to this assignee
      // (assigneeId not included in M1CasePin — verify via seeded data)
      const caseDoc = SEED_250.cases.find((c) => c._id === pin._id);
      expect(caseDoc?.assigneeId).toBe(assigneeId);
    }
  });
});

// ── p50 latency assertions (500-case fleet) ────────────────────────────────────

describe("GET /api/cases/map — p50 latency < 200ms", () => {
  const ITERATIONS = 101;
  const P50_BUDGET_MS = 200;

  it("M1 assembly p50 < 200ms (500 cases)", () => {
    const { cases } = SEED_500;
    const bounds: MapBounds | null = null;
    const filters: ParsedFilters = {};
    const p50 = measureP50(
      () => assembleM1(cases as any[], bounds, filters),
      ITERATIONS
    );
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it("M2 assembly p50 < 200ms (500 cases, 5 missions)", () => {
    const { cases, missions } = SEED_500;
    const p50 = measureP50(
      () => assembleM2(cases as any[], missions as any[], null, {}),
      ITERATIONS
    );
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it("M3 assembly p50 < 200ms (500 cases, inspections map)", () => {
    const { cases, latestInspectionByCase } = SEED_500;
    const p50 = measureP50(
      () =>
        assembleM3(
          cases as any[],
          latestInspectionByCase as Map<string, any>,
          null,
          {}
        ),
      ITERATIONS
    );
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it("M4 assembly p50 < 200ms (500 cases, shipments)", () => {
    const { shipments, casesById } = SEED_500;
    const p50 = measureP50(
      () =>
        assembleM4(
          shipments as any[],
          casesById as Map<string, any>,
          null,
          {}
        ),
      ITERATIONS
    );
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it("M5 assembly p50 < 200ms (500 cases, 5 missions, feature enabled)", () => {
    const { cases, missions } = SEED_500;
    const p50 = measureP50(
      () => assembleM5(cases as any[], missions as any[], true, null),
      ITERATIONS
    );
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });

  it("full HTTP pipeline (parse + validate + assemble) p50 < 200ms", () => {
    const p50 = measureP50(
      () => simulateMapApiRequest({ mode: "M1" }, SEED_500),
      ITERATIONS
    );
    expect(p50).toBeLessThan(P50_BUDGET_MS);
  });
});
