/**
 * @vitest-environment jsdom
 *
 * Unit tests: useDefaultLayoutOnCaseChange hook
 *
 * Verifies that:
 *  1.  setParams is NOT called when activeCaseId is null.
 *  2.  setParams is NOT called while caseStatus is undefined (loading).
 *  3.  setParams is NOT called when caseStatus is null (not found).
 *  4.  setParams is called with { view, caseWindow } when no preference stored.
 *  5.  Correct M3+T4 defaults applied for transit_out status.
 *  6.  Correct M2+T3 defaults applied for deployed status.
 *  7.  Correct M1+T1 defaults applied for hangar status.
 *  8.  Correct M1+T2 defaults applied for assembled status.
 *  9.  Correct M3+T4 defaults applied for transit_in status.
 * 10.  Correct M2+T3 defaults applied for flagged status.
 * 11.  Correct M1+T1 defaults applied for received status.
 * 12.  Correct M1+T1 defaults applied for archived status.
 * 13.  setParams NOT called when both mapMode and caseLayout are stored.
 * 14.  setParams called with only { caseWindow } when only mapMode is stored.
 * 15.  setParams called with only { view } when only caseLayout is stored.
 * 16.  Fallback M1+T1 applied for unknown/future status strings.
 * 17.  When activeCaseId changes, new defaults are applied for new case status.
 * 18.  When caseStatus.status changes, updated defaults are applied.
 * 19.  setParams is called on mount when activeCaseId is non-null (deep link restore).
 * 20.  Empty userId treated as "no preference" (defaults applied).
 * 21.  When activeCaseId changes from non-null to null, setParams is NOT called.
 */

import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// ─── Hoist mock fns ───────────────────────────────────────────────────────────
//
// vi.hoisted() is needed because vi.mock() is hoisted to the top of the file
// by Vitest, so variables used inside the mock factories must be initialized
// before they run.

const {
  mockReadMapMode,
  mockReadCaseLayout,
  mockUseCaseStatus,
} = vi.hoisted(() => ({
  mockReadMapMode: vi.fn((_userId: string) => null as string | null),
  mockReadCaseLayout: vi.fn((_userId: string) => null as string | null),
  mockUseCaseStatus: vi.fn(),
}));

// ─── vi.mock declarations ─────────────────────────────────────────────────────

vi.mock("@/lib/layout-storage", () => ({
  readMapMode: (userId: string) => mockReadMapMode(userId),
  readCaseLayout: (userId: string) => mockReadCaseLayout(userId),
}));

vi.mock("@/hooks/use-case-status", () => ({
  useCaseStatus: (caseId: string | null) => mockUseCaseStatus(caseId),
}));

// ─── Import the hook under test ───────────────────────────────────────────────

import {
  useDefaultLayoutOnCaseChange,
  type DefaultLayoutPatch,
} from "../use-default-layout-on-case-change";

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Build a minimal CaseStatusResult-shaped stub with just the fields
 * the hook reads (`status`).
 */
