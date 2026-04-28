// @vitest-environment jsdom

/**
 * Unit tests: checklist item completion telemetry in ScanInspectClient.
 *
 * Verifies that the correct SCAN_ACTION_ITEM_CHECKED telemetry event is
 * emitted every time a checklist item is toggled (spec §23).
 *
 * Per-event fields verified:
 *   • eventCategory = "user_action"
 *   • eventName     = SCAN_ACTION_ITEM_CHECKED
 *   • app           = "scan"
 *   • caseId        — the case the inspection belongs to
 *   • manifestItemId — the Convex manifestItems row _id
 *   • templateItemId — the stable template item identifier
 *   • newStatus      — status the item was transitioned INTO
 *   • previousStatus — status the item was in BEFORE the toggle
 *   • itemIndex      — 0-based position in the full items array
 *   • totalItems     — total items from the live summary
 *   • userId         — from the current user identity (useCurrentUser)
 *
 * Strategy
 * ────────
 * • `trackEvent` is mocked at module level so we can assert on emitted
 *   events without any real transport or Convex backend.
 * • `convex/react` (useQuery, useMutation) are mocked to return a controlled
 *   checklist state so the component renders immediately without loading state.
 * • `api.scan.updateChecklistItem` resolves successfully so the telemetry
 *   code path (which runs after the mutation) is exercised.
 * • Tests use `waitFor` to account for the async mutation + telemetry sequence.
 *
 * Covered scenarios
 * ─────────────────
 *  1. Mark item OK       → SCAN_ACTION_ITEM_CHECKED with newStatus="ok"
 *  2. Mark item damaged  → SCAN_ACTION_ITEM_CHECKED with newStatus="damaged"
 *  3. Mark item missing  → SCAN_ACTION_ITEM_CHECKED with newStatus="missing"
 *  4. Revert to unchecked (Undo) → SCAN_ACTION_ITEM_CHECKED with newStatus="unchecked"
 *  5. previousStatus reflects item state before toggle
 *  6. manifestItemId (Convex _id) is included in the event
 *  7. caseId prop is included in the event
 *  8. templateItemId is included in the event
 *  9. itemIndex is the 0-based position in the full items array
 * 10. totalItems from the live summary is included
 * 11. userId from useCurrentUser is included
 * 12. eventCategory = "user_action" and app = "scan"
 * 13. No telemetry emitted when mutation rejects
 * 14. Second item in the list has itemIndex = 1
 */

import React from "react";
import {
  render,
  fireEvent,
  screen,
  waitFor,
  within,
  cleanup,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelemetryEventName } from "@/types/telemetry.types";

// ─── Mock telemetry (spy on trackEvent, never hit transport) ──────────────────

const mockTrackEvent = vi.fn();

vi.mock("@/lib/telemetry.lib", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  telemetry: {
    track: vi.fn(),
    identify: vi.fn(),
    flush: vi.fn(),
  },
}));

// ─── Mock convex/react ────────────────────────────────────────────────────────

vi.mock("convex/react", () => ({
  useQuery:    vi.fn(),
  useMutation: vi.fn(),
}));

// ─── Mock the Convex generated API ───────────────────────────────────────────

vi.mock("../../../../../../convex/_generated/api", () => ({
  api: {
    checklists: {
      getChecklistWithInspection: "checklists:getChecklistWithInspection",
    },
    scan: {
      updateChecklistItem: "scan:updateChecklistItem",
      completeInspection:  "scan:completeInspection",
    },
  },
}));

// ─── Import SUT and mocked modules (after vi.mock hoisting) ──────────────────

import { useQuery, useMutation } from "convex/react";
import { ScanInspectClient } from "../ScanInspectClient";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_ID           = "case_telemetry_inspect_test";
const MANIFEST_ID_1     = "manifest_item_id_001";
const MANIFEST_ID_2     = "manifest_item_id_002";
const TEMPLATE_ID_1     = "template-item-battery";
const TEMPLATE_ID_2     = "template-item-drone-body";

/**
 * Default mock checklist state returned by useChecklistWithInspection.
 * Items are sorted by name (Battery Pack < Drone Body):
 *   index 0 → Battery Pack (unchecked)
 *   index 1 → Drone Body   (ok — already reviewed)
 */
