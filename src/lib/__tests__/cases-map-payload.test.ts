/**
 * Unit tests for the getCasesMapPayload business logic (Sub-AC 2).
 *
 * Tests the pure computations performed inside the getCasesMapPayload query:
 *   1. CaseModeFlags — pre-computed boolean flags for each map mode
 *   2. CaseInspectionSummary — denormalized inspection progress
 *   3. Summary aggregation — global fleet counts (total, withLocation, etc.)
 *   4. Spatial (bounds) filtering logic
 *   5. Status/assignee/mission filter logic
 *
 * These tests operate on plain TypeScript objects mirroring the Convex
 * Doc shapes — no Convex runtime is needed.
 *
 * Covers the acceptance criterion requirement:
 *   "Implement the Convex query function that aggregates all map-relevant
 *    case fields (id, coordinates, status, mode flags) into a single
 *    denormalized payload"
 */

import { describe, it, expect } from "vitest";
import type {
  CaseModeFlags,
  CaseInspectionSummary,
  CaseMapPayload,
  CasesMapPayloadResponse,
  CaseStatusLiteral,
} from "../../types/cases-map";

// ─── Test data factories ───────────────────────────────────────────────────────

/** Minimal case-like object for testing mode flag computation. */
interface MiniCase {
  _id: string;
  label: string;
  qrCode: string;
  status: CaseStatusLiteral;
  lat?: number;
  lng?: number;
  locationName?: string;
  missionId?: string;
  assigneeId?: string;
  assigneeName?: string;
  trackingNumber?: string;
  carrier?: string;
  shippedAt?: number;
  destinationName?: string;
  destinationLat?: number;
  destinationLng?: number;
  updatedAt: number;
  createdAt: number;
}

/** Minimal inspection-like object for denormalization tests. */
interface MiniInspection {
  _id: string;
  caseId: string;
  _creationTime: number;
  status: "pending" | "in_progress" | "completed" | "flagged";
  inspectorName: string;
  totalItems: number;
  checkedItems: number;
  damagedItems: number;
  missingItems: number;
}

function makeCase(overrides: Partial<MiniCase> = {}): MiniCase {
  return {
    _id: "case_test_001",
    label: "CASE-0001",
    qrCode: "QR-CASE-0001",
    status: "hangar",
    updatedAt: 1_700_000_000_000,
    createdAt: 1_699_000_000_000,
    ...overrides,
  };
}

function makeInspection(overrides: Partial<MiniInspection> = {}): MiniInspection {
  return {
    _id: "insp_001",
    caseId: "case_test_001",
    _creationTime: 1_700_000_000_000,
    status: "in_progress",
    inspectorName: "Alice Tester",
    totalItems: 10,
    checkedItems: 7,
    damagedItems: 1,
    missingItems: 0,
    ...overrides,
  };
}

// ─── Pure mode flag computation (mirrors getCasesMapPayload logic) ─────────────

/**
 * Pure function extracted from getCasesMapPayload handler.
 * Computes CaseModeFlags from a case's status and field values.
 */
function computeModeFlags(c: MiniCase): CaseModeFlags {
  const caseIsInTransit =
    c.status === "transit_out" ||
    c.status === "transit_in" ||
    c.trackingNumber !== undefined;

  return {
    isFleetVisible:    true,
    isMissionAssigned: c.missionId !== undefined,
    isFieldActive:     c.status === "deployed" || c.status === "flagged",
    isInTransit:       caseIsInTransit,
    hasCoordinates:    c.lat !== undefined && c.lng !== undefined,
  };
}

/**
 * Pure function extracted from getCasesMapPayload handler.
 * Computes CaseInspectionSummary from an inspection row.
 */
function computeInspectionSummary(
  ins: MiniInspection
): CaseInspectionSummary {
  const totalItems   = ins.totalItems   ?? 0;
  const checkedItems = ins.checkedItems ?? 0;
  return {
    inspectionId:  ins._id,
    status:        ins.status,
    inspectorName: ins.inspectorName,
    checkedItems,
    totalItems,
    damagedItems:  ins.damagedItems ?? 0,
    missingItems:  ins.missingItems  ?? 0,
    progress:
      totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0,
  };
}

/**
 * Pure summary aggregation extracted from getCasesMapPayload handler.
 */