function makeCaseStatus(status: string) {
  return {
    _id: "case_001",
    label: "Case A",
    status,
    updatedAt: Date.now(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useDefaultLayoutOnCaseChange", () => {
  let mockSetParams: Mock<(patch: DefaultLayoutPatch) => void>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: no stored preferences
    mockReadMapMode.mockReturnValue(null);
    mockReadCaseLayout.mockReturnValue(null);

    // Default: no case status (loading)
    mockUseCaseStatus.mockReturnValue(undefined);

    mockSetParams = vi.fn();
  });

  // ── Guard: activeCaseId null ───────────────────────────────────────────────

  it("1. does NOT call setParams when activeCaseId is null", () => {
    mockUseCaseStatus.mockReturnValue(undefined);

    renderHook(() =>
      useDefaultLayoutOnCaseChange({
        activeCaseId: null,
        userId: "user_001",
        setParams: mockSetParams,
      })
    );

    expect(mockSetParams).not.toHaveBeenCalled();
  });

  // ── Guard: caseStatus loading ──────────────────────────────────────────────

  it("2. does NOT call setParams while caseStatus is undefined (loading)", () => {
    mockUseCaseStatus.mockReturnValue(undefined);

    renderHook(() =>
      useDefaultLayoutOnCaseChange({
        activeCaseId: "case_001",
        userId: "user_001",
        setParams: mockSetParams,
      })
    );

    expect(mockSetParams).not.toHaveBeenCalled();
  });

  // ── Guard: caseStatus null ─────────────────────────────────────────────────

  it("3. does NOT call setParams when caseStatus is null (not found)", () => {
    mockUseCaseStatus.mockReturnValue(null);

    renderHook(() =>
      useDefaultLayoutOnCaseChange({
        activeCaseId: "case_001",
        userId: "user_001",
        setParams: mockSetParams,
      })
    );

    expect(mockSetParams).not.toHaveBeenCalled();
  });

  // ── Defaults applied when no preference stored ────────────────────────────

  it("4. calls setParams with { view, caseWindow } when no preference is stored", () => {
    mockUseCaseStatus.mockReturnValue(makeCaseStatus("deployed"));
    mockReadMapMode.mockReturnValue(null);
    mockReadCaseLayout.mockReturnValue(null);

    renderHook(() =>
      useDefaultLayoutOnCaseChange({
        activeCaseId: "case_001",
        userId: "user_001",
        setParams: mockSetParams,
      })
    );

    expect(mockSetParams).toHaveBeenCalledOnce();
    expect(mockSetParams).toHaveBeenCalledWith({ view: "M2", caseWindow: "T3" });
  });

  // ── Domain rules: transit_out ─────────────────────────────────────────────

  it("5. applies M3+T4 for transit_out status", () => {
    mockUseCaseStatus.mockReturnValue(makeCaseStatus("transit_out"));

    renderHook(() =>
      useDefaultLayoutOnCaseChange({
        activeCaseId: "case_001",
        userId: "user_001",
        setParams: mockSetParams,
      })
    );

    expect(mockSetParams).toHaveBeenCalledWith({ view: "M3", caseWindow: "T4" });
  });

  // ── Domain rules: deployed ────────────────────────────────────────────────

  it("6. applies M2+T3 for deployed status", () => {
    mockUseCaseStatus.mockReturnValue(makeCaseStatus("deployed"));

    renderHook(() =>
      useDefaultLayoutOnCaseChange({
        activeCaseId: "case_001",
        userId: "user_001",
        setParams: mockSetParams,
      })
    );

    expect(mockSetParams).toHaveBeenCalledWith({ view: "M2", caseWindow: "T3" });
  });

  // ── Domain rules: hangar ──────────────────────────────────────────────────

  it("7. applies M1+T1 for hangar status", () => {
    mockUseCaseStatus.mockReturnValue(makeCaseStatus("hangar"));

    renderHook(() =>
      useDefaultLayoutOnCaseChange({
        activeCaseId: "case_001",
        userId: "user_001",
        setParams: mockSetParams,
      })
    );

    expect(mockSetParams).toHaveBeenCalledWith({ view: "M1", caseWindow: "T1" });
  });

  // ── Domain rules: assembled ───────────────────────────────────────────────

  it("8. applies M1+T2 for assembled status", () => {
    mockUseCaseStatus.mockReturnValue(makeCaseStatus("assembled"));

    renderHook(() =>
      useDefaultLayoutOnCaseChange({
        activeCaseId: "case_001",
        userId: "user_001",
        setParams: mockSetParams,
      })
    );

    expect(mockSetParams).toHaveBeenCalledWith({ view: "M1", caseWindow: "T2" });
  });

  // ── Domain rules: transit_in ──────────────────────────────────────────────

  it("9. applies M3+T4 for transit_in status", () => {
    mockUseCaseStatus.mockReturnValue(makeCaseStatus("transit_in"));

    renderHook(() =>
      useDefaultLayoutOnCaseChange({
        activeCaseId: "case_001",
        userId: "user_001",
        setParams: mockSetParams,
      })
    );

    expect(mockSetParams).toHaveBeenCalledWith({ view: "M3", caseWindow: "T4" });
  });

  // ── Domain rules: flagged ─────────────────────────────────────────────────

  it("10. applies M2+T3 for flagged status", () => {
    mockUseCaseStatus.mockReturnValue(makeCaseStatus("flagged"));

    renderHook(() =>
      useDefaultLayoutOnCaseChange({
        activeCaseId: "case_001",
        userId: "user_001",
        setParams: mockSetParams,
      })
    );

    expect(mockSetParams).toHaveBeenCalledWith({ view: "M2", caseWindow: "T3" });
  });

  // ── Domain rules: received ────────────────────────────────────────────────

  it("11. applies M1+T1 for received status", () => {
    mockUseCaseStatus.mockReturnValue(makeCaseStatus("received"));

    renderHook(() =>
      useDefaultLayoutOnCaseChange({
        activeCaseId: "case_001",
        userId: "user_001",
        setParams: mockSetParams,
      })
    );

    expect(mockSetParams).toHaveBeenCalledWith({ view: "M1", caseWindow: "T1" });
  });

  // ── Domain rules: archived ────────────────────────────────────────────────

  it("12. applies M1+T1 for archived status", () => {
    mockUseCaseStatus.mockReturnValue(makeCaseStatus("archived"));

    renderHook(() =>
      useDefaultLayoutOnCaseChange({
        activeCaseId: "case_001",
        userId: "user_001",
        setParams: mockSetParams,
      })
    );

    expect(mockSetParams).toHaveBeenCalledWith({ view: "M1", caseWindow: "T1" });
  });

  // ── Explicit preference guard: both stored ────────────────────────────────

  it("13. does NOT call setParams when both mapMode and caseLayout are stored", () => {
    mockUseCaseStatus.mockReturnValue(makeCaseStatus("transit_out"));
    mockReadMapMode.mockReturnValue("M3");
    mockReadCaseLayout.mockReturnValue("T4");

    renderHook(() =>
      useDefaultLayoutOnCaseChange({
        activeCaseId: "case_001",
        userId: "user_001",
        setParams: mockSetParams,
      })
    );

    expect(mockSetParams).not.toHaveBeenCalled();
  });

  // ── Partial preference: only mapMode stored ───────────────────────────────

  it("14. calls setParams with only { caseWindow } when only mapMode is stored", () => {
    mockUseCaseStatus.mockReturnValue(makeCaseStatus("deployed"));
    mockReadMapMode.mockReturnValue("M4"); // explicit preference
    mockReadCaseLayout.mockReturnValue(null); // no preference

    renderHook(() =>
      useDefaultLayoutOnCaseChange({
        activeCaseId: "case_001",
        userId: "user_001",
        setParams: mockSetParams,
      })
    );

    // Only caseWindow should be in the patch — view is omitted because mapMode
    // already has a stored preference that should not be overridden.
    expect(mockSetParams).toHaveBeenCalledOnce();
    const callArg = mockSetParams.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty("view");
    expect(callArg).toHaveProperty("caseWindow", "T3"); // deployed → T3
  });

  // ── Partial preference: only caseLayout stored ───────────────────────────

  it("15. calls setParams with only { view } when only caseLayout is stored", () => {
    mockUseCaseStatus.mockReturnValue(makeCaseStatus("transit_out"));
    mockReadMapMode.mockReturnValue(null); // no preference
    mockReadCaseLayout.mockReturnValue("T1"); // explicit preference

    renderHook(() =>
      useDefaultLayoutOnCaseChange({
        activeCaseId: "case_001",
        userId: "user_001",
        setParams: mockSetParams,
      })
    );

    // Only view should be in the patch — caseWindow is omitted because
    // caseLayout already has a stored preference.
    expect(mockSetParams).toHaveBeenCalledOnce();
    const callArg = mockSetParams.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg).toHaveProperty("view", "M3"); // transit_out → M3
    expect(callArg).not.toHaveProperty("caseWindow");
  });

  // ── Fallback for unknown status ───────────────────────────────────────────

  it("16. applies M1+T1 fallback for unknown/future status string", () => {
    mockUseCaseStatus.mockReturnValue(makeCaseStatus("future_status_v2"));
    mockReadMapMode.mockReturnValue(null);
    mockReadCaseLayout.mockReturnValue(null);

    renderHook(() =>
      useDefaultLayoutOnCaseChange({
        activeCaseId: "case_001",
        userId: "user_001",
        setParams: mockSetParams,
      })
    );

    expect(mockSetParams).toHaveBeenCalledWith({ view: "M1", caseWindow: "T1" });
  });

  // ── Case change applies new defaults ─────────────────────────────────────

  it("17. applies new defaults when activeCaseId changes to a different case", () => {
    // Start with case_001 at "hangar" status
    let activeCaseId = "case_001";
    mockUseCaseStatus.mockImplementation((id) => {
      if (id === "case_001") return makeCaseStatus("hangar");
      if (id === "case_002") return makeCaseStatus("transit_out");
      return undefined;
    });

    const { rerender } = renderHook(
      ({ caseId }: { caseId: string }) =>
        useDefaultLayoutOnCaseChange({
          activeCaseId: caseId,
          userId: "user_001",
          setParams: mockSetParams,
        }),
      { initialProps: { caseId: activeCaseId } }
    );

    // First render: case_001 (hangar) → M1+T1
    expect(mockSetParams).toHaveBeenCalledWith({ view: "M1", caseWindow: "T1" });
    mockSetParams.mockClear();

    // Change to case_002 (transit_out) → M3+T4
    rerender({ caseId: "case_002" });

    expect(mockSetParams).toHaveBeenCalledWith({ view: "M3", caseWindow: "T4" });
  });

  // ── Real-time status change re-applies defaults ───────────────────────────

  it("18. re-applies defaults when the case's status changes via Convex push", () => {
    // Simulate a Convex real-time push that transitions "deployed" → "transit_in"
    let currentStatus = "deployed";
    mockUseCaseStatus.mockImplementation(() => makeCaseStatus(currentStatus));

    const { rerender } = renderHook(() =>
      useDefaultLayoutOnCaseChange({
        activeCaseId: "case_001",
        userId: "user_001",
        setParams: mockSetParams,
      })
    );

    // Initial: deployed → M2+T3
    expect(mockSetParams).toHaveBeenCalledWith({ view: "M2", caseWindow: "T3" });
    mockSetParams.mockClear();

    // Convex pushes a status update: transit_in → M3+T4
    currentStatus = "transit_in";
    rerender();

    expect(mockSetParams).toHaveBeenCalledWith({ view: "M3", caseWindow: "T4" });
  });

  // ── Mount with case already selected (deep link restore) ─────────────────

  it("19. applies defaults on mount when activeCaseId is non-null (deep link restore)", () => {
    // Simulate loading the page with ?case=case_001 already in the URL
    mockUseCaseStatus.mockReturnValue(makeCaseStatus("transit_out"));

    renderHook(() =>
      useDefaultLayoutOnCaseChange({
        activeCaseId: "case_001", // pre-selected from URL
        userId: "user_001",
        setParams: mockSetParams,
      })
    );

    // Should apply M3+T4 immediately on mount
    expect(mockSetParams).toHaveBeenCalledOnce();
    expect(mockSetParams).toHaveBeenCalledWith({ view: "M3", caseWindow: "T4" });
  });

  // ── Empty userId treated as no preference ─────────────────────────────────

  it("20. treats empty userId as no preference and applies defaults", () => {
    mockUseCaseStatus.mockReturnValue(makeCaseStatus("deployed"));
    // readMapMode / readCaseLayout will receive "" — they return null in that case.
    // Our mock also returns null by default.
    mockReadMapMode.mockReturnValue(null);
    mockReadCaseLayout.mockReturnValue(null);

    renderHook(() =>
      useDefaultLayoutOnCaseChange({
        activeCaseId: "case_001",
        userId: "", // not yet authenticated
        setParams: mockSetParams,
      })
    );

    // Defaults should be applied
    expect(mockSetParams).toHaveBeenCalledWith({ view: "M2", caseWindow: "T3" });
  });

  // ── activeCaseId returns to null ──────────────────────────────────────────

  it("21. does NOT call setParams when activeCaseId changes from non-null to null", () => {
    mockUseCaseStatus.mockReturnValue(makeCaseStatus("deployed"));

    const { rerender } = renderHook(
      ({ caseId }: { caseId: string | null }) =>
        useDefaultLayoutOnCaseChange({
          activeCaseId: caseId,
          userId: "user_001",
          setParams: mockSetParams,
        }),
      { initialProps: { caseId: "case_001" as string | null } }
    );

    // Initial render: case_001 (deployed) → M2+T3
    expect(mockSetParams).toHaveBeenCalledOnce();
    mockSetParams.mockClear();

    // Deselect the case (close panel)
    mockUseCaseStatus.mockReturnValue(undefined); // skip triggers undefined
    rerender({ caseId: null });

    // setParams should NOT be called when case is deselected
    expect(mockSetParams).not.toHaveBeenCalled();
  });
});