const MOCK_STATE = {
  items: [
    {
      _id:            MANIFEST_ID_1,
      _creationTime:  1_700_000_000_000,
      caseId:         CASE_ID,
      templateItemId: TEMPLATE_ID_1,
      name:           "Battery Pack",
      status:         "unchecked" as const,
    },
    {
      _id:            MANIFEST_ID_2,
      _creationTime:  1_700_000_001_000,
      caseId:         CASE_ID,
      templateItemId: TEMPLATE_ID_2,
      name:           "Drone Body",
      status:         "ok" as const,
    },
  ],
  inspection: {
    _id:           "inspection_001",
    _creationTime: 1_700_000_000_000,
    status:        "in_progress",
    inspectorId:   "scan-user",
    inspectorName: "Field Technician",
    totalItems:    2,
    checkedItems:  1,
    damagedItems:  0,
    missingItems:  0,
  },
  summary: {
    caseId:      CASE_ID,
    total:       2,
    unchecked:   1,
    ok:          1,
    damaged:     0,
    missing:     0,
    progressPct: 50,
    isComplete:  false,
  },
};

// ─── Mock mutation factories ───────────────────────────────────────────────────

/** Returns a resolving updateChecklistItem mock. */
function makeUpdateMock() {
  return vi.fn().mockResolvedValue({
    itemId:              MANIFEST_ID_1,
    previousStatus:      "unchecked",
    newStatus:           "ok",
    inspectionCounters:  {
      totalItems:   2,
      checkedItems: 2,
      damagedItems: 0,
      missingItems: 0,
    },
  });
}

/** Returns a rejecting updateChecklistItem mock. */
function makeUpdateMockThatFails() {
  return vi.fn().mockRejectedValue(new Error("Convex mutation failed"));
}

/** Minimal resolving completeInspection mock. */
function makeCompleteMock() {
  return vi.fn().mockResolvedValue({ status: "completed", inspectionId: "inspection_001" });
}

// ─── Test setup helpers ───────────────────────────────────────────────────────

interface SetupOptions {
  updateMock?: ReturnType<typeof vi.fn>;
  stateOverride?: typeof MOCK_STATE | null;
}

/**
 * Wire convex mocks and render the ScanInspectClient.
 * Returns the mock mutation functions for assertion.
 */
function setupAndRender(options: SetupOptions = {}) {
  const updateMock  = options.updateMock  ?? makeUpdateMock();
  const completeMock = makeCompleteMock();
  const state       = options.stateOverride !== undefined
    ? options.stateOverride
    : MOCK_STATE;

  (useQuery as ReturnType<typeof vi.fn>).mockImplementation(
    (queryFn: unknown) => {
      if (queryFn === "checklists:getChecklistWithInspection") return state;
      return undefined;
    }
  );

  (useMutation as ReturnType<typeof vi.fn>).mockImplementation(
    (mutationFn: unknown) => {
      if (mutationFn === "scan:updateChecklistItem") return updateMock;
      if (mutationFn === "scan:completeInspection")  return completeMock;
      return vi.fn();
    }
  );

  render(<ScanInspectClient caseId={CASE_ID} />);
  return { updateMock, completeMock };
}