function computeSummary(cases: MiniCase[]) {
  const byStatus: Partial<Record<CaseStatusLiteral, number>> = {};
  let withLocation = 0;
  let fieldActive = 0;
  let inTransit = 0;
  let missionAssigned = 0;

  for (const c of cases) {
    byStatus[c.status] = ((byStatus[c.status] ?? 0) as number) + 1;
    if (c.lat !== undefined && c.lng !== undefined) withLocation++;
    if (c.status === "deployed" || c.status === "flagged") fieldActive++;
    if (
      c.status === "transit_out" ||
      c.status === "transit_in" ||
      c.trackingNumber !== undefined
    ) {
      inTransit++;
    }
    if (c.missionId !== undefined) missionAssigned++;
  }

  return {
    total: cases.length,
    withLocation,
    byStatus,
    fieldActive,
    inTransit,
    missionAssigned,
  };
}

/**
 * Pure bounds check extracted from maps.ts withinBounds helper.
 */
function withinBounds(
  lat: number | undefined,
  lng: number | undefined,
  bounds: { swLat: number; swLng: number; neLat: number; neLng: number } | null
): boolean {
  if (!bounds || lat === undefined || lng === undefined) return true;
  return (
    lat >= bounds.swLat &&
    lat <= bounds.neLat &&
    lng >= bounds.swLng &&
    lng <= bounds.neLng
  );
}

// ─── CaseModeFlags tests ───────────────────────────────────────────────────────

describe("CaseModeFlags computation", () => {
  describe("isFleetVisible", () => {
    it("is always true for every case status", () => {
      const statuses: CaseStatusLiteral[] = [
        "hangar", "assembled", "transit_out", "deployed",
        "flagged", "recalled", "transit_in", "received", "archived",
      ];
      for (const status of statuses) {
        const flags = computeModeFlags(makeCase({ status }));
        expect(flags.isFleetVisible).toBe(true);
      }
    });

    it("is true even for archived cases with no position", () => {
      const flags = computeModeFlags(makeCase({ status: "archived" }));
      expect(flags.isFleetVisible).toBe(true);
    });
  });

  describe("isMissionAssigned", () => {
    it("is false when missionId is undefined", () => {
      const flags = computeModeFlags(makeCase({ missionId: undefined }));
      expect(flags.isMissionAssigned).toBe(false);
    });

    it("is true when missionId is set", () => {
      const flags = computeModeFlags(makeCase({ missionId: "mission_abc123" }));
      expect(flags.isMissionAssigned).toBe(true);
    });

    it("is true regardless of the case status", () => {
      const flags = computeModeFlags(
        makeCase({ missionId: "mission_xyz", status: "hangar" })
      );
      expect(flags.isMissionAssigned).toBe(true);
    });
  });

  describe("isFieldActive", () => {
    it("is true for status 'deployed'", () => {
      const flags = computeModeFlags(makeCase({ status: "deployed" }));
      expect(flags.isFieldActive).toBe(true);
    });

    it("is true for status 'flagged'", () => {
      const flags = computeModeFlags(makeCase({ status: "flagged" }));
      expect(flags.isFieldActive).toBe(true);
    });

    it("is false for all non-field statuses", () => {
      const nonFieldStatuses: CaseStatusLiteral[] = [
        "hangar", "assembled", "transit_out", "transit_in", "received", "archived",
      ];
      for (const status of nonFieldStatuses) {
        const flags = computeModeFlags(makeCase({ status }));
        expect(flags.isFieldActive).toBe(false);
      }
    });
  });

  describe("isInTransit", () => {
    it("is true for status 'transit_out'", () => {
      const flags = computeModeFlags(makeCase({ status: "transit_out" }));
      expect(flags.isInTransit).toBe(true);
    });

    it("is true for status 'transit_in'", () => {
      const flags = computeModeFlags(makeCase({ status: "transit_in" }));
      expect(flags.isInTransit).toBe(true);
    });

    it("is true when trackingNumber is present (regardless of status)", () => {
      const flags = computeModeFlags(
        makeCase({ status: "deployed", trackingNumber: "794644823741" })
      );
      expect(flags.isInTransit).toBe(true);
    });

    it("is false when status is not transit and no trackingNumber", () => {
      const flags = computeModeFlags(
        makeCase({ status: "deployed", trackingNumber: undefined })
      );
      expect(flags.isInTransit).toBe(false);
    });

    it("is false for hangar with no tracking number", () => {
      const flags = computeModeFlags(makeCase({ status: "hangar" }));
      expect(flags.isInTransit).toBe(false);
    });

    it("is true for assembled cases that have been shipped (have trackingNumber)", () => {
      const flags = computeModeFlags(
        makeCase({ status: "assembled", trackingNumber: "123456789012" })
      );
      expect(flags.isInTransit).toBe(true);
    });
  });

  describe("hasCoordinates", () => {
    it("is true when both lat and lng are present", () => {
      const flags = computeModeFlags(
        makeCase({ lat: 47.606, lng: -122.332 })
      );
      expect(flags.hasCoordinates).toBe(true);
    });

    it("is false when lat is undefined", () => {
      const flags = computeModeFlags(
        makeCase({ lat: undefined, lng: -122.332 })
      );
      expect(flags.hasCoordinates).toBe(false);
    });

    it("is false when lng is undefined", () => {
      const flags = computeModeFlags(
        makeCase({ lat: 47.606, lng: undefined })
      );
      expect(flags.hasCoordinates).toBe(false);
    });

    it("is false when both lat and lng are undefined", () => {
      const flags = computeModeFlags(makeCase());
      expect(flags.hasCoordinates).toBe(false);
    });

    it("is true for cases near the equator/prime-meridian", () => {
      const flags = computeModeFlags(makeCase({ lat: 0, lng: 0 }));
      // Both are 0 (truthy check would fail; undefined check is correct)
      expect(flags.hasCoordinates).toBe(true);
    });
  });

  describe("combined mode flags consistency", () => {
    it("a deployed case with coordinates is field-active AND has-coordinates", () => {
      const flags = computeModeFlags(
        makeCase({ status: "deployed", lat: 40.7128, lng: -74.006 })
      );
      expect(flags.isFieldActive).toBe(true);
      expect(flags.hasCoordinates).toBe(true);
      expect(flags.isFleetVisible).toBe(true);
      expect(flags.isInTransit).toBe(false);
      expect(flags.isMissionAssigned).toBe(false);
    });

    it("a case in transit with a mission and tracking number has multiple flags set", () => {
      const flags = computeModeFlags(
        makeCase({
          status: "transit_out",
          missionId: "mission_123",
          trackingNumber: "987654321098",
          lat: 51.507,
          lng: -0.127,
        })
      );
      expect(flags.isFleetVisible).toBe(true);
      expect(flags.isMissionAssigned).toBe(true);
      expect(flags.isFieldActive).toBe(false);
      expect(flags.isInTransit).toBe(true);
      expect(flags.hasCoordinates).toBe(true);
    });
  });
});

