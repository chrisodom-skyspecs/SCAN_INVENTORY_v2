/**
 * @vitest-environment jsdom
 *
 * src/providers/__tests__/user-identity-provider.test.tsx
 *
 * Unit tests for UserIdentityProvider and useUserIdentity().
 *
 * Covers:
 *   - Loading state (isLoading=true, before session resolves)
 *   - Unauthenticated state (isAuthenticated=false)
 *   - Authenticated state — full profile (given + family name)
 *   - Authenticated state — given name only
 *   - Authenticated state — email-only fallback
 *   - Authenticated state — ultimate "Operator" fallback
 *   - Role extraction from accessToken.roles
 *   - Unknown roles are filtered out
 *   - useUserIdentity() throws outside provider
 *
 * Run with: npx vitest run src/providers/__tests__/user-identity-provider.test.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { UserIdentityProvider, useUserIdentity } from "../user-identity-provider";

// ─── Global cleanup ───────────────────────────────────────────────────────────
// Unmount all rendered components after each test so the DOM is clean
// for the next test (prevents "Found multiple elements" errors).
afterEach(() => {
  cleanup();
});

// ─── Mock: @kinde-oss/kinde-auth-nextjs ──────────────────────────────────────

const mockKindeState = {
  user: null as null | {
    id: string;
    email: string | null;
    given_name: string | null;
    family_name: string | null;
    picture: string | null;
  },
  accessToken: null as null | {
    roles?: Array<{ id: string; key: string; name: string }>;
  },
  isAuthenticated: false as boolean | null,
  isLoading: true as boolean | null,
};

vi.mock("@kinde-oss/kinde-auth-nextjs", () => ({
  useKindeBrowserClient: () => mockKindeState,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Render a component that reads from useUserIdentity() inside the provider. */
function renderWithProvider(ui: React.ReactNode) {
  return render(<UserIdentityProvider>{ui}</UserIdentityProvider>);
}

/** Consumer component that exposes user identity fields as data-* attributes. */
function IdentityDisplay() {
  const { id, email, name, roles, isLoading, isAuthenticated } = useUserIdentity();
  return (
    <div
      data-testid="identity"
      data-id={id}
      data-email={email ?? "null"}
      data-name={name}
      data-roles={roles.join(",")}
      data-loading={String(isLoading)}
      data-authenticated={String(isAuthenticated)}
    />
  );
}

function getIdentity() {
  const el = screen.getByTestId("identity");
  return {
    id: el.getAttribute("data-id") ?? "",
    email: el.getAttribute("data-email") ?? "",
    name: el.getAttribute("data-name") ?? "",
    roles: el.getAttribute("data-roles") ?? "",
    isLoading: el.getAttribute("data-loading") === "true",
    isAuthenticated: el.getAttribute("data-authenticated") === "true",
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("UserIdentityProvider — loading state", () => {
  beforeEach(() => {
    mockKindeState.user = null;
    mockKindeState.accessToken = null;
    mockKindeState.isAuthenticated = false;
    mockKindeState.isLoading = true;
  });

  it("exposes isLoading=true before session resolves", () => {
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().isLoading).toBe(true);
  });

  it("exposes empty id string while loading", () => {
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().id).toBe("");
  });

  it("exposes null email while loading (rendered as 'null')", () => {
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().email).toBe("null");
  });

  it("exposes fallback name 'Operator' while loading", () => {
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().name).toBe("Operator");
  });

  it("exposes empty roles array while loading", () => {
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().roles).toBe("");
  });
});

// ─── Unauthenticated state ───────────────────────────────────────────────────

describe("UserIdentityProvider — unauthenticated state", () => {
  beforeEach(() => {
    mockKindeState.user = null;
    mockKindeState.accessToken = null;
    mockKindeState.isAuthenticated = false;
    mockKindeState.isLoading = false;
  });

  it("exposes isAuthenticated=false", () => {
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().isAuthenticated).toBe(false);
  });

  it("exposes empty id when not authenticated", () => {
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().id).toBe("");
  });

  it("exposes 'Operator' name when not authenticated", () => {
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().name).toBe("Operator");
  });

  it("exposes empty roles when not authenticated", () => {
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().roles).toBe("");
  });
});

// ─── Authenticated — full profile ─────────────────────────────────────────────

describe("UserIdentityProvider — authenticated with full profile", () => {
  beforeEach(() => {
    mockKindeState.user = {
      id: "kinde_user_abc123",
      email: "jane.smith@skyspecs.com",
      given_name: "Jane",
      family_name: "Smith",
      picture: null,
    };
    mockKindeState.accessToken = {
      roles: [
        { id: "role_001", key: "admin", name: "Admin" },
      ],
    };
    mockKindeState.isAuthenticated = true;
    mockKindeState.isLoading = false;
  });

  it("exposes the Kinde user id", () => {
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().id).toBe("kinde_user_abc123");
  });

  it("exposes the user email", () => {
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().email).toBe("jane.smith@skyspecs.com");
  });

  it("resolves 'Given Family' display name when both names are present", () => {
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().name).toBe("Jane Smith");
  });

  it("exposes roles as comma-separated key strings", () => {
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().roles).toBe("admin");
  });

  it("exposes isAuthenticated=true", () => {
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().isAuthenticated).toBe(true);
  });

  it("exposes isLoading=false", () => {
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().isLoading).toBe(false);
  });
});

