// @vitest-environment jsdom

/**
 * Unit tests: custody handoff transition telemetry in ScanHandoffClient.
 *
 * Verifies that the correct structured telemetry events are emitted at each
 * custody handoff state transition in the SCAN app (spec §23):
 *
 *   1. SCAN_NAV_CUSTODY_FLOW_OPENED  — navigation event on flow mount
 *   2. SCAN_ACTION_CUSTODY_INITIATED — user_action on form submission
 *   3. SCAN_ACTION_CUSTODY_COMPLETED — user_action on successful mutation
 *
 * Per-event fields verified per spec §23:
 *   SCAN_NAV_CUSTODY_FLOW_OPENED:
 *     • eventCategory = "navigation"
 *     • app           = "scan"
 *     • caseId        — the case being handed off
 *
 *   SCAN_ACTION_CUSTODY_INITIATED:
 *     • eventCategory   = "user_action"
 *     • app             = "scan"
 *     • caseId          — the case being handed off
 *     • fromUserId      — Kinde user ID of the current custodian
 *     • recipientUserId — Kinde user ID of the recipient
 *     • handoffType     — classification ("peer_to_peer", "return", etc.)
 *
 *   SCAN_ACTION_CUSTODY_COMPLETED:
 *     • eventCategory    = "user_action"
 *     • app              = "scan"
 *     • caseId           — the case being handed off
 *     • fromUserId       — Kinde user ID of the outgoing custodian
 *     • fromUserName     — display name of the outgoing custodian
 *     • toUserId         — Kinde user ID of the incoming custodian
 *     • toUserName       — display name of the incoming custodian
 *     • handoffType      — must match value selected in form
 *     • handoffAt        — epoch ms of the handoff
 *     • handoffDurationMs — total duration from flow open to success
 *     • hasSignature     — false (signature capture not yet implemented)
 *
 * Strategy
 * ────────
 * • `trackEvent` is mocked at module level so we can assert on emitted
 *   events without any real transport or Convex backend.
 * • `convex/react` (useQuery, useMutation) are mocked to control loading
 *   state and mutation results.
 * • `use-scan-mutations` is mocked to expose a spy on `useHandoffCustody`.
 * • `use-custody` is mocked to return null latestCustody (no prior handoff).
 * • Tests use `waitFor` to account for the async mutation + telemetry sequence.
 *
 * Covered scenarios
 * ─────────────────
 *  1.  SCAN_NAV_CUSTODY_FLOW_OPENED emitted once on mount (case loaded)
 *  2.  SCAN_NAV_CUSTODY_FLOW_OPENED NOT emitted while case is loading
 *  3.  SCAN_NAV_CUSTODY_FLOW_OPENED NOT emitted when caseDoc is null (not found)
 *  4.  SCAN_ACTION_CUSTODY_INITIATED emitted on form submit (before mutation)
 *  5.  SCAN_ACTION_CUSTODY_INITIATED includes caseId, fromUserId, recipientUserId
 *  6.  SCAN_ACTION_CUSTODY_INITIATED includes handoffType from form
 *  7.  SCAN_ACTION_CUSTODY_COMPLETED emitted on successful mutation
 *  8.  SCAN_ACTION_CUSTODY_COMPLETED includes fromUserId and fromUserName
 *  9.  SCAN_ACTION_CUSTODY_COMPLETED includes toUserId and toUserName
 * 10.  SCAN_ACTION_CUSTODY_COMPLETED includes handoffType matching initiated
 * 11.  SCAN_ACTION_CUSTODY_COMPLETED includes handoffAt epoch ms
 * 12.  SCAN_ACTION_CUSTODY_COMPLETED has handoffDurationMs >= 0
 * 13.  SCAN_ACTION_CUSTODY_COMPLETED has hasSignature = false
 * 14.  SCAN_ACTION_CUSTODY_COMPLETED NOT emitted when mutation rejects
 * 15.  SCAN_NAV_CUSTODY_FLOW_OPENED emitted exactly once (no duplicates on rerender)
 * 16.  Changing handoffType in form changes value in INITIATED event
 * 17.  Default handoffType is "peer_to_peer" when no selection made
 * 18.  Complete event shape for happy path (INITIATED + COMPLETED together)
 */