// ─── CaseInspectionSummary tests ──────────────────────────────────────────────

describe("CaseInspectionSummary computation", () => {
  it("computes progress correctly for partial completion", () => {
    const summary = computeInspectionSummary(
      makeInspection({ totalItems: 10, checkedItems: 7 })
    );
    expect(summary.progress).toBe(70);
  });

  it("computes progress as 0 when totalItems is 0", () => {
    const summary = computeInspectionSummary(
      makeInspection({ totalItems: 0, checkedItems: 0 })
    );
    expect(summary.progress).toBe(0);
  });

  it("computes progress as 100 when all items checked", () => {
    const summary = computeInspectionSummary(
      makeInspection({ totalItems: 8, checkedItems: 8 })
    );
    expect(summary.progress).toBe(100);
  });

  it("rounds progress to nearest integer", () => {
    // 7/9 = 77.77... → rounds to 78
    const summary = computeInspectionSummary(
      makeInspection({ totalItems: 9, checkedItems: 7 })
    );
    expect(summary.progress).toBe(78);
  });

  it("passes through status, inspectorName, damage counts", () => {
    const summary = computeInspectionSummary(
      makeInspection({
        status: "flagged",
        inspectorName: "Bob Inspector",
        damagedItems: 3,
        missingItems: 1,
      })
    );
    expect(summary.status).toBe("flagged");
    expect(summary.inspectorName).toBe("Bob Inspector");
    expect(summary.damagedItems).toBe(3);
    expect(summary.missingItems).toBe(1);
  });

  it("maps inspection _id to inspectionId string", () => {
    const summary = computeInspectionSummary(
      makeInspection({ _id: "insp_xyz789" })
    );
    expect(summary.inspectionId).toBe("insp_xyz789");
  });

  it("handles inspection with all items damaged", () => {
    const summary = computeInspectionSummary(
      makeInspection({
        totalItems: 5,
        checkedItems: 5,
        damagedItems: 5,
        missingItems: 0,
      })
    );
    expect(summary.progress).toBe(100);
    expect(summary.damagedItems).toBe(5);
  });
});

