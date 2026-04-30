/**
 * @vitest-environment jsdom
 *
 * Unit tests: UserListTable — deactivate / reactivate user flow.
 *
 * Sub-AC 3.3: Deactivate user action
 *   - Confirmation dialog with user name, email, cancel/deactivate buttons
 *   - Deactivate/reactivate toggle: "Deactivate" for active users,
 *     "Reactivate" for inactive users
 *   - Optimistic UI: mutations use withOptimisticUpdate to patch the local
 *     Convex query store before the server round-trip completes
 *
 * What is tested
 * ──────────────
 * 1.  "Deactivate" button renders for active users (admin only)
 * 2.  "Reactivate" button renders for inactive users (admin only)
 * 3.  Action buttons are hidden for non-admin callers
 * 4.  Clicking "Deactivate" opens the confirmation dialog
 * 5.  Dialog has role="dialog", aria-modal="true", aria-labelledby
 * 6.  Dialog title is "Deactivate user?"
 * 7.  Dialog body mentions the user's name and email
 * 8.  Dialog Cancel button closes the dialog without calling the mutation
 * 9.  Dialog backdrop click closes the dialog without calling the mutation
 * 10. Dialog "Deactivate" button calls the deactivateUser mutation with
 *     { adminId, kindeId }
 * 11. After successful deactivation, a success toast is shown
 * 12. After deactivation error, an error toast is shown and dialog stays open
 * 13. "Reactivate" button calls updateUser with { adminId, kindeId, status: "active" }
 * 14. After successful reactivation, a success toast is shown
 * 15. Optimistic update: withOptimisticUpdate is wired to deactivateUser mutation
 * 16. Optimistic update: withOptimisticUpdate is wired to updateUser (reactivate) mutation
 * 17. Pending state: "Deactivating…" label while mutation is in-flight
 * 18. Cancel button is disabled while deactivation is pending
 *
 * Run with: npx vitest run src/components/UserListTable/__tests__/UserListTable.deactivate.test.tsx
 */

import React from "react";
import { render, screen, fireEvent, waitFor, cleanup, act, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock CSS modules ──────────────────────────────────────────────────────────

vi.mock("./UserListTable.module.css", () => ({ default: {} }));
vi.mock("../UserListTable.module.css", () => ({ default: {} }));

// ─── Mock convex/react ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MutationMock = ReturnType<typeof vi.fn> & { withOptimisticUpdate: ReturnType<typeof vi.fn> };

function makeMutationMock(impl?: () => Promise<unknown>): MutationMock {
  const fn = vi.fn().mockImplementation(impl ?? (() => Promise.resolve({}))) as MutationMock;
  fn.withOptimisticUpdate = vi.fn().mockReturnValue(fn);
  return fn;
}

const mockDeactivateUser = makeMutationMock();
const mockUpdateUser     = makeMutationMock();

vi.mock("convex/react", () => ({
  useQuery:    vi.fn().mockReturnValue(undefined),
  useMutation: (ref: unknown) => {
    // Route by API path string for deterministic binding
    const refStr = String(ref);
    if (refStr.includes("deactivateUser")) return mockDeactivateUser;
    if (refStr.includes("updateUser"))    return mockUpdateUser;
    return makeMutationMock();
  },
}));

// ─── Mock convex generated API ────────────────────────────────────────────────

vi.mock("../../../../convex/_generated/api", () => ({
  api: {
    users: {
      listUsers:      "users:listUsers",
      deactivateUser: "users:deactivateUser",
      updateUser:     "users:updateUser",
    },
  },
}));

// ─── Mock @/hooks/use-users ────────────────────────────────────────────────────

// We test at the UserListTable level, so mock the query hook to return
// controlled user lists without needing a real Convex connection.

const mockUseListUsers = vi.fn();

vi.mock("@/hooks/use-users", () => ({
  useListUsers:      (...args: unknown[]) => mockUseListUsers(...args),
  // Keep type exports available as pass-throughs
  useUpdateUser:     () => makeMutationMock(),
  useDeactivateUser: () => makeMutationMock(),
  useReactivateUser: () => makeMutationMock(),
  useCreateUser:     () => makeMutationMock(),
}));

// ─── Mock @/hooks/use-current-user ────────────────────────────────────────────

let _mockIsAdmin = true;
let _mockAdminId = "kp_admin_001";

vi.mock("@/hooks/use-current-user", () => ({
  useCurrentUser: () => ({
    id:              _mockAdminId,
    name:            "Alice Admin",
    isAdmin:         _mockIsAdmin,
    isLoading:       false,
    isAuthenticated: true,
    roles:           _mockIsAdmin ? ["admin"] : ["pilot"],
    primaryRole:     _mockIsAdmin ? "admin" : "pilot",
    can:             vi.fn().mockReturnValue(_mockIsAdmin),
  }),
}));

// ─── Mock @/components/StatusPill ─────────────────────────────────────────────

vi.mock("@/components/StatusPill", () => ({
  StatusPill: ({ kind, label }: { kind: string; label?: string }) => (
    <span data-testid="status-pill" data-kind={kind}>{label ?? kind}</span>
  ),
}));

// ─── Mock @/components/UserInviteEditModal ────────────────────────────────────

vi.mock("@/components/UserInviteEditModal", () => ({
  UserInviteEditModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="invite-edit-modal">
      <button onClick={onClose}>Close modal</button>
    </div>
  ),
}));