import React from "react";
import {
  render,
  fireEvent,
  screen,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelemetryEventName } from "@/types/telemetry.types";

// ─── Mock telemetry (spy on trackEvent, never hit transport) ──────────────────

const mockTrackEvent = vi.fn();

vi.mock("@/lib/telemetry.lib", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  telemetry: {
    track:    vi.fn(),
    identify: vi.fn(),
    flush:    vi.fn(),
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
    cases: {
      getCaseById: "cases:getCaseById",
    },
    custody: {
      getLatestCustodyRecord: "custody:getLatestCustodyRecord",
    },
    custodyHandoffs: {
      handoffCustody: "custodyHandoffs:handoffCustody",
    },
    // users namespace required by UserSelector component (api.users.listUsers)
    users: {
      listUsers:      "users:listUsers",
      getCurrentUser: "users:getCurrentUser",
    },
  },
}));

// ─── Mock use-custody hook ────────────────────────────────────────────────────

vi.mock("../../../../../hooks/use-custody", () => ({
  useLatestCustodyRecord: vi.fn(() => null),
}));

// ─── Mock Kinde auth (browser client) ────────────────────────────────────────
// Returns the placeholder "scan-user" identity expected by telemetry assertions.

vi.mock("@kinde-oss/kinde-auth-nextjs", () => ({
  useKindeBrowserClient: () => ({
    user: {
      id:          "scan-user",
      given_name:  "Field",
      family_name: "Technician",
      email:       "field.technician@skyspecs.com",
    },
    isAuthenticated: true,
    isLoading:       false,
  }),
}));

// ─── Mock UserSelector ────────────────────────────────────────────────────────
// The real UserSelector is a combobox that loads users from Convex.
// In tests we replace it with two plain text inputs so tests can set
// recipientId and recipientName via getByLabelText.

vi.mock("../../../../../components/UserSelector", () => ({
  UserSelector: ({
    id,
    value,
    onChange,
    disabled,
  }: {
    id?: string;
    value: { userId: string; userName: string } | null;
    onChange: (val: { userId: string; userName: string } | null) => void;
    disabled?: boolean;
    placeholder?: string;
    "aria-describedby"?: string;
  }) => (
    <div>
      <label htmlFor={`${id}-userId`}>Recipient User ID</label>
      <input
        id={`${id}-userId`}
        type="text"
        value={value?.userId ?? ""}
        disabled={disabled}
        onChange={(e) =>
          onChange(
            e.target.value
              ? { userId: e.target.value, userName: value?.userName ?? "" }
              : null
          )
        }
      />
      <label htmlFor={`${id}-userName`}>Recipient Display Name</label>
      <input
        id={`${id}-userName`}
        type="text"
        value={value?.userName ?? ""}
        disabled={disabled}
        onChange={(e) =>
          onChange(
            e.target.value
              ? { userId: value?.userId ?? "", userName: e.target.value }
              : null
          )
        }
      />
    </div>
  ),
}));

// ─── Mock use-scan-mutations ──────────────────────────────────────────────────
// Delegate to a module-level variable so individual tests can swap the
// implementation without re-mocking the module.

let mockHandoffImpl: (...args: unknown[]) => Promise<unknown> =
  () => Promise.resolve({ custodyRecordId: "rec_001", caseId: "", fromUserId: "", toUserId: "", handoffAt: Date.now(), eventId: "evt_001" });

const mockHandoffFn = vi.fn((...args: unknown[]) => mockHandoffImpl(...args));

vi.mock("../../../../../hooks/use-scan-mutations", () => ({
  useHandoffCustody: () => mockHandoffFn,
}));

// ─── Import SUT and mocked modules (after vi.mock hoisting) ──────────────────