// ─── Summary aggregation tests ─────────────────────────────────────────────────

describe("Summary aggregation", () => {
  it("counts total correctly for an empty fleet", () => {
    const summary = computeSummary([]);
    expect(summary.total).toBe(0);
    expect(summary.withLocation).toBe(0);
    expect(summary.fieldActive).toBe(0);
    expect(summary.inTransit).toBe(0);
    expect(summary.missionAssigned).toBe(0);
    expect(summary.byStatus).toEqual({});
  });

  it("counts total correctly for a single case", () => {
    const summary = computeSummary([makeCase({ status: "hangar" })]);
    expect(summary.total).toBe(1);
    expect(summary.byStatus).toEqual({ hangar: 1 });
  });

  it("counts withLocation only for cases with both lat and lng", () => {
    const cases = [
      makeCase({ lat: 47.6, lng: -122.3 }),        // has location
      makeCase({ _id: "c2", lat: undefined }),        // no lat
      makeCase({ _id: "c3", lng: undefined }),        // no lng
      makeCase({ _id: "c4", lat: 40.7, lng: -74.0 }), // has location
    ];
    const summary = computeSummary(cases);
    expect(summary.withLocation).toBe(2);
  });

  it("counts fieldActive for deployed and flagged cases only", () => {
    const cases = [
      makeCase({ status: "deployed" }),
      makeCase({ _id: "c2", status: "flagged" }),
      makeCase({ _id: "c3", status: "hangar" }),
      makeCase({ _id: "c4", status: "assembled" }),
      makeCase({ _id: "c5", status: "deployed" }),
    ];
    const summary = computeSummary(cases);
    expect(summary.fieldActive).toBe(3);
  });

  it("counts inTransit for transit_out, transit_in, and cases with trackingNumber", () => {
    const cases = [
      makeCase({ status: "transit_out" }),
      makeCase({ _id: "c2", status: "transit_in" }),
      makeCase({ _id: "c3", status: "deployed", trackingNumber: "111" }),
      makeCase({ _id: "c4", status: "hangar" }),           // neither
    ];
    const summary = computeSummary(cases);
    expect(summary.inTransit).toBe(3);
  });

  it("counts missionAssigned for cases with any missionId", () => {
    const cases = [
      makeCase({ missionId: "mission_1" }),
      makeCase({ _id: "c2", missionId: "mission_2" }),
      makeCase({ _id: "c3" }),                           // no mission
    ];
    const summary = computeSummary(cases);
    expect(summary.missionAssigned).toBe(2);
  });

  it("builds byStatus as a sparse map (no zero-count keys)", () => {
    const cases = [
      makeCase({ status: "hangar" }),
      makeCase({ _id: "c2", status: "hangar" }),
      makeCase({ _id: "c3", status: "deployed" }),
    ];
    const summary = computeSummary(cases);
    expect(summary.byStatus).toEqual({ hangar: 2, deployed: 1 });
    // Statuses with no cases should not appear as keys
    expect("assembled" in summary.byStatus).toBe(false);
    expect("archived" in summary.byStatus).toBe(false);
  });

  it("counts all statuses in a mixed fleet correctly", () => {
    const cases: MiniCase[] = [
      makeCase({ status: "hangar" }),
      makeCase({ _id: "c2", status: "assembled" }),
      makeCase({ _id: "c3", status: "transit_out" }),
      makeCase({ _id: "c4", status: "deployed" }),
      makeCase({ _id: "c5", status: "flagged" }),
      makeCase({ _id: "c6", status: "transit_in" }),
      makeCase({ _id: "c7", status: "received" }),
      makeCase({ _id: "c8", status: "archived" }),
    ];
    const summary = computeSummary(cases);
    expect(summary.total).toBe(8);
    expect(summary.byStatus).toEqual({
      hangar:      1,
      assembled:   1,
      transit_out: 1,
      deployed:    1,
      flagged:     1,
      transit_in:  1,
      received:    1,
      archived:    1,
    });
  });
});