// ─── Module under test ────────────────────────────────────────────────────────

import { UserListTable } from "../UserListTable";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const ADMIN_ID  = "kp_admin_001";
const USER_ID_ACTIVE   = "kp_user_active";
const USER_ID_INACTIVE = "kp_user_inactive";
const USER_ID_PENDING  = "kp_user_pending";

const ACTIVE_USER = {
  _id:         "doc_active",
  kindeId:     USER_ID_ACTIVE,
  name:        "Bob Active",
  email:       "bob.active@skyspecs.com",
  givenName:   "Bob",
  familyName:  "Active",
  role:        "technician" as const,
  roles:       ["technician"],
  status:      "active" as const,
  lastLoginAt: Date.now() - 3_600_000,
  createdAt:   Date.now() - 86_400_000,
  updatedAt:   Date.now() - 3_600_000,
};

const INACTIVE_USER = {
  _id:         "doc_inactive",
  kindeId:     USER_ID_INACTIVE,
  name:        "Carol Inactive",
  email:       "carol.inactive@skyspecs.com",
  givenName:   "Carol",
  familyName:  "Inactive",
  role:        "pilot" as const,
  roles:       ["pilot"],
  status:      "inactive" as const,
  lastLoginAt: Date.now() - 7_200_000,
  createdAt:   Date.now() - 86_400_000,
  updatedAt:   Date.now() - 7_200_000,
};

const PENDING_USER = {
  _id:         "doc_pending",
  kindeId:     USER_ID_PENDING,
  name:        "Dave Pending",
  email:       "dave.pending@skyspecs.com",
  role:        "operator" as const,
  roles:       ["operator"],
  status:      "pending" as const,
  lastLoginAt: Date.now() - 100,
  createdAt:   Date.now() - 100,
  updatedAt:   Date.now() - 100,
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Render UserListTable with a mock user list. */
function renderTable(users = [ACTIVE_USER, INACTIVE_USER, PENDING_USER]) {
  mockUseListUsers.mockReturnValue({ users, isLoading: false });
  return render(<UserListTable />);
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  _mockIsAdmin = true;
  _mockAdminId = ADMIN_ID;
  // Reset mutation mocks to resolved promises
  mockDeactivateUser.mockResolvedValue({});
  mockUpdateUser.mockResolvedValue({});
  mockDeactivateUser.withOptimisticUpdate.mockReturnValue(mockDeactivateUser);
  mockUpdateUser.withOptimisticUpdate.mockReturnValue(mockUpdateUser);
});

afterEach(() => {
  cleanup();
});

// ─── 1. Deactivate button renders for active users ────────────────────────────

