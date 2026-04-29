/**
 * @vitest-environment jsdom
 *
 * Unit tests for useCurrentUser hook.
 *
 * Tests cover:
 *   1. Loading state — roles empty, all permission helpers return false.
 *   2. Technician role — isTechnician true, can() true for INSPECTION_START,
 *      false for CASE_CREATE (admin-only).
 *   3. Pilot role — isPilot true, isTechnician false, can() false for
 *      INSPECTION_START and QR_CODE_GENERATE, true for CASE_SHIP.
 *   4. Admin role — isAdmin true, isTechnician true (superset), can()
 *      true for all operations.
 *   5. Multiple roles — union of permissions applied correctly.
 *   6. Unknown roles in accessToken are filtered out.
 *   7. primaryRole resolution order: admin > technician > pilot.
 *   8. No roles → primaryRole is null, can() always false.
 *
 * Run with: npx vitest run src/hooks/__tests__/use-current-user.test.tsx
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// We need to mock both useKindeBrowserClient and useKindeUser to control
// the Kinde state without a real Kinde provider.

vi.mock("@kinde-oss/kinde-auth-nextjs", () => ({
  useKindeBrowserClient: vi.fn(),
}));

vi.mock("../use-kinde-user", () => ({
  useKindeUser: vi.fn(),
}));

import { useKindeBrowserClient } from "@kinde-oss/kinde-auth-nextjs";
import { useKindeUser } from "../use-kinde-user";
import { useCurrentUser } from "../use-current-user";
import { OPERATIONS } from "../../../convex/rbac";

// Typed mock helpers
const mockUseKindeBrowserClient = useKindeBrowserClient as ReturnType<typeof vi.fn>;
const mockUseKindeUser = useKindeUser as ReturnType<typeof vi.fn>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal Kinde access token mock with the given role keys. */
function mockKindeState(roleKeys: string[]) {
  const roles = roleKeys.map((key, i) => ({
    id: `role-${i}`,
    key,
    name: key.charAt(0).toUpperCase() + key.slice(1),
  }));
  mockUseKindeBrowserClient.mockReturnValue({
    accessToken: { roles },
  });
}

/** Set the user identity state returned by useKindeUser. */
function mockIdentityState({
  isLoading = false,
  isAuthenticated = true,
  id = "kinde_test_user",
  name = "Test User",
} = {}) {
  mockUseKindeUser.mockReturnValue({ id, name, isLoading, isAuthenticated });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── 1. Loading state ─────────────────────────────────────────────────────────

describe("useCurrentUser — loading state", () => {
  it("returns isLoading true when Kinde session is resolving", () => {
    mockIdentityState({ isLoading: true, isAuthenticated: false });
    mockKindeState([]);

    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.isLoading).toBe(true);
  });

  it("returns empty roles array while loading", () => {
    mockIdentityState({ isLoading: true, isAuthenticated: false });
    mockKindeState([]);

    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.roles).toHaveLength(0);
  });

  it("returns null primaryRole while loading", () => {
    mockIdentityState({ isLoading: true, isAuthenticated: false });
    mockKindeState([]);

    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.primaryRole).toBeNull();
  });

  it("can() returns false for every operation while loading", () => {
    mockIdentityState({ isLoading: true, isAuthenticated: false });
    mockKindeState([]);

    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.can(OPERATIONS.CASE_READ)).toBe(false);
    expect(result.current.can(OPERATIONS.INSPECTION_START)).toBe(false);
    expect(result.current.can(OPERATIONS.CASE_SHIP)).toBe(false);
  });

  it("isAdmin, isTechnician, isPilot are all false while loading", () => {
    mockIdentityState({ isLoading: true, isAuthenticated: false });
    mockKindeState([]);

    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isTechnician).toBe(false);
    expect(result.current.isPilot).toBe(false);
  });
});

// ─── 2. Technician role ───────────────────────────────────────────────────────

