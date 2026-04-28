/**
 * @vitest-environment jsdom
 *
 * Unit tests: T-layout tab switch telemetry for CaseDetailPanel.
 *
 * Verifies that INV_NAV_DETAIL_TAB_CHANGED is fired with the correct
 * `tab`, `previousTab`, and `caseId` values on every T1-T5 transition.
 *
 * Strategy
 * ────────
 * • `trackEvent` is mocked at the module level so we can assert on
 *   exactly which events were emitted without touching any transport.
 * • T-layout child components (T1-T5) are stubbed — they are irrelevant
 *   to the telemetry concern under test.
 * • Lazy-loaded chunks are bypassed via vi.mock so Suspense never blocks.
 *
 * Covered scenarios
 * ─────────────────
 * 1. Initial render fires INV_NAV_DETAIL_TAB_CHANGED with previousTab = null.
 * 2. Switching tabs fires the event with the correct previous / current layouts.
 * 3. Re-rendering with the same tab does NOT emit a duplicate event.
 * 4. Rapid sequential tab switches chain previousTab correctly.
 * 5. All five tabs (T1-T5) are tracked as valid `tab` values.
 * 6. Event shape includes the required fields (eventCategory, eventName, app, caseId).
 * 7. Opening a different case resets previousTab to null (new case = fresh start).
 */

import React from "react";
import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CaseWindow } from "@/types/map";
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

// ─── Stub lazy T-layout components (avoid complex render deps) ────────────────

vi.mock("../T1Overview", () => ({
  default: () => <div data-testid="t1-overview" />,
}));
vi.mock("../T2Manifest", () => ({
  default: () => <div data-testid="t2-manifest" />,
}));
vi.mock("../T3Inspection", () => ({
  default: () => <div data-testid="t3-inspection" />,
}));
vi.mock("../T4Shipping", () => ({
  default: () => <div data-testid="t4-shipping" />,
}));
vi.mock("../T5Audit", () => ({
  default: () => <div data-testid="t5-audit" />,
}));

// ─── Import SUT (after all mocks are registered) ─────────────────────────────

import { CaseDetailPanel } from "../CaseDetailPanel";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CASE_ID_A = "case_aaa";
const CASE_ID_B = "case_bbb";