import { useQuery } from "convex/react";
import { ScanHandoffClient } from "../ScanHandoffClient";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_ID        = "case_telemetry_handoff_test";
const FROM_USER_ID   = "scan-user";   // placeholder Kinde ID from useCurrentUser
const FROM_USER_NAME = "Field Technician";
const TO_USER_ID     = "kp_recipient_001";
const TO_USER_NAME   = "Jane Pilot";

/** Minimal case document returned by getCaseById. */
const MOCK_CASE = {
  _id:           CASE_ID,
  _creationTime: 1_700_000_000_000,
  label:         "CASE-HND-001",
  status:        "deployed" as const,
  locationName:  "Site Beta",
  assigneeId:    FROM_USER_ID,
  assigneeName:  FROM_USER_NAME,
};

// ─── Mock factories ────────────────────────────────────────────────────────────

function makeHandoffSuccess(): (...args: unknown[]) => Promise<unknown> {
  return () =>
    Promise.resolve({
      custodyRecordId: "rec_001",
      caseId:          CASE_ID,
      fromUserId:      FROM_USER_ID,
      toUserId:        TO_USER_ID,
      handoffAt:       Date.now(),
      eventId:         "evt_001",
    });
}

function makeHandoffFailure(): (...args: unknown[]) => Promise<unknown> {
  return () => Promise.reject(new Error("Convex mutation failed: handoffCustody"));
}

// ─── Setup helpers ─────────────────────────────────────────────────────────────

interface SetupOptions {
  handoffMock?: (...args: unknown[]) => Promise<unknown>;
  /** When undefined, caseDoc is still loading (useQuery returns undefined). */
  caseDoc?: typeof MOCK_CASE | null | undefined;
}

/**
 * Wire Convex mocks and render the ScanHandoffClient.
 */
function setupAndRender(options: SetupOptions = {}) {
  const { handoffMock, caseDoc } = {
    handoffMock: makeHandoffSuccess(),
    caseDoc:     MOCK_CASE,
    ...options,
  };

  mockHandoffImpl = handoffMock ?? makeHandoffSuccess();

  (useQuery as ReturnType<typeof vi.fn>).mockImplementation(() => caseDoc);

  return render(<ScanHandoffClient caseId={CASE_ID} />);
}

/**
 * Fill required form fields and submit.
 * If `recipientId` or `recipientName` are omitted they default to test fixtures.
 */
async function fillAndSubmit(
  recipientId: string = TO_USER_ID,
  recipientName: string = TO_USER_NAME
) {
  const idInput   = screen.getByLabelText(/Recipient User ID/i);
  const nameInput = screen.getByLabelText(/Recipient Display Name/i);

  fireEvent.change(idInput,   { target: { value: recipientId } });
  fireEvent.change(nameInput, { target: { value: recipientName } });

  const submitBtn = screen.getByTestId("handoff-submit");
  fireEvent.click(submitBtn);
}