describe("useCurrentUser — technician role", () => {
  beforeEach(() => {
    mockIdentityState();
    mockKindeState(["technician"]);
  });

  it("sets isTechnician to true", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.isTechnician).toBe(true);
  });

  it("sets isPilot to false", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.isPilot).toBe(false);
  });

  it("sets isAdmin to false", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.isAdmin).toBe(false);
  });

  it("sets primaryRole to 'technician'", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.primaryRole).toBe("technician");
  });

  it("can() returns true for INSPECTION_START", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.can(OPERATIONS.INSPECTION_START)).toBe(true);
  });

  it("can() returns true for INSPECTION_UPDATE_ITEM", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.can(OPERATIONS.INSPECTION_UPDATE_ITEM)).toBe(true);
  });

  it("can() returns true for QR_CODE_GENERATE", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.can(OPERATIONS.QR_CODE_GENERATE)).toBe(true);
  });

  it("can() returns true for CASE_SHIP (universal)", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.can(OPERATIONS.CASE_SHIP)).toBe(true);
  });

  it("can() returns false for CASE_CREATE (admin-only)", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.can(OPERATIONS.CASE_CREATE)).toBe(false);
  });

  it("can() returns false for FEATURE_FLAG_MANAGE (admin-only)", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.can(OPERATIONS.FEATURE_FLAG_MANAGE)).toBe(false);
  });

  it("roles array contains 'technician'", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.roles).toContain("technician");
  });
});

// ─── 3. Pilot role ────────────────────────────────────────────────────────────

describe("useCurrentUser — pilot role", () => {
  beforeEach(() => {
    mockIdentityState();
    mockKindeState(["pilot"]);
  });

  it("sets isPilot to true", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.isPilot).toBe(true);
  });

  it("sets isTechnician to false", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.isTechnician).toBe(false);
  });

  it("sets isAdmin to false", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.isAdmin).toBe(false);
  });

  it("sets primaryRole to 'pilot'", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.primaryRole).toBe("pilot");
  });

  it("can() returns false for INSPECTION_START (technician-only)", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.can(OPERATIONS.INSPECTION_START)).toBe(false);
  });

  it("can() returns false for INSPECTION_UPDATE_ITEM (technician-only)", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.can(OPERATIONS.INSPECTION_UPDATE_ITEM)).toBe(false);
  });

  it("can() returns false for INSPECTION_COMPLETE (technician-only)", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.can(OPERATIONS.INSPECTION_COMPLETE)).toBe(false);
  });

  it("can() returns false for QR_CODE_GENERATE (technician-only)", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.can(OPERATIONS.QR_CODE_GENERATE)).toBe(false);
  });

  it("can() returns true for CASE_SHIP (universal — pilots can ship)", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.can(OPERATIONS.CASE_SHIP)).toBe(true);
  });

  it("can() returns true for CUSTODY_TRANSFER (universal — pilots can hand off)", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.can(OPERATIONS.CUSTODY_TRANSFER)).toBe(true);
  });

  it("can() returns true for DAMAGE_REPORT (universal — pilots can report damage)", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.can(OPERATIONS.DAMAGE_REPORT)).toBe(true);
  });

  it("can() returns true for QR_CODE_READ (pilots can scan QR codes)", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.can(OPERATIONS.QR_CODE_READ)).toBe(true);
  });

  it("can() returns false for CASE_CREATE (admin-only)", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.can(OPERATIONS.CASE_CREATE)).toBe(false);
  });
});

// ─── 4. Admin role ────────────────────────────────────────────────────────────

describe("useCurrentUser — admin role", () => {
  beforeEach(() => {
    mockIdentityState();
    mockKindeState(["admin"]);
  });

  it("sets isAdmin to true", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.isAdmin).toBe(true);
  });

  it("sets isTechnician to true (admin is superset of technician)", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.isTechnician).toBe(true);
  });

  it("sets primaryRole to 'admin'", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.primaryRole).toBe("admin");
  });

  it("can() returns true for CASE_CREATE (admin-only)", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.can(OPERATIONS.CASE_CREATE)).toBe(true);
  });

  it("can() returns true for FEATURE_FLAG_MANAGE (admin-only)", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.can(OPERATIONS.FEATURE_FLAG_MANAGE)).toBe(true);
  });

  it("can() returns true for INSPECTION_START (technician+)", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.can(OPERATIONS.INSPECTION_START)).toBe(true);
  });

  it("can() returns true for TELEMETRY_READ (admin-only)", () => {
    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.can(OPERATIONS.TELEMETRY_READ)).toBe(true);
  });
});