function renderPanel(
  caseId: string,
  activeWindow: CaseWindow = "T1",
  ffAuditHashChain = false
) {
  return render(
    <CaseDetailPanel
      caseId={caseId}
      window={activeWindow}
      ffAuditHashChain={ffAuditHashChain}
    />
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CaseDetailPanel — T-layout tab telemetry", () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── 1. Initial render ────────────────────────────────────────────────────

  it("fires INV_NAV_DETAIL_TAB_CHANGED on initial render with previousTab = null", () => {
    renderPanel(CASE_ID_A, "T1");

    expect(mockTrackEvent).toHaveBeenCalledOnce();
    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventCategory: "navigation",
        eventName: TelemetryEventName.INV_NAV_DETAIL_TAB_CHANGED,
        app: "inventory",
        tab: "T1",
        previousTab: null,
        caseId: CASE_ID_A,
      })
    );
  });

  it("fires with the correct tab when starting on T3", () => {
    renderPanel(CASE_ID_A, "T3");

    expect(mockTrackEvent).toHaveBeenCalledOnce();
    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tab: "T3",
        previousTab: null,
        caseId: CASE_ID_A,
      })
    );
  });

  // ─── 2. Tab switch ────────────────────────────────────────────────────────

  it("fires with correct previousTab when switching T1 → T2", () => {
    const { rerender } = renderPanel(CASE_ID_A, "T1");

    mockTrackEvent.mockClear(); // ignore the initial-render event

    rerender(
      <CaseDetailPanel
        caseId={CASE_ID_A}
        window="T2"
      />
    );

    expect(mockTrackEvent).toHaveBeenCalledOnce();
    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: TelemetryEventName.INV_NAV_DETAIL_TAB_CHANGED,
        tab: "T2",
        previousTab: "T1",
        caseId: CASE_ID_A,
      })
    );
  });

  it("fires with correct previousTab when switching T2 → T4", () => {
    const { rerender } = renderPanel(CASE_ID_A, "T2");

    mockTrackEvent.mockClear();

    rerender(
      <CaseDetailPanel
        caseId={CASE_ID_A}
        window="T4"
      />
    );

    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tab: "T4",
        previousTab: "T2",
        caseId: CASE_ID_A,
      })
    );
  });

  // ─── 3. No duplicate on same tab ─────────────────────────────────────────

  it("does NOT fire a duplicate event when the tab stays the same on re-render", () => {
    const { rerender } = renderPanel(CASE_ID_A, "T1");

    mockTrackEvent.mockClear(); // clear initial event

    // Re-render with the same tab and caseId (e.g., unrelated state update)
    rerender(
      <CaseDetailPanel
        caseId={CASE_ID_A}
        window="T1"
      />
    );

    expect(mockTrackEvent).not.toHaveBeenCalled();
  });

  // ─── 4. Sequential rapid switches chain previousTab ───────────────────────

  it("chains previousTab correctly across T1 → T2 → T3", () => {
    const { rerender } = renderPanel(CASE_ID_A, "T1");

    // T1 → T2
    mockTrackEvent.mockClear();
    rerender(
      <CaseDetailPanel
        caseId={CASE_ID_A}
        window="T2"
      />
    );
    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tab: "T2", previousTab: "T1" })
    );

    // T2 → T3
    mockTrackEvent.mockClear();
    rerender(
      <CaseDetailPanel
        caseId={CASE_ID_A}
        window="T3"
      />
    );
    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tab: "T3", previousTab: "T2" })
    );
  });

  it("chains correctly across all five tabs T1 → T2 → T3 → T4 → T5", () => {
    const tabs: CaseWindow[] = ["T1", "T2", "T3", "T4", "T5"];
    const { rerender } = renderPanel(CASE_ID_A, "T1");

    const capturedEvents: Array<{
      tab: CaseWindow;
      previousTab: CaseWindow | null;
    }> = [];

    // Collect the initial event
    capturedEvents.push(
      mockTrackEvent.mock.calls[0][0] as {
        tab: CaseWindow;
        previousTab: CaseWindow | null;
      }
    );

    // Transition through T2-T5
    for (let i = 1; i < tabs.length; i++) {
      mockTrackEvent.mockClear();
      rerender(
        <CaseDetailPanel
          caseId={CASE_ID_A}
          window={tabs[i]}
        />
      );
      if (mockTrackEvent.mock.calls.length > 0) {
        capturedEvents.push(
          mockTrackEvent.mock.calls[0][0] as {
            tab: CaseWindow;
            previousTab: CaseWindow | null;
          }
        );
      }
    }

    expect(capturedEvents).toHaveLength(5);
    expect(capturedEvents[0]).toMatchObject({ tab: "T1", previousTab: null });
    expect(capturedEvents[1]).toMatchObject({ tab: "T2", previousTab: "T1" });
    expect(capturedEvents[2]).toMatchObject({ tab: "T3", previousTab: "T2" });
    expect(capturedEvents[3]).toMatchObject({ tab: "T4", previousTab: "T3" });
    expect(capturedEvents[4]).toMatchObject({ tab: "T5", previousTab: "T4" });
  });

  // ─── 5. All five tabs are valid `tab` values ──────────────────────────────

  it.each<CaseWindow>(["T1", "T2", "T3", "T4", "T5"])(
    "emits correct tab=%s on initial render",
    (tab) => {
      renderPanel(CASE_ID_A, tab);

      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: TelemetryEventName.INV_NAV_DETAIL_TAB_CHANGED,
          tab,
        })
      );
    }
  );

  // ─── 6. Event shape ───────────────────────────────────────────────────────

  it("event has required shape fields: eventCategory, eventName, app, caseId", () => {
    renderPanel(CASE_ID_A, "T1");

    const [event] = mockTrackEvent.mock.calls[0] as [Record<string, unknown>];
    expect(event.eventCategory).toBe("navigation");
    expect(event.eventName).toBe(TelemetryEventName.INV_NAV_DETAIL_TAB_CHANGED);
    expect(event.app).toBe("inventory");
    expect(event.caseId).toBe(CASE_ID_A);
  });

  // ─── 7. Case change resets previousTab ───────────────────────────────────

  it("resets previousTab to null when a different case is opened", () => {
    const { rerender } = renderPanel(CASE_ID_A, "T1");

    // Navigate to T3 on case A
    mockTrackEvent.mockClear();
    rerender(
      <CaseDetailPanel
        caseId={CASE_ID_A}
        window="T3"
      />
    );
    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tab: "T3", previousTab: "T1", caseId: CASE_ID_A })
    );

    // Open case B — should report previousTab = null regardless of prior T3 state
    mockTrackEvent.mockClear();
    rerender(
      <CaseDetailPanel
        caseId={CASE_ID_B}
        window="T1"
      />
    );
    expect(mockTrackEvent).toHaveBeenCalledOnce();
    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tab: "T1",
        previousTab: null,
        caseId: CASE_ID_B,
      })
    );
  });

  it("fires for the new case even when the active tab is the same across cases", () => {
    // Case A on T2, case B also on T2 — should still fire with previousTab = null
    const { rerender } = renderPanel(CASE_ID_A, "T2");

    mockTrackEvent.mockClear();
    rerender(
      <CaseDetailPanel
        caseId={CASE_ID_B}
        window="T2"
      />
    );

    expect(mockTrackEvent).toHaveBeenCalledOnce();
    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tab: "T2",
        previousTab: null,
        caseId: CASE_ID_B,
      })
    );
  });
});