/** Filter `mockTrackEvent` calls to only SCAN_ACTION_ITEM_CHECKED events. */
function getItemCheckedCalls(): Record<string, unknown>[] {
  return mockTrackEvent.mock.calls
    .map((args: unknown[]) => args[0] as Record<string, unknown>)
    .filter((e) => e.eventName === TelemetryEventName.SCAN_ACTION_ITEM_CHECKED);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ScanInspectClient — checklist item telemetry (spec §23)", () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ─── OK status ──────────────────────────────────────────────────────────────

  describe("marking item as OK", () => {
    it("emits SCAN_ACTION_ITEM_CHECKED with newStatus='ok'", async () => {
      setupAndRender();

      // Battery Pack is unchecked → appears in "To Review" section first
      const rows = screen.getAllByTestId("checklist-item-row");
      const okBtn = within(rows[0]).getByRole("button", {
        name: "Mark item as OK — present and undamaged",
      });
      fireEvent.click(okBtn);

      await waitFor(() => {
        expect(getItemCheckedCalls()).toHaveLength(1);
      });

      expect(getItemCheckedCalls()[0]).toMatchObject({
        eventCategory: "user_action",
        eventName:     TelemetryEventName.SCAN_ACTION_ITEM_CHECKED,
        app:           "scan",
        newStatus:     "ok",
      });
    });

    it("includes caseId, manifestItemId, and templateItemId", async () => {
      setupAndRender();

      const rows  = screen.getAllByTestId("checklist-item-row");
      const okBtn = within(rows[0]).getByRole("button", {
        name: "Mark item as OK — present and undamaged",
      });
      fireEvent.click(okBtn);

      await waitFor(() => {
        expect(getItemCheckedCalls()).toHaveLength(1);
      });

      expect(getItemCheckedCalls()[0]).toMatchObject({
        caseId:         CASE_ID,
        manifestItemId: MANIFEST_ID_1,
        templateItemId: TEMPLATE_ID_1,
      });
    });

    it("sets previousStatus to the item's status before the toggle", async () => {
      setupAndRender();

      // Battery Pack was "unchecked" before being marked OK
      const rows  = screen.getAllByTestId("checklist-item-row");
      const okBtn = within(rows[0]).getByRole("button", {
        name: "Mark item as OK — present and undamaged",
      });
      fireEvent.click(okBtn);

      await waitFor(() => {
        expect(getItemCheckedCalls()).toHaveLength(1);
      });

      expect(getItemCheckedCalls()[0].previousStatus).toBe("unchecked");
    });
  });

  // ─── Damaged status ──────────────────────────────────────────────────────────

  describe("marking item as damaged", () => {
    it("emits SCAN_ACTION_ITEM_CHECKED with newStatus='damaged'", async () => {
      setupAndRender();

      const rows      = screen.getAllByTestId("checklist-item-row");
      const damagedBtn = within(rows[0]).getByRole("button", {
        name: "Mark item as damaged — report damage",
      });
      fireEvent.click(damagedBtn);

      await waitFor(() => {
        expect(getItemCheckedCalls()).toHaveLength(1);
      });

      expect(getItemCheckedCalls()[0].newStatus).toBe("damaged");
    });
  });

  // ─── Missing status ──────────────────────────────────────────────────────────

  describe("marking item as missing", () => {
    it("emits SCAN_ACTION_ITEM_CHECKED with newStatus='missing'", async () => {
      setupAndRender();

      const rows      = screen.getAllByTestId("checklist-item-row");
      const missingBtn = within(rows[0]).getByRole("button", {
        name: "Mark item as missing — not found during inspection",
      });
      fireEvent.click(missingBtn);

      await waitFor(() => {
        expect(getItemCheckedCalls()).toHaveLength(1);
      });

      expect(getItemCheckedCalls()[0].newStatus).toBe("missing");
    });
  });

  // ─── Undo (revert to unchecked) ──────────────────────────────────────────────

  describe("reverting item to unchecked (Undo)", () => {
    it("emits SCAN_ACTION_ITEM_CHECKED with newStatus='unchecked'", async () => {
      setupAndRender();

      // Drone Body is "ok" → it has an "Undo" button (revert to unchecked)
      // It appears in the "Reviewed" section (second group of rows)
      const rows    = screen.getAllByTestId("checklist-item-row");
      // rows[0] = Battery Pack (unchecked); rows[1] = Drone Body (ok)
      const undoBtn = within(rows[1]).getByRole("button", {
        name: "Revert Drone Body to unchecked",
      });
      fireEvent.click(undoBtn);

      await waitFor(() => {
        expect(getItemCheckedCalls()).toHaveLength(1);
      });

      expect(getItemCheckedCalls()[0]).toMatchObject({
        newStatus:      "unchecked",
        previousStatus: "ok",
        manifestItemId: MANIFEST_ID_2,
        templateItemId: TEMPLATE_ID_2,
      });
    });
  });

  // ─── itemIndex ───────────────────────────────────────────────────────────────

  describe("itemIndex field", () => {
    it("sets itemIndex=0 for the first item in the items array", async () => {
      setupAndRender();

      // Battery Pack is at index 0 (first by name sort)
      const rows  = screen.getAllByTestId("checklist-item-row");
      const okBtn = within(rows[0]).getByRole("button", {
        name: "Mark item as OK — present and undamaged",
      });
      fireEvent.click(okBtn);

      await waitFor(() => {
        expect(getItemCheckedCalls()).toHaveLength(1);
      });

      expect(getItemCheckedCalls()[0].itemIndex).toBe(0);
    });

    it("sets itemIndex=1 for the second item in the items array", async () => {
      setupAndRender();

      // Drone Body is at index 1 (second by name sort, already in "ok" state)
      const rows = screen.getAllByTestId("checklist-item-row");
      // rows[1] = Drone Body
      const damagedBtn = within(rows[1]).getByRole("button", {
        name: "Mark item as damaged — report damage",
      });
      fireEvent.click(damagedBtn);

      await waitFor(() => {
        expect(getItemCheckedCalls()).toHaveLength(1);
      });

      expect(getItemCheckedCalls()[0].itemIndex).toBe(1);
    });
  });

  // ─── totalItems ──────────────────────────────────────────────────────────────

  describe("totalItems field", () => {
    it("sets totalItems from the live summary total", async () => {
      // MOCK_STATE.summary.total = 2
      setupAndRender();

      const rows  = screen.getAllByTestId("checklist-item-row");
      const okBtn = within(rows[0]).getByRole("button", {
        name: "Mark item as OK — present and undamaged",
      });
      fireEvent.click(okBtn);

      await waitFor(() => {
        expect(getItemCheckedCalls()).toHaveLength(1);
      });

      expect(getItemCheckedCalls()[0].totalItems).toBe(2);
    });
  });

  // ─── userId ──────────────────────────────────────────────────────────────────

  describe("userId field", () => {
    it("sets userId from useCurrentUser (hardcoded 'scan-user' in placeholder)", async () => {
      setupAndRender();

      const rows  = screen.getAllByTestId("checklist-item-row");
      const okBtn = within(rows[0]).getByRole("button", {
        name: "Mark item as OK — present and undamaged",
      });
      fireEvent.click(okBtn);

      await waitFor(() => {
        expect(getItemCheckedCalls()).toHaveLength(1);
      });

      // useCurrentUser returns { id: "scan-user", name: "Field Technician" }
      expect(getItemCheckedCalls()[0].userId).toBe("scan-user");
    });
  });

  // ─── Event shape invariants ───────────────────────────────────────────────────

  describe("event shape invariants", () => {
    it("eventCategory is 'user_action' for every item toggle", async () => {
      setupAndRender();

      const rows  = screen.getAllByTestId("checklist-item-row");
      const okBtn = within(rows[0]).getByRole("button", {
        name: "Mark item as OK — present and undamaged",
      });
      fireEvent.click(okBtn);

      await waitFor(() => {
        expect(getItemCheckedCalls()).toHaveLength(1);
      });

      expect(getItemCheckedCalls()[0].eventCategory).toBe("user_action");
    });

    it("app is 'scan' for every item toggle", async () => {
      setupAndRender();

      const rows  = screen.getAllByTestId("checklist-item-row");
      const okBtn = within(rows[0]).getByRole("button", {
        name: "Mark item as OK — present and undamaged",
      });
      fireEvent.click(okBtn);

      await waitFor(() => {
        expect(getItemCheckedCalls()).toHaveLength(1);
      });

      expect(getItemCheckedCalls()[0].app).toBe("scan");
    });

    it("emits exactly one event per toggle (no duplicates)", async () => {
      setupAndRender();

      const rows  = screen.getAllByTestId("checklist-item-row");
      const okBtn = within(rows[0]).getByRole("button", {
        name: "Mark item as OK — present and undamaged",
      });
      fireEvent.click(okBtn);

      await waitFor(() => {
        expect(getItemCheckedCalls()).toHaveLength(1);
      });

      // Wait a beat to confirm no additional duplicate events fire
      await new Promise((r) => setTimeout(r, 50));
      expect(getItemCheckedCalls()).toHaveLength(1);
    });
  });

  // ─── No telemetry on mutation failure ─────────────────────────────────────────

  describe("mutation failure", () => {
    it("does NOT emit SCAN_ACTION_ITEM_CHECKED when the mutation rejects", async () => {
      setupAndRender({ updateMock: makeUpdateMockThatFails() });

      const rows  = screen.getAllByTestId("checklist-item-row");
      const okBtn = within(rows[0]).getByRole("button", {
        name: "Mark item as OK — present and undamaged",
      });
      fireEvent.click(okBtn);

      // Wait for the async rejection to settle
      await new Promise((r) => setTimeout(r, 100));

      // No telemetry should have been emitted
      expect(getItemCheckedCalls()).toHaveLength(0);
    });
  });
});