// ─── Spatial bounds filter tests ──────────────────────────────────────────────

describe("withinBounds spatial filtering", () => {
  const bbox = { swLat: 40.0, swLng: -80.0, neLat: 50.0, neLng: -70.0 };

  it("returns true when bounds is null (no spatial filter)", () => {
    expect(withinBounds(45.0, -75.0, null)).toBe(true);
  });

  it("returns true when lat is undefined (case has no location)", () => {
    expect(withinBounds(undefined, -75.0, bbox)).toBe(true);
  });

  it("returns true when lng is undefined", () => {
    expect(withinBounds(45.0, undefined, bbox)).toBe(true);
  });

  it("returns true for a point inside the bounds", () => {
    expect(withinBounds(45.0, -75.0, bbox)).toBe(true);
  });

  it("returns true for a point on the SW corner (inclusive)", () => {
    expect(withinBounds(40.0, -80.0, bbox)).toBe(true);
  });

  it("returns true for a point on the NE corner (inclusive)", () => {
    expect(withinBounds(50.0, -70.0, bbox)).toBe(true);
  });

  it("returns false for a point north of the bounds", () => {
    expect(withinBounds(51.0, -75.0, bbox)).toBe(false);
  });

  it("returns false for a point south of the bounds", () => {
    expect(withinBounds(39.0, -75.0, bbox)).toBe(false);
  });

  it("returns false for a point east of the bounds", () => {
    expect(withinBounds(45.0, -65.0, bbox)).toBe(false);
  });

  it("returns false for a point west of the bounds", () => {
    expect(withinBounds(45.0, -85.0, bbox)).toBe(false);
  });
});

// ─── CaseMapPayload shape tests ───────────────────────────────────────────────