// ─── 5. Multiple roles (union semantics) ──────────────────────────────────────

describe("useCurrentUser — multiple roles", () => {
  it("pilot + technician → can do INSPECTION_START (technician permission)", () => {
    mockIdentityState();
    mockKindeState(["pilot", "technician"]);

    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.can(OPERATIONS.INSPECTION_START)).toBe(true);
    expect(result.current.isTechnician).toBe(true);
    expect(result.current.isPilot).toBe(true);
  });

  it("pilot + technician → primaryRole is 'technician' (higher privilege wins)", () => {
    mockIdentityState();
    mockKindeState(["pilot", "technician"]);

    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.primaryRole).toBe("technician");
  });

  it("technician + admin → primaryRole is 'admin' (highest privilege wins)", () => {
    mockIdentityState();
    mockKindeState(["technician", "admin"]);

    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.primaryRole).toBe("admin");
  });

  it("pilot + admin → can do CASE_CREATE (admin permission)", () => {
    mockIdentityState();
    mockKindeState(["pilot", "admin"]);

    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.can(OPERATIONS.CASE_CREATE)).toBe(true);
  });
});

// ─── 6. Unknown / invalid roles filtered out ──────────────────────────────────

describe("useCurrentUser — unknown roles are filtered", () => {
  it("unknown role 'superadmin' is excluded from roles array", () => {
    mockIdentityState();
    mockKindeState(["superadmin"]);

    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.roles).toHaveLength(0);
    expect(result.current.primaryRole).toBeNull();
  });

  it("mix of unknown + valid role: valid role takes effect", () => {
    mockIdentityState();
    mockKindeState(["ghost", "technician"]);

    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.roles).toContain("technician");
    expect(result.current.roles).not.toContain("ghost");
    expect(result.current.isTechnician).toBe(true);
  });

  it("no accessToken → roles is empty, primaryRole null", () => {
    mockIdentityState();
    mockUseKindeBrowserClient.mockReturnValue({ accessToken: null });

    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.roles).toHaveLength(0);
    expect(result.current.primaryRole).toBeNull();
  });
});

// ─── 7. primaryRole resolution order ─────────────────────────────────────────

describe("useCurrentUser — primaryRole resolution order", () => {
  it("admin wins over technician and pilot when all three are present", () => {
    mockIdentityState();
    mockKindeState(["pilot", "technician", "admin"]);

    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.primaryRole).toBe("admin");
  });

  it("technician wins over pilot when both are present", () => {
    mockIdentityState();
    mockKindeState(["pilot", "technician"]);

    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.primaryRole).toBe("technician");
  });

  it("pilot when only pilot is present", () => {
    mockIdentityState();
    mockKindeState(["pilot"]);

    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.primaryRole).toBe("pilot");
  });

  it("null when no valid roles are present", () => {
    mockIdentityState();
    mockKindeState([]);

    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.primaryRole).toBeNull();
  });
});

// ─── 8. Identity fields passed through correctly ──────────────────────────────

describe("useCurrentUser — identity fields", () => {
  it("returns id from useKindeUser", () => {
    mockIdentityState({ id: "kinde_abc123" });
    mockKindeState(["technician"]);

    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.id).toBe("kinde_abc123");
  });

  it("returns name from useKindeUser", () => {
    mockIdentityState({ name: "Alice Smith" });
    mockKindeState(["pilot"]);

    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.name).toBe("Alice Smith");
  });

  it("returns isAuthenticated from useKindeUser", () => {
    mockIdentityState({ isAuthenticated: true });
    mockKindeState(["technician"]);

    const { result } = renderHook(() => useCurrentUser());
    expect(result.current.isAuthenticated).toBe(true);
  });
});