/** Filter mockTrackEvent calls to a specific eventName. */
function getCalls(eventName: string): Record<string, unknown>[] {
  return mockTrackEvent.mock.calls
    .map((args: unknown[]) => args[0] as Record<string, unknown>)
    .filter((e) => e.eventName === eventName);
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("ScanHandoffClient — custody handoff transition telemetry (spec §23)", () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
    mockHandoffFn.mockClear();
    mockHandoffImpl = makeHandoffSuccess();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ─── SCAN_NAV_CUSTODY_FLOW_OPENED ────────────────────────────────────────

  describe("SCAN_NAV_CUSTODY_FLOW_OPENED — navigation event on flow mount", () => {
    it("emits SCAN_NAV_CUSTODY_FLOW_OPENED once the case document is loaded", async () => {
      setupAndRender({ caseDoc: MOCK_CASE });

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_NAV_CUSTODY_FLOW_OPENED)
        ).toHaveLength(1);
      });
    });

    it("sets eventCategory = 'navigation' and app = 'scan'", async () => {
      setupAndRender({ caseDoc: MOCK_CASE });

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_NAV_CUSTODY_FLOW_OPENED)
        ).toHaveLength(1);
      });

      const event = getCalls(TelemetryEventName.SCAN_NAV_CUSTODY_FLOW_OPENED)[0];
      expect(event.eventCategory).toBe("navigation");
      expect(event.app).toBe("scan");
    });

    it("includes the caseId in the navigation event", async () => {
      setupAndRender({ caseDoc: MOCK_CASE });

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_NAV_CUSTODY_FLOW_OPENED)
        ).toHaveLength(1);
      });

      const event = getCalls(TelemetryEventName.SCAN_NAV_CUSTODY_FLOW_OPENED)[0];
      expect(event.caseId).toBe(CASE_ID);
    });

    it("does NOT emit SCAN_NAV_CUSTODY_FLOW_OPENED while case is still loading", () => {
      // caseDoc = undefined means the Convex subscription is still pending
      setupAndRender({ caseDoc: undefined });

      const calls = getCalls(TelemetryEventName.SCAN_NAV_CUSTODY_FLOW_OPENED);
      expect(calls).toHaveLength(0);
    });

    it("does NOT emit SCAN_NAV_CUSTODY_FLOW_OPENED when caseDoc is null (case not found)", async () => {
      setupAndRender({ caseDoc: null });

      // Allow any effects to settle
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      const calls = getCalls(TelemetryEventName.SCAN_NAV_CUSTODY_FLOW_OPENED);
      expect(calls).toHaveLength(0);
    });

    it("emits SCAN_NAV_CUSTODY_FLOW_OPENED exactly once (no duplicate on re-render)", async () => {
      const { rerender } = setupAndRender({ caseDoc: MOCK_CASE });

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_NAV_CUSTODY_FLOW_OPENED)
        ).toHaveLength(1);
      });

      // Re-render with same props — must not emit again
      rerender(<ScanHandoffClient caseId={CASE_ID} />);

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(
        getCalls(TelemetryEventName.SCAN_NAV_CUSTODY_FLOW_OPENED)
      ).toHaveLength(1);
    });
  });

  // ─── SCAN_ACTION_CUSTODY_INITIATED ───────────────────────────────────────

  describe("SCAN_ACTION_CUSTODY_INITIATED — emitted at form submission (spec §23)", () => {
    it("emits SCAN_ACTION_CUSTODY_INITIATED when the form is submitted", async () => {
      setupAndRender();

      await fillAndSubmit();

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED)
        ).toHaveLength(1);
      });
    });

    it("sets eventCategory = 'user_action' and app = 'scan'", async () => {
      setupAndRender();

      await fillAndSubmit();

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED)
        ).toHaveLength(1);
      });

      const event = getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED)[0];
      expect(event.eventCategory).toBe("user_action");
      expect(event.app).toBe("scan");
    });

    it("includes caseId in the initiated event (spec §23: case ID)", async () => {
      setupAndRender();

      await fillAndSubmit();

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED)
        ).toHaveLength(1);
      });

      const event = getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED)[0];
      expect(event.caseId).toBe(CASE_ID);
    });

    it("includes fromUserId (spec §23: from-custodian)", async () => {
      setupAndRender();

      await fillAndSubmit();

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED)
        ).toHaveLength(1);
      });

      const event = getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED)[0];
      expect(event.fromUserId).toBe(FROM_USER_ID);
    });

    it("includes recipientUserId (spec §23: to-custodian)", async () => {
      setupAndRender();

      await fillAndSubmit(TO_USER_ID, TO_USER_NAME);

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED)
        ).toHaveLength(1);
      });

      const event = getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED)[0];
      expect(event.recipientUserId).toBe(TO_USER_ID);
    });

    it("includes handoffType in the initiated event (spec §23: handoff type)", async () => {
      setupAndRender();

      await fillAndSubmit();

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED)
        ).toHaveLength(1);
      });

      const event = getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED)[0];
      // handoffType must be one of the valid values
      expect(["peer_to_peer", "return", "initial_assignment", "field_transfer"]).toContain(
        event.handoffType
      );
    });

    it("defaults handoffType to 'peer_to_peer' when no selection is made", async () => {
      setupAndRender();

      await fillAndSubmit();

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED)
        ).toHaveLength(1);
      });

      const event = getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED)[0];
      expect(event.handoffType).toBe("peer_to_peer");
    });

    it("reflects the selected handoffType when changed via the dropdown", async () => {
      setupAndRender();

      // Change the handoff type selector
      const select = screen.getByTestId("handoff-type-select");
      fireEvent.change(select, { target: { value: "return" } });

      await fillAndSubmit();

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED)
        ).toHaveLength(1);
      });

      const event = getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED)[0];
      expect(event.handoffType).toBe("return");
    });

    it("does NOT emit SCAN_ACTION_CUSTODY_INITIATED when required fields are empty", async () => {
      setupAndRender();

      // Submit button is disabled when recipient fields are empty
      const submitBtn = screen.getByTestId("handoff-submit");
      expect((submitBtn as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(submitBtn);

      await new Promise((r) => setTimeout(r, 50));

      expect(
        getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED)
      ).toHaveLength(0);
    });
  });

  // ─── SCAN_ACTION_CUSTODY_COMPLETED ──────────────────────────────────────

  describe("SCAN_ACTION_CUSTODY_COMPLETED — emitted on successful mutation (spec §23)", () => {
    it("emits SCAN_ACTION_CUSTODY_COMPLETED on successful handoff", async () => {
      setupAndRender();

      await fillAndSubmit();

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)
        ).toHaveLength(1);
      });
    });

    it("sets eventCategory = 'user_action' and app = 'scan'", async () => {
      setupAndRender();

      await fillAndSubmit();

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)
        ).toHaveLength(1);
      });

      const event = getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)[0];
      expect(event.eventCategory).toBe("user_action");
      expect(event.app).toBe("scan");
    });

    it("includes caseId (spec §23: case ID)", async () => {
      setupAndRender();

      await fillAndSubmit();

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)
        ).toHaveLength(1);
      });

      const event = getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)[0];
      expect(event.caseId).toBe(CASE_ID);
    });

    it("includes fromUserId and fromUserName (spec §23: from-custodian)", async () => {
      setupAndRender();

      await fillAndSubmit();

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)
        ).toHaveLength(1);
      });

      const event = getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)[0];
      expect(event.fromUserId).toBe(FROM_USER_ID);
      expect(event.fromUserName).toBe(FROM_USER_NAME);
    });

    it("includes toUserId and toUserName (spec §23: to-custodian)", async () => {
      setupAndRender();

      await fillAndSubmit(TO_USER_ID, TO_USER_NAME);

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)
        ).toHaveLength(1);
      });

      const event = getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)[0];
      expect(event.toUserId).toBe(TO_USER_ID);
      expect(event.toUserName).toBe(TO_USER_NAME);
    });

    it("includes handoffType matching the INITIATED event (spec §23: handoff type)", async () => {
      setupAndRender();

      // Select a non-default handoff type
      const select = screen.getByTestId("handoff-type-select");
      fireEvent.change(select, { target: { value: "field_transfer" } });

      await fillAndSubmit();

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)
        ).toHaveLength(1);
      });

      const initiatedEvent = getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED)[0];
      const completedEvent = getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)[0];

      expect(completedEvent.handoffType).toBe("field_transfer");
      expect(completedEvent.handoffType).toBe(initiatedEvent.handoffType);
    });

    it("includes handoffAt as an epoch ms number (spec §23: timestamp)", async () => {
      const before = Date.now();
      setupAndRender();

      await fillAndSubmit();

      const after = Date.now();

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)
        ).toHaveLength(1);
      });

      const event = getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)[0];
      expect(typeof event.handoffAt).toBe("number");
      expect(event.handoffAt as number).toBeGreaterThanOrEqual(before);
      expect(event.handoffAt as number).toBeLessThanOrEqual(after);
    });

    it("includes handoffDurationMs as a non-negative number", async () => {
      setupAndRender();

      await fillAndSubmit();

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)
        ).toHaveLength(1);
      });

      const event = getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)[0];
      expect(typeof event.handoffDurationMs).toBe("number");
      expect(event.handoffDurationMs as number).toBeGreaterThanOrEqual(0);
    });

    it("sets hasSignature = false (signature not yet implemented)", async () => {
      setupAndRender();

      await fillAndSubmit();

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)
        ).toHaveLength(1);
      });

      const event = getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)[0];
      expect(event.hasSignature).toBe(false);
    });

    it("does NOT emit SCAN_ACTION_CUSTODY_COMPLETED when the mutation rejects", async () => {
      setupAndRender({ handoffMock: makeHandoffFailure() });

      await fillAndSubmit();

      // Wait for the async rejection to settle
      await new Promise((r) => setTimeout(r, 150));

      expect(
        getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)
      ).toHaveLength(0);
    });

    it("emits exactly one COMPLETED event per successful submission (no duplicates)", async () => {
      setupAndRender();

      await fillAndSubmit();

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)
        ).toHaveLength(1);
      });

      // Settle to confirm no delayed duplicate fires
      await new Promise((r) => setTimeout(r, 100));
      expect(
        getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)
      ).toHaveLength(1);
    });
  });

  // ─── INITIATED emitted before COMPLETED ─────────────────────────────────

  describe("event ordering — INITIATED fires before COMPLETED (spec §23)", () => {
    it("SCAN_ACTION_CUSTODY_INITIATED is emitted before SCAN_ACTION_CUSTODY_COMPLETED", async () => {
      setupAndRender();

      await fillAndSubmit();

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)
        ).toHaveLength(1);
      });

      // Find the order of all tracked calls by index
      const allCalls = mockTrackEvent.mock.calls.map(
        (args: unknown[]) => (args[0] as Record<string, unknown>).eventName
      );
      const initiatedIdx = allCalls.indexOf(
        TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED
      );
      const completedIdx = allCalls.indexOf(
        TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED
      );

      expect(initiatedIdx).toBeGreaterThanOrEqual(0);
      expect(completedIdx).toBeGreaterThanOrEqual(0);
      expect(initiatedIdx).toBeLessThan(completedIdx);
    });
  });

  // ─── Complete event shape — happy path ──────────────────────────────────

  describe("complete event shapes — happy path (spec §23)", () => {
    it("emits fully-formed INITIATED and COMPLETED events on the happy path", async () => {
      setupAndRender();

      await fillAndSubmit(TO_USER_ID, TO_USER_NAME);

      await waitFor(() => {
        expect(
          getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)
        ).toHaveLength(1);
      });

      const initiated = getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED)[0];
      const completed = getCalls(TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED)[0];

      expect(initiated).toMatchObject({
        eventCategory:   "user_action",
        eventName:       TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED,
        app:             "scan",
        caseId:          CASE_ID,
        fromUserId:      FROM_USER_ID,
        recipientUserId: TO_USER_ID,
        handoffType:     "peer_to_peer",
      });

      expect(completed).toMatchObject({
        eventCategory: "user_action",
        eventName:     TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED,
        app:           "scan",
        caseId:        CASE_ID,
        fromUserId:    FROM_USER_ID,
        fromUserName:  FROM_USER_NAME,
        toUserId:      TO_USER_ID,
        toUserName:    TO_USER_NAME,
        handoffType:   "peer_to_peer",
        hasSignature:  false,
      });

      // handoffAt and handoffDurationMs are numeric
      expect(typeof completed.handoffAt).toBe("number");
      expect(typeof completed.handoffDurationMs).toBe("number");
    });
  });
});