describe("CaseMapPayload structure", () => {
  /**
   * Build a complete CaseMapPayload from a case + optional inspection + optional custody.
   * Mirrors the return shape from the getCasesMapPayload query handler.
   */
  function buildPayload(
    c: MiniCase,
    inspection?: MiniInspection,
    custody?: { toUserId: string; toUserName: string; transferredAt: number }
  ): CaseMapPayload {
    const id = c._id;
    const modeFlags = computeModeFlags(c);
    const inspectionSummary = inspection
      ? computeInspectionSummary(inspection)
      : undefined;

    return {
      id,
      label:   c.label,
      qrCode:  c.qrCode,
      status:  c.status,
      lat:     c.lat,
      lng:     c.lng,
      locationName: c.locationName,
      modeFlags,
      assigneeId:   c.assigneeId,
      assigneeName: c.assigneeName,
      missionId:    c.missionId,
      currentCustodianId:   custody?.toUserId   ?? c.assigneeId,
      currentCustodianName: custody?.toUserName ?? c.assigneeName,
      custodyTransferredAt: custody?.transferredAt,
      inspection: inspectionSummary,
      trackingNumber:  c.trackingNumber,
      carrier:         c.carrier,
      shippedAt:       c.shippedAt,
      destinationName: c.destinationName,
      destinationLat:  c.destinationLat,
      destinationLng:  c.destinationLng,
      updatedAt: c.updatedAt,
      createdAt: c.createdAt,
    };
  }

  it("includes all required identity fields", () => {
    const c = makeCase({ _id: "case_001", label: "CASE-001", qrCode: "QR-001" });
    const payload = buildPayload(c);
    expect(payload.id).toBe("case_001");
    expect(payload.label).toBe("CASE-001");
    expect(payload.qrCode).toBe("QR-001");
  });

  it("includes status as a CaseStatusLiteral", () => {
    const c = makeCase({ status: "deployed" });
    const payload = buildPayload(c);
    expect(payload.status).toBe("deployed");
  });

  it("includes modeFlags with correct values for a deployed case", () => {
    const c = makeCase({ status: "deployed", lat: 40.0, lng: -74.0 });
    const payload = buildPayload(c);
    expect(payload.modeFlags.isFleetVisible).toBe(true);
    expect(payload.modeFlags.isFieldActive).toBe(true);
    expect(payload.modeFlags.hasCoordinates).toBe(true);
    expect(payload.modeFlags.isInTransit).toBe(false);
  });

  it("has inspection as undefined when no inspection provided", () => {
    const c = makeCase();
    const payload = buildPayload(c, undefined);
    expect(payload.inspection).toBeUndefined();
  });

  it("has inspection summary when inspection is provided", () => {
    const c = makeCase();
    const ins = makeInspection({ totalItems: 10, checkedItems: 5 });
    const payload = buildPayload(c, ins);
    expect(payload.inspection).toBeDefined();
    expect(payload.inspection!.progress).toBe(50);
    expect(payload.inspection!.totalItems).toBe(10);
  });

  it("resolves currentCustodianId from custody record when available", () => {
    const c = makeCase({ assigneeId: "user_assignee", assigneeName: "Assigned User" });
    const custody = {
      toUserId:      "user_custodian",
      toUserName:    "Current Custodian",
      transferredAt: 1_700_000_100_000,
    };
    const payload = buildPayload(c, undefined, custody);
    expect(payload.currentCustodianId).toBe("user_custodian");
    expect(payload.currentCustodianName).toBe("Current Custodian");
    expect(payload.custodyTransferredAt).toBe(1_700_000_100_000);
  });

  it("falls back to assigneeId/assigneeName when no custody record exists", () => {
    const c = makeCase({ assigneeId: "user_001", assigneeName: "John Doe" });
    const payload = buildPayload(c, undefined, undefined);
    expect(payload.currentCustodianId).toBe("user_001");
    expect(payload.currentCustodianName).toBe("John Doe");
    expect(payload.custodyTransferredAt).toBeUndefined();
  });

  it("passes through shipping fields from the cases table", () => {
    const c = makeCase({
      trackingNumber:  "794644823741",
      carrier:         "FedEx",
      shippedAt:       1_700_000_050_000,
      destinationName: "SkySpecs HQ",
      destinationLat:  42.279,
      destinationLng:  -83.732,
    });
    const payload = buildPayload(c);
    expect(payload.trackingNumber).toBe("794644823741");
    expect(payload.carrier).toBe("FedEx");
    expect(payload.shippedAt).toBe(1_700_000_050_000);
    expect(payload.destinationName).toBe("SkySpecs HQ");
    expect(payload.destinationLat).toBe(42.279);
    expect(payload.destinationLng).toBe(-83.732);
  });

  it("passes through timestamps", () => {
    const c = makeCase({
      updatedAt: 1_700_500_000_000,
      createdAt: 1_699_000_000_000,
    });
    const payload = buildPayload(c);
    expect(payload.updatedAt).toBe(1_700_500_000_000);
    expect(payload.createdAt).toBe(1_699_000_000_000);
  });
});

// ─── CasesMapPayloadResponse shape tests ─────────────────────────────────────

describe("CasesMapPayloadResponse shape", () => {
  it("has the required top-level fields: ts, cases, summary", () => {
    const response: CasesMapPayloadResponse = {
      ts: Date.now(),
      cases: [],
      summary: {
        total: 0,
        withLocation: 0,
        byStatus: {},
        fieldActive: 0,
        inTransit: 0,
        missionAssigned: 0,
      },
    };
    expect(typeof response.ts).toBe("number");
    expect(Array.isArray(response.cases)).toBe(true);
    expect(response.summary.total).toBe(0);
  });

  it("summary fieldActive + inTransit match mode flag counts in cases", () => {
    // Build a mini-fleet and verify summary matches per-case flag counts
    const casesInput = [
      makeCase({ status: "deployed", lat: 10, lng: 20 }),
      makeCase({ _id: "c2", status: "flagged" }),
      makeCase({ _id: "c3", status: "transit_out" }),
      makeCase({ _id: "c4", status: "hangar" }),
    ];

    const summary = computeSummary(casesInput);
    const allFlags = casesInput.map(computeModeFlags);

    const flagFieldActive = allFlags.filter((f) => f.isFieldActive).length;
    const flagInTransit   = allFlags.filter((f) => f.isInTransit).length;

    expect(summary.fieldActive).toBe(flagFieldActive);
    expect(summary.inTransit).toBe(flagInTransit);
  });
});