// ─── Authenticated — given name only ─────────────────────────────────────────

describe("UserIdentityProvider — authenticated, given name only", () => {
  beforeEach(() => {
    mockKindeState.user = {
      id: "kinde_user_456",
      email: "alex@example.com",
      given_name: "Alex",
      family_name: null,
      picture: null,
    };
    mockKindeState.accessToken = {
      roles: [
        { id: "role_002", key: "technician", name: "Technician" },
      ],
    };
    mockKindeState.isAuthenticated = true;
    mockKindeState.isLoading = false;
  });

  it("resolves given name only when family name is absent", () => {
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().name).toBe("Alex");
  });

  it("exposes technician role", () => {
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().roles).toBe("technician");
  });
});

// ─── Authenticated — email fallback ───────────────────────────────────────────

describe("UserIdentityProvider — authenticated, email as name fallback", () => {
  beforeEach(() => {
    mockKindeState.user = {
      id: "kinde_user_789",
      email: "pilot.user@skyspecs.com",
      given_name: null,
      family_name: null,
      picture: null,
    };
    mockKindeState.accessToken = {
      roles: [{ id: "role_003", key: "pilot", name: "Pilot" }],
    };
    mockKindeState.isAuthenticated = true;
    mockKindeState.isLoading = false;
  });

  it("resolves email local-part when no name fields are present", () => {
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().name).toBe("pilot.user");
  });

  it("still exposes the full email", () => {
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().email).toBe("pilot.user@skyspecs.com");
  });

  it("exposes pilot role", () => {
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().roles).toBe("pilot");
  });
});

// ─── Authenticated — ultimate fallback name ───────────────────────────────────

describe("UserIdentityProvider — authenticated, no name and no email", () => {
  beforeEach(() => {
    mockKindeState.user = {
      id: "kinde_user_000",
      email: null,
      given_name: null,
      family_name: null,
      picture: null,
    };
    mockKindeState.accessToken = null;
    mockKindeState.isAuthenticated = true;
    mockKindeState.isLoading = false;
  });

  it("falls back to 'Operator' when no name or email is available", () => {
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().name).toBe("Operator");
  });

  it("exposes empty roles when accessToken is null", () => {
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().roles).toBe("");
  });
});

// ─── Role extraction ──────────────────────────────────────────────────────────

describe("UserIdentityProvider — role extraction", () => {
  beforeEach(() => {
    mockKindeState.user = {
      id: "kinde_user_multi",
      email: "multi@example.com",
      given_name: "Multi",
      family_name: "Role",
      picture: null,
    };
    mockKindeState.isAuthenticated = true;
    mockKindeState.isLoading = false;
  });

  it("extracts multiple valid roles from the access token", () => {
    mockKindeState.accessToken = {
      roles: [
        { id: "r1", key: "admin", name: "Admin" },
        { id: "r2", key: "technician", name: "Technician" },
      ],
    };
    renderWithProvider(<IdentityDisplay />);
    const roles = getIdentity().roles.split(",");
    expect(roles).toContain("admin");
    expect(roles).toContain("technician");
    expect(roles).toHaveLength(2);
  });

  it("filters out unknown role keys not in RBAC system", () => {
    mockKindeState.accessToken = {
      roles: [
        { id: "r1", key: "admin", name: "Admin" },
        { id: "r2", key: "superuser", name: "SuperUser" }, // unknown
        { id: "r3", key: "manager", name: "Manager" },    // unknown
      ],
    };
    renderWithProvider(<IdentityDisplay />);
    const roles = getIdentity().roles.split(",").filter(Boolean);
    expect(roles).toEqual(["admin"]);
  });

  it("returns empty roles when accessToken has no roles field", () => {
    mockKindeState.accessToken = {};
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().roles).toBe("");
  });

  it("returns empty roles when accessToken.roles is an empty array", () => {
    mockKindeState.accessToken = { roles: [] };
    renderWithProvider(<IdentityDisplay />);
    expect(getIdentity().roles).toBe("");
  });

  it("all three valid roles are recognized", () => {
    mockKindeState.accessToken = {
      roles: [
        { id: "r1", key: "admin", name: "Admin" },
        { id: "r2", key: "technician", name: "Technician" },
        { id: "r3", key: "pilot", name: "Pilot" },
      ],
    };
    renderWithProvider(<IdentityDisplay />);
    const roles = getIdentity().roles.split(",");
    expect(roles).toContain("admin");
    expect(roles).toContain("technician");
    expect(roles).toContain("pilot");
    expect(roles).toHaveLength(3);
  });
});

// ─── Error boundary — useUserIdentity outside provider ───────────────────────

describe("useUserIdentity — outside provider", () => {
  it("throws when used outside a UserIdentityProvider", () => {
    // Suppress console.error for expected React error boundary output
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    function BadConsumer() {
      useUserIdentity(); // should throw
      return null;
    }

    expect(() => render(<BadConsumer />)).toThrow(
      /UserIdentityContext.*useUserIdentity.*must be used inside.*UserIdentityProvider/
    );

    spy.mockRestore();
  });
});