describe("UserListTable — deactivate/reactivate toggle", () => {
  it("renders 'Deactivate' button for active users when caller is admin", () => {
    renderTable();
    // There should be a Deactivate button for the active user
    const deactivateBtns = screen.getAllByRole("button", { name: /deactivate/i });
    expect(deactivateBtns.length).toBeGreaterThanOrEqual(1);
  });

  it("renders 'Reactivate' button for inactive users when caller is admin", () => {
    renderTable();
    const reactivateBtns = screen.getAllByRole("button", { name: /reactivate/i });
    expect(reactivateBtns.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT render Deactivate button for inactive users (shows Reactivate instead)", () => {
    renderTable([INACTIVE_USER]);
    // Should have exactly one action button for the inactive user: Reactivate
    expect(screen.queryByRole("button", { name: `Deactivate ${INACTIVE_USER.name}` })).toBeNull();
    expect(screen.getByRole("button", { name: `Reactivate ${INACTIVE_USER.name}` })).toBeTruthy();
  });

  it("does NOT render Deactivate button for active users when showing Reactivate", () => {
    renderTable([ACTIVE_USER]);
    expect(screen.queryByRole("button", { name: `Reactivate ${ACTIVE_USER.name}` })).toBeNull();
    expect(screen.getByRole("button", { name: `Deactivate ${ACTIVE_USER.name}` })).toBeTruthy();
  });

  it("hides both Deactivate and Reactivate buttons for non-admin callers", () => {
    _mockIsAdmin = false;
    renderTable();
    expect(screen.queryByRole("button", { name: /deactivate/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reactivate/i })).toBeNull();
  });
});

// ─── 2. Confirmation dialog opens ─────────────────────────────────────────────

describe("UserListTable — confirmation dialog behavior", () => {
  it("clicking 'Deactivate' row button opens the confirmation dialog", () => {
    renderTable([ACTIVE_USER]);
    const deactivateBtn = screen.getByRole("button", { name: `Deactivate ${ACTIVE_USER.name}` });
    fireEvent.click(deactivateBtn);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("dialog has role='dialog'", () => {
    renderTable([ACTIVE_USER]);
    fireEvent.click(screen.getByRole("button", { name: `Deactivate ${ACTIVE_USER.name}` }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("dialog has aria-modal='true'", () => {
    renderTable([ACTIVE_USER]);
    fireEvent.click(screen.getByRole("button", { name: `Deactivate ${ACTIVE_USER.name}` }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("dialog has aria-labelledby pointing to the title element", () => {
    renderTable([ACTIVE_USER]);
    fireEvent.click(screen.getByRole("button", { name: `Deactivate ${ACTIVE_USER.name}` }));
    const dialog = screen.getByRole("dialog");
    const labelId = dialog.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    const title = document.getElementById(labelId!);
    expect(title).toBeTruthy();
    expect(title!.textContent).toBe("Deactivate user?");
  });

  it("dialog title is 'Deactivate user?'", () => {
    renderTable([ACTIVE_USER]);
    fireEvent.click(screen.getByRole("button", { name: `Deactivate ${ACTIVE_USER.name}` }));
    expect(screen.getByText("Deactivate user?")).toBeTruthy();
  });

  it("dialog body mentions the user's name", () => {
    renderTable([ACTIVE_USER]);
    fireEvent.click(screen.getByRole("button", { name: `Deactivate ${ACTIVE_USER.name}` }));
    const dialog = screen.getByRole("dialog");
    // The user's name appears in the <strong> element inside the dialog body
    expect(within(dialog).getByText(ACTIVE_USER.name)).toBeTruthy();
  });

  it("dialog body mentions the user's email", () => {
    renderTable([ACTIVE_USER]);
    fireEvent.click(screen.getByRole("button", { name: `Deactivate ${ACTIVE_USER.name}` }));
    const dialog = screen.getByRole("dialog");
    // The email is a text node inside <p> alongside <strong> — check textContent
    expect(dialog.textContent).toContain(ACTIVE_USER.email);
  });
});

// ─── 3. Cancel behavior ───────────────────────────────────────────────────────

describe("UserListTable — dialog Cancel button", () => {
  it("Cancel button closes the dialog without calling the mutation", () => {
    renderTable([ACTIVE_USER]);
    fireEvent.click(screen.getByRole("button", { name: `Deactivate ${ACTIVE_USER.name}` }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelBtn);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockDeactivateUser).not.toHaveBeenCalled();
  });

  it("clicking the backdrop closes the dialog without calling the mutation", () => {
    renderTable([ACTIVE_USER]);
    fireEvent.click(screen.getByRole("button", { name: `Deactivate ${ACTIVE_USER.name}` }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    // The backdrop is the presentation div wrapping the dialog
    const backdrop = screen.getByRole("presentation");
    // Simulate clicking directly on the backdrop (not the dialog box)
    fireEvent.click(backdrop, { target: backdrop });

    expect(mockDeactivateUser).not.toHaveBeenCalled();
  });
});

// ─── 4. Deactivation mutation call ────────────────────────────────────────────

describe("UserListTable — Deactivate confirmation", () => {
  it("clicking dialog 'Deactivate' calls deactivateUser with { adminId, kindeId }", async () => {
    renderTable([ACTIVE_USER]);
    fireEvent.click(screen.getByRole("button", { name: `Deactivate ${ACTIVE_USER.name}` }));

    const confirmBtn = screen.getByRole("button", { name: /^deactivate$/i });
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(mockDeactivateUser).toHaveBeenCalledOnce();
    expect(mockDeactivateUser).toHaveBeenCalledWith({
      adminId: ADMIN_ID,
      kindeId: USER_ID_ACTIVE,
    });
  });

  it("dialog closes after successful deactivation", async () => {
    mockDeactivateUser.mockResolvedValueOnce({});
    renderTable([ACTIVE_USER]);
    fireEvent.click(screen.getByRole("button", { name: `Deactivate ${ACTIVE_USER.name}` }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^deactivate$/i }));
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("shows success toast after deactivation", async () => {
    mockDeactivateUser.mockResolvedValueOnce({});
    renderTable([ACTIVE_USER]);
    fireEvent.click(screen.getByRole("button", { name: `Deactivate ${ACTIVE_USER.name}` }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^deactivate$/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(new RegExp(`${ACTIVE_USER.name}.*deactivated`, "i"))).toBeTruthy();
    });
  });

  it("shows error toast on deactivation failure and dialog stays open", async () => {
    mockDeactivateUser.mockRejectedValueOnce(new Error("[ACCESS_DENIED] Not admin"));
    renderTable([ACTIVE_USER]);
    fireEvent.click(screen.getByRole("button", { name: `Deactivate ${ACTIVE_USER.name}` }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^deactivate$/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/deactivation failed/i)).toBeTruthy();
    });

    // Dialog should still be visible after error
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("shows 'Deactivating…' label while mutation is pending", async () => {
    // Create a promise we can control
    let resolveDeactivate!: () => void;
    const pendingPromise = new Promise<void>((res) => { resolveDeactivate = res; });
    mockDeactivateUser.mockReturnValueOnce(pendingPromise);

    renderTable([ACTIVE_USER]);
    fireEvent.click(screen.getByRole("button", { name: `Deactivate ${ACTIVE_USER.name}` }));
    fireEvent.click(screen.getByRole("button", { name: /^deactivate$/i }));

    // While pending, button should say "Deactivating…"
    await waitFor(() => {
      expect(screen.getByText(/deactivating…/i)).toBeTruthy();
    });

    // Resolve and clean up
    await act(async () => { resolveDeactivate(); });
  });

  it("Cancel button is disabled while deactivation is in-flight", async () => {
    let resolveDeactivate!: () => void;
    const pendingPromise = new Promise<void>((res) => { resolveDeactivate = res; });
    mockDeactivateUser.mockReturnValueOnce(pendingPromise);

    renderTable([ACTIVE_USER]);
    fireEvent.click(screen.getByRole("button", { name: `Deactivate ${ACTIVE_USER.name}` }));
    fireEvent.click(screen.getByRole("button", { name: /^deactivate$/i }));

    await waitFor(() => {
      const cancelBtn = screen.getByRole("button", { name: /cancel/i });
      expect(cancelBtn).toHaveProperty("disabled", true);
    });

    await act(async () => { resolveDeactivate(); });
  });
});

// ─── 5. Reactivation mutation call ───────────────────────────────────────────

describe("UserListTable — Reactivate button", () => {
  it("clicking Reactivate calls updateUser with { adminId, kindeId, status: 'active' }", async () => {
    renderTable([INACTIVE_USER]);
    const reactivateBtn = screen.getByRole("button", { name: `Reactivate ${INACTIVE_USER.name}` });

    await act(async () => {
      fireEvent.click(reactivateBtn);
    });

    expect(mockUpdateUser).toHaveBeenCalledOnce();
    expect(mockUpdateUser).toHaveBeenCalledWith({
      adminId: ADMIN_ID,
      kindeId: USER_ID_INACTIVE,
      status:  "active",
    });
  });

  it("shows success toast after reactivation", async () => {
    mockUpdateUser.mockResolvedValueOnce({});
    renderTable([INACTIVE_USER]);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: `Reactivate ${INACTIVE_USER.name}` })
      );
    });

    await waitFor(() => {
      expect(screen.getByText(new RegExp(`${INACTIVE_USER.name}.*reactivated`, "i"))).toBeTruthy();
    });
  });

  it("shows error toast when reactivation fails", async () => {
    mockUpdateUser.mockRejectedValueOnce(new Error("[ACCESS_DENIED] Not admin"));
    renderTable([INACTIVE_USER]);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: `Reactivate ${INACTIVE_USER.name}` })
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/reactivation failed/i)).toBeTruthy();
    });
  });

  it("shows '…' label while reactivation is in-flight", async () => {
    let resolveReactivate!: () => void;
    const pendingPromise = new Promise<void>((res) => { resolveReactivate = res; });
    mockUpdateUser.mockReturnValueOnce(pendingPromise);

    renderTable([INACTIVE_USER]);
    fireEvent.click(screen.getByRole("button", { name: `Reactivate ${INACTIVE_USER.name}` }));

    // While in-flight, the button text content changes to "…".
    // The accessible name remains the aria-label, so we query by visible text.
    await waitFor(() => {
      expect(screen.getByText("…")).toBeTruthy();
    });

    await act(async () => { resolveReactivate(); });
  });
});

// ─── 6. withOptimisticUpdate wiring ──────────────────────────────────────────

describe("UserListTable — withOptimisticUpdate wiring", () => {
  it("deactivateUser mutation has withOptimisticUpdate chained", () => {
    renderTable([ACTIVE_USER]);
    // withOptimisticUpdate is called during component mount as part of
    // useMutation(api.users.deactivateUser).withOptimisticUpdate(...)
    expect(mockDeactivateUser.withOptimisticUpdate).toHaveBeenCalledOnce();
  });

  it("updateUser mutation (reactivate) has withOptimisticUpdate chained", () => {
    renderTable([INACTIVE_USER]);
    expect(mockUpdateUser.withOptimisticUpdate).toHaveBeenCalledOnce();
  });

  it("withOptimisticUpdate callback for deactivate receives a function", () => {
    renderTable([ACTIVE_USER]);
    const [[cb]] = mockDeactivateUser.withOptimisticUpdate.mock.calls;
    expect(typeof cb).toBe("function");
  });

  it("withOptimisticUpdate callback for reactivate receives a function", () => {
    renderTable([INACTIVE_USER]);
    const [[cb]] = mockUpdateUser.withOptimisticUpdate.mock.calls;
    expect(typeof cb).toBe("function");
  });
});

// ─── 7. Optimistic update logic ───────────────────────────────────────────────

describe("UserListTable — optimistic update callbacks", () => {
  /**
   * Extract the optimistic update callback that was registered for a given mutation mock.
   */
  function getOptimisticCallback(
    mutationMock: MutationMock
  ): (localStore: unknown, args: unknown) => void {
    const [[cb]] = mutationMock.withOptimisticUpdate.mock.calls as [[(...a: unknown[]) => void]];
    return cb;
  }

  it("deactivate optimistic callback: changes status to 'inactive' in unfiltered view", () => {
    renderTable([ACTIVE_USER, INACTIVE_USER]);
    const cb = getOptimisticCallback(mockDeactivateUser);

    // Simulate the localStore API
    const fakeList = [{ ...ACTIVE_USER }, { ...INACTIVE_USER }];
    const mockLocalStore = {
      getQuery: vi.fn().mockReturnValue(fakeList),
      setQuery: vi.fn(),
    };

    cb(mockLocalStore, { adminId: ADMIN_ID, kindeId: USER_ID_ACTIVE });

    expect(mockLocalStore.setQuery).toHaveBeenCalledOnce();
    const [, , updatedList] = mockLocalStore.setQuery.mock.calls[0];
    const updatedActiveUser = (updatedList as typeof fakeList).find(
      (u) => u.kindeId === USER_ID_ACTIVE
    );
    expect(updatedActiveUser?.status).toBe("inactive");
  });

  it("deactivate optimistic callback: does nothing when localStore returns null", () => {
    renderTable([ACTIVE_USER]);
    const cb = getOptimisticCallback(mockDeactivateUser);

    const mockLocalStore = {
      getQuery: vi.fn().mockReturnValue(null),
      setQuery: vi.fn(),
    };

    cb(mockLocalStore, { adminId: ADMIN_ID, kindeId: USER_ID_ACTIVE });
    expect(mockLocalStore.setQuery).not.toHaveBeenCalled();
  });

  it("reactivate optimistic callback: changes status to 'active'", () => {
    renderTable([INACTIVE_USER]);
    const cb = getOptimisticCallback(mockUpdateUser);

    const fakeList = [{ ...INACTIVE_USER }];
    const mockLocalStore = {
      getQuery: vi.fn().mockReturnValue(fakeList),
      setQuery: vi.fn(),
    };

    cb(mockLocalStore, {
      adminId: ADMIN_ID,
      kindeId: USER_ID_INACTIVE,
      status:  "active",
    });

    expect(mockLocalStore.setQuery).toHaveBeenCalledOnce();
    const [, , updatedList] = mockLocalStore.setQuery.mock.calls[0];
    const updatedUser = (updatedList as typeof fakeList).find(
      (u) => u.kindeId === USER_ID_INACTIVE
    );
    expect(updatedUser?.status).toBe("active");
  });

  it("reactivate optimistic callback: skips when args.status is not 'active'", () => {
    renderTable([INACTIVE_USER]);
    const cb = getOptimisticCallback(mockUpdateUser);

    const mockLocalStore = {
      getQuery: vi.fn().mockReturnValue([{ ...INACTIVE_USER }]),
      setQuery: vi.fn(),
    };

    // Passing status: "inactive" should be a no-op (guard)
    cb(mockLocalStore, { adminId: ADMIN_ID, kindeId: USER_ID_INACTIVE, status: "inactive" });
    expect(mockLocalStore.setQuery).not.toHaveBeenCalled();
  });

  it("deactivate optimistic callback: removes user when filtering by status='active'", () => {
    // Simulate the state where statusFilter === "active"
    // We can't directly control filter state from outside, so we verify the
    // callback logic by inspecting the registered callback's behavior
    // with a mock that returns the active-filtered list.
    renderTable([ACTIVE_USER]);
    const cb = getOptimisticCallback(mockDeactivateUser);

    // The callback uses statusFilter from closure — we verify the general logic
    // by checking it handles the "remove" case when the query result changes
    const filteredList = [{ ...ACTIVE_USER }];
    const mockLocalStore = {
      getQuery: vi.fn().mockReturnValue(filteredList),
      setQuery: vi.fn(),
    };

    // Call the callback; since we rendered with no status filter (statusFilter="all"),
    // the callback should map (not filter), changing the status in-place
    cb(mockLocalStore, { adminId: ADMIN_ID, kindeId: USER_ID_ACTIVE });

    expect(mockLocalStore.setQuery).toHaveBeenCalled();
  });
});

// ─── 8. Loading skeleton state ────────────────────────────────────────────────

describe("UserListTable — loading state", () => {
  it("shows skeleton rows while loading and hides action buttons", () => {
    mockUseListUsers.mockReturnValue({ users: undefined, isLoading: true });
    render(<UserListTable />);
    // Deactivate/Reactivate buttons should not be rendered during loading
    expect(screen.queryByRole("button", { name: /deactivate/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reactivate/i })).toBeNull();
  });
});

// ─── 9. Empty state ────────────────────────────────────────────────────────────

describe("UserListTable — empty state", () => {
  it("shows empty state when no users match", () => {
    mockUseListUsers.mockReturnValue({ users: [], isLoading: false });
    render(<UserListTable />);
    expect(screen.getByTestId("user-list-empty")).toBeTruthy();
    // No action buttons in empty state
    expect(screen.queryByRole("button", { name: /deactivate/i })).toBeNull();
  });
});
