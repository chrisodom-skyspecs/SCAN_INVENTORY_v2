/**
 * UserListTable — Admin UI for user management.
 *
 * Renders all registered users in a responsive table with real-time Convex
 * subscriptions.  Columns: name (with avatar), email, role badge, status pill,
 * and per-row action buttons (edit role, deactivate/reactivate).
 *
 * Features:
 *   - Real-time subscription via useListUsers (Convex pushes updates <300 ms)
 *   - Role filter tabs (All / Admin / Operator / Technician / Pilot)
 *   - Status filter tabs (All / Active / Inactive / Pending)
 *   - Row skeleton while the initial subscription loads
 *   - Empty state when no users match the active filter
 *   - Edit-role modal (in-place dropdown — admin, operator, technician, pilot)
 *   - Deactivate / Reactivate action with confirmation
 *   - Toast notifications for mutation feedback
 *
 * Design system compliance:
 *   - All colors via CSS custom properties (no hex literals)
 *   - Inter Tight for UI text; IBM Plex Mono for data/counts/timestamps
 *   - StatusPill for user status badges (active → "active", pending → "pending",
 *     inactive → "archived" kind with label="Inactive")
 *   - WCAG AA contrast in both light and dark themes
 *
 * Authorization:
 *   Admin-only actions (edit role, deactivate) are guarded by:
 *     1. Server-side: `requireAdmin` in convex/users.ts mutations
 *     2. Client-side: edit/deactivate buttons hidden for non-admin callers
 *
 * Data:
 *   Uses useListUsers() which wraps api.users.listUsers — a Convex useQuery
 *   subscription that re-runs whenever any user row is mutated.
 *   Local `roleFilter` / `statusFilter` state drives optional server-side
 *   filtering via the query args.
 */

"use client";

import { useState, useCallback, useId } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import {
  useListUsers,
  useReactivateUser,
  type UserSummary,
  type UserRole,
  type UserStatus,
} from "@/hooks/use-users";
import { useCurrentUser } from "@/hooks/use-current-user";
import { StatusPill } from "@/components/StatusPill";
import { UserInviteEditModal } from "@/components/UserInviteEditModal";
import styles from "./UserListTable.module.css";

// ─── Constants ─────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<UserRole, string> = {
  admin:      "Admin",
  operator:   "Operator",
  technician: "Technician",
  pilot:      "Pilot",
};

/** Map user status to StatusPill kind + optional label override. */
function statusPillProps(status: UserStatus): {
  kind: "active" | "pending" | "archived";
  label?: string;
} {
  switch (status) {
    case "active":   return { kind: "active" };
    case "pending":  return { kind: "pending" };
    case "inactive": return { kind: "archived", label: "Inactive" };
  }
}

// ─── Toast helpers ─────────────────────────────────────────────────────────────

interface Toast {
  id: string;
  message: string;
  variant: "success" | "error";
}

// ─── Avatar ────────────────────────────────────────────────────────────────────

interface AvatarProps {
  user: Pick<UserSummary, "name" | "givenName" | "familyName" | "picture">;
}

/**
 * Displays a small avatar: the user's Kinde profile photo if available,
 * otherwise a circle with their initials.
 */
function Avatar({ user }: AvatarProps) {
  const initials =
    user.givenName && user.familyName
      ? `${user.givenName[0]}${user.familyName[0]}`.toUpperCase()
      : user.name
          .split(" ")
          .slice(0, 2)
          .map((w) => w[0])
          .join("")
          .toUpperCase() || "?";

  if (user.picture) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.picture}
        alt={user.name}
        className={styles.avatarImg}
        width={32}
        height={32}
      />
    );
  }

  return (
    <span className={styles.avatarInitials} aria-hidden="true">
      {initials}
    </span>
  );
}

// ─── Role badge ────────────────────────────────────────────────────────────────

interface RoleBadgeProps {
  role: UserRole | undefined;
}

/**
 * Small pill badge for the user's resolved system role.
 * Each role gets a distinct --role-<name> accent token so it remains
 * distinguishable in both color and text.
 */
function RoleBadge({ role }: RoleBadgeProps) {
  if (!role) {
    return <span className={`${styles.roleBadge} ${styles.roleBadgeNone}`}>—</span>;
  }
  return (
    <span className={`${styles.roleBadge} ${styles[`roleBadge_${role}`]}`}>
      {ROLE_LABELS[role]}
    </span>
  );
}

// ─── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className={styles.skeletonRow} aria-hidden="true">
      <td className={styles.td}>
        <div className={styles.nameCellInner}>
          <div className={`${styles.skeletonBar} ${styles.skeletonAvatar}`} />
          <div className={styles.skeletonNameGroup}>
            <div className={`${styles.skeletonBar} ${styles.skeletonName}`} />
          </div>
        </div>
      </td>
      <td className={styles.td}>
        <div className={`${styles.skeletonBar} ${styles.skeletonEmail}`} />
      </td>
      <td className={styles.td}>
        <div className={`${styles.skeletonBar} ${styles.skeletonBadge}`} />
      </td>
      <td className={styles.td}>
        <div className={`${styles.skeletonBar} ${styles.skeletonBadge}`} />
      </td>
      <td className={styles.td} />
    </tr>
  );
}

// EditRoleModal replaced by UserInviteEditModal (mode="edit") — see below.

// ─── Deactivate confirm dialog ─────────────────────────────────────────────────

interface DeactivateConfirmDialogProps {
  user: UserSummary;
  adminId: string;
  /** Mutation handler with optimistic update, lifted from parent UserListTable. */
  onDeactivate: (args: { adminId: string; kindeId: string }) => Promise<unknown>;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

function DeactivateConfirmDialog({
  user,
  adminId,
  onDeactivate,
  onClose,
  onSuccess,
  onError,
}: DeactivateConfirmDialogProps) {
  const titleId = useId();
  const [pending, setPending] = useState(false);

  async function handleDeactivate() {
    setPending(true);
    try {
      await onDeactivate({ adminId, kindeId: user.kindeId });
      onSuccess(`${user.name} has been deactivated.`);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      onError(`Deactivation failed: ${msg}`);
      setPending(false);
    }
  }

  return (
    <div
      className={styles.dialogBackdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className={styles.dialogTitle}>
          Deactivate user?
        </h2>
        <p className={styles.dialogBody}>
          <strong>{user.name}</strong> ({user.email}) will no longer be able
          to log in. Their history, custody records, and inspection events are
          preserved. You can reactivate them later.
        </p>
        <div className={styles.dialogActions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnCancel}`}
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnDeactivate}`}
            onClick={handleDeactivate}
            disabled={pending}
          >
            {pending ? "Deactivating…" : "Deactivate"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Table row ─────────────────────────────────────────────────────────────────

interface UserRowProps {
  user: UserSummary;
  isAdmin: boolean;
  onEditRole: (user: UserSummary) => void;
  onDeactivate: (user: UserSummary) => void;
  onReactivate: (user: UserSummary) => Promise<void>;
}

function UserRow({
  user,
  isAdmin,
  onEditRole,
  onDeactivate,
  onReactivate,
}: UserRowProps) {
  const [reactivating, setReactivating] = useState(false);
  const pill = statusPillProps(user.status);
  const lastLogin = user.lastLoginAt
    ? formatRelativeTime(user.lastLoginAt)
    : "Never";

  async function handleReactivate() {
    setReactivating(true);
    try {
      await onReactivate(user);
    } finally {
      setReactivating(false);
    }
  }

  return (
    <tr className={styles.tr}>
      {/* Name + avatar */}
      <td className={styles.td} data-label="Name">
        <div className={styles.nameCellInner}>
          <Avatar user={user} />
          <div className={styles.nameGroup}>
            <span className={styles.userName}>{user.name}</span>
            <span className={styles.userLastLogin}>
              Last login: {lastLogin}
            </span>
          </div>
        </div>
      </td>

      {/* Email */}
      <td className={styles.td} data-label="Email">
        <span className={styles.emailCell}>{user.email}</span>
      </td>

      {/* Role badge */}
      <td className={styles.td} data-label="Role">
        <RoleBadge role={user.role} />
      </td>

      {/* Status pill */}
      <td className={styles.td} data-label="Status">
        <StatusPill kind={pill.kind} label={pill.label} />
      </td>

      {/* Actions */}
      <td className={styles.td} data-label="Actions">
        <div className={styles.actionGroup}>
          {isAdmin && (
            <>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnEdit}`}
                onClick={() => onEditRole(user)}
                aria-label={`Edit user ${user.name}`}
              >
                <PencilIcon className={styles.btnIcon} />
                Edit
              </button>

              {user.status === "inactive" ? (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnReactivate}`}
                  onClick={handleReactivate}
                  disabled={reactivating}
                  aria-label={`Reactivate ${user.name}`}
                >
                  <ArrowPathIcon className={styles.btnIcon} />
                  {reactivating ? "…" : "Reactivate"}
                </button>
              ) : (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnDeactivateRow}`}
                  onClick={() => onDeactivate(user)}
                  aria-label={`Deactivate ${user.name}`}
                >
                  <BanIcon className={styles.btnIcon} />
                  Deactivate
                </button>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Filter tab bar ────────────────────────────────────────────────────────────

interface FilterTabBarProps<T extends string> {
  label: string;
  options: Array<{ value: T | "all"; label: string }>;
  active: T | "all";
  onChange: (value: T | "all") => void;
}

function FilterTabBar<T extends string>({
  label,
  options,
  active,
  onChange,
}: FilterTabBarProps<T>) {
  return (
    <div className={styles.filterTabBar} role="group" aria-label={label}>
      {options.map(({ value, label: optLabel }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={active === value}
          className={`${styles.filterTab} ${active === value ? styles.filterTabActive : ""}`}
          onClick={() => onChange(value)}
        >
          {optLabel}
        </button>
      ))}
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────────

interface EmptyStateProps {
  hasFilters: boolean;
}

function EmptyState({ hasFilters }: EmptyStateProps) {
  return (
    <tr>
      <td colSpan={5}>
        <div className={styles.emptyState} data-testid="user-list-empty">
          <UsersIcon className={styles.emptyIcon} />
          <p className={styles.emptyTitle}>
            {hasFilters ? "No users match the selected filters" : "No users found"}
          </p>
          <p className={styles.emptyText}>
            {hasFilters
              ? "Try clearing the role or status filter to see all users."
              : "Users appear here after their first login or after being invited by an admin."}
          </p>
        </div>
      </td>
    </tr>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────────────────

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M11.013 2.513a1.75 1.75 0 0 1 2.475 2.474L6.226 12.25a2.751 2.751 0 0 1-.892.596l-2.047.848a.75.75 0 0 1-.98-.98l.848-2.047a2.75 2.75 0 0 1 .596-.892l7.262-7.262Z" />
    </svg>
  );
}

function BanIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1ZM2.5 8a5.5 5.5 0 0 1 8.56-4.56L3.94 11.06A5.475 5.475 0 0 1 2.5 8Zm1.44 3.56 7.12-7.12A5.5 5.5 0 0 1 4.06 11.06h-.12Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ArrowPathIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M8 2.5a5.5 5.5 0 1 0 4.596 2.473.75.75 0 1 1 1.252-.832A7 7 0 1 1 8 1a.75.75 0 0 1 0 1.5Z"
        clipRule="evenodd"
      />
      <path d="M6.88 3.853a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75V1.353a.75.75 0 0 1 1.5 0v2.5Z" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M16 11c1.657 0 3-1.343 3-3s-1.343-3-3-3" />
      <path d="M19 15c2 .5 3 1.667 3 3.5H2c0-1.833 1-3 3-3.5" />
      <circle cx="9" cy="7" r="4" />
      <path d="M6 15a7 7 0 0 1 6 0" />
    </svg>
  );
}

// ─── Utility: relative time ────────────────────────────────────────────────────

function formatRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const date = new Date(ts);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Main component ────────────────────────────────────────────────────────────

/**
 * UserListTable — top-level admin user list view.
 *
 * Self-contained: no props required. Uses Convex hooks internally.
 */
export function UserListTable() {
  const currentUser = useCurrentUser();
  const adminId = currentUser.id;
  const isAdminCaller = currentUser.isAdmin;

  // ── Filter state ────────────────────────────────────────────────────────
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<UserStatus | "all">("all");

  // ── Fetch users (Convex real-time subscription) ─────────────────────────
  // Args object mirrors what useListUsers passes to api.users.listUsers.
  // Also used as the key for localStore.getQuery in the optimistic updates below.
  const queryArgs = {
    role:   roleFilter !== "all"   ? (roleFilter as UserRole)     : undefined,
    status: statusFilter !== "all" ? (statusFilter as UserStatus) : undefined,
  };

  const { users, isLoading } = useListUsers({
    role:   queryArgs.role,
    status: queryArgs.status,
  });

  // ── Optimistic mutations ────────────────────────────────────────────────
  //
  // Both mutations use withOptimisticUpdate to patch the local Convex query
  // store immediately, eliminating the ~100–300 ms round-trip flash.
  //
  // The callbacks close over `queryArgs` and `statusFilter` from the current
  // render. Since React re-renders on every filter change, the callbacks
  // always reflect the active view when the mutation is called.
  //
  // Pattern mirrors InlineStatusEditor.tsx — see that file for reference.

  /**
   * deactivateUserMutation — sets a user's status to "inactive".
   * Optimistic update:
   *   • If viewing status="active" filter: removes the user from the list.
   *   • Otherwise: updates the user's status badge to "inactive" in-place.
   */
  const deactivateUserMutation = useMutation(api.users.deactivateUser)
    .withOptimisticUpdate((localStore, args) => {
      const currentList = localStore.getQuery(api.users.listUsers, queryArgs);
      if (currentList == null) return;

      const updated =
        statusFilter === "active"
          ? currentList.filter((u) => u.kindeId !== args.kindeId)
          : currentList.map((u) =>
              u.kindeId === args.kindeId
                ? { ...u, status: "inactive" as const, updatedAt: Date.now() }
                : u
            );

      localStore.setQuery(api.users.listUsers, queryArgs, updated);
    });

  /**
   * reactivateUserMutation — sets a user's status back to "active".
   * Optimistic update:
   *   • If viewing status="inactive" filter: removes the user from the list.
   *   • Otherwise: updates the user's status badge to "active" in-place.
   */
  const reactivateUserMutation = useMutation(api.users.updateUser)
    .withOptimisticUpdate((localStore, args) => {
      if (args.status !== "active") return;
      const currentList = localStore.getQuery(api.users.listUsers, queryArgs);
      if (currentList == null) return;

      const updated =
        statusFilter === "inactive"
          ? currentList.filter((u) => u.kindeId !== args.kindeId)
          : currentList.map((u) =>
              u.kindeId === args.kindeId
                ? { ...u, status: "active" as const, updatedAt: Date.now() }
                : u
            );

      localStore.setQuery(api.users.listUsers, queryArgs, updated);
    });

  // ── Toast state ─────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = useCallback((message: string, variant: Toast["variant"]) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const pushSuccess = useCallback(
    (message: string) => pushToast(message, "success"),
    [pushToast],
  );
  const pushError = useCallback(
    (message: string) => pushToast(message, "error"),
    [pushToast],
  );

  // ── Modal/dialog state ──────────────────────────────────────────────────
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UserSummary | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<UserSummary | null>(null);

  // ── Reactivate handler ──────────────────────────────────────────────────
  const handleReactivate = useCallback(
    async (user: UserSummary) => {
      try {
        await reactivateUserMutation({ adminId, kindeId: user.kindeId, status: "active" });
        pushSuccess(`${user.name} has been reactivated.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        pushError(`Reactivation failed: ${msg}`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adminId, pushSuccess, pushError, statusFilter, roleFilter],
  );

  const handleInvite          = useCallback(() => setInviteOpen(true), []);
  const closeInviteModal      = useCallback(() => setInviteOpen(false), []);
  const handleEditRole        = useCallback((u: UserSummary) => setEditTarget(u), []);
  const handleDeactivate      = useCallback((u: UserSummary) => setDeactivateTarget(u), []);
  const closeEditModal        = useCallback(() => setEditTarget(null), []);
  const closeDeactivateDialog = useCallback(() => setDeactivateTarget(null), []);

  // ── Computed stats ──────────────────────────────────────────────────────
  const totalCount  = users?.length ?? 0;
  const activeCount = users?.filter((u) => u.status === "active").length ?? 0;

  const hasFilters = roleFilter !== "all" || statusFilter !== "all";

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className={styles.root} data-testid="user-list-table">

      {/* ── Page header ──────────────────────────────────────────── */}
      <header className={styles.pageHeader}>
        <div className={styles.headerLeft}>
          <h1 className={styles.pageTitle}>Users</h1>
          {!isLoading && (
            <div className={styles.pageTitleSub}>
              {totalCount === 0
                ? "No users"
                : `${activeCount} active · ${totalCount} total`}
            </div>
          )}
        </div>

        {/* Invite user button — admin-only */}
        {isAdminCaller && (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnInvite}`}
            onClick={handleInvite}
            aria-label="Invite a new user"
          >
            <PlusIcon className={styles.btnIcon} />
            Invite user
          </button>
        )}
      </header>

      {/* ── Filter bar ───────────────────────────────────────────── */}
      <div className={styles.filterBar}>
        <FilterTabBar<UserRole>
          label="Filter by role"
          options={[
            { value: "all",        label: "All roles" },
            { value: "admin",      label: "Admin" },
            { value: "operator",   label: "Operator" },
            { value: "technician", label: "Technician" },
            { value: "pilot",      label: "Pilot" },
          ]}
          active={roleFilter}
          onChange={setRoleFilter}
        />

        <FilterTabBar<UserStatus>
          label="Filter by status"
          options={[
            { value: "all",      label: "All statuses" },
            { value: "active",   label: "Active" },
            { value: "inactive", label: "Inactive" },
            { value: "pending",  label: "Pending" },
          ]}
          active={statusFilter}
          onChange={setStatusFilter}
        />
      </div>

      {/* ── Table scroll area ─────────────────────────────────────── */}
      <div className={styles.tableWrapper}>
        <table
          className={styles.table}
          aria-label="Registered users"
          aria-busy={isLoading}
        >
          <thead className={styles.thead}>
            <tr>
              <th className={`${styles.th} ${styles.thName}`} scope="col">
                Name
              </th>
              <th className={`${styles.th} ${styles.thEmail}`} scope="col">
                Email
              </th>
              <th className={`${styles.th} ${styles.thRole}`} scope="col">
                Role
              </th>
              <th className={`${styles.th} ${styles.thStatus}`} scope="col">
                Status
              </th>
              <th className={`${styles.th} ${styles.thActions}`} scope="col">
                <span className={styles.srOnly}>Actions</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {/* Loading state — 6 skeleton rows */}
            {isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <SkeletonRow key={i} />
              ))}

            {/* Empty state */}
            {!isLoading && totalCount === 0 && (
              <EmptyState hasFilters={hasFilters} />
            )}

            {/* Data rows */}
            {!isLoading &&
              totalCount > 0 &&
              (users ?? []).map((user) => (
                <UserRow
                  key={user._id}
                  user={user}
                  isAdmin={isAdminCaller}
                  onEditRole={handleEditRole}
                  onDeactivate={handleDeactivate}
                  onReactivate={handleReactivate}
                />
              ))}
          </tbody>
        </table>
      </div>

      {/* ── Invite user modal ────────────────────────────────────── */}
      {inviteOpen && (
        <UserInviteEditModal
          mode="invite"
          adminId={adminId}
          onClose={closeInviteModal}
          onSuccess={pushSuccess}
          onError={pushError}
        />
      )}

      {/* ── Edit user modal ───────────────────────────────────────── */}
      {editTarget && (
        <UserInviteEditModal
          mode="edit"
          user={editTarget}
          adminId={adminId}
          onClose={closeEditModal}
          onSuccess={pushSuccess}
          onError={pushError}
        />
      )}

      {/* ── Deactivate confirm dialog ─────────────────────────────── */}
      {deactivateTarget && (
        <DeactivateConfirmDialog
          user={deactivateTarget}
          adminId={adminId}
          onDeactivate={deactivateUserMutation}
          onClose={closeDeactivateDialog}
          onSuccess={pushSuccess}
          onError={pushError}
        />
      )}

      {/* ── Toast area ───────────────────────────────────────────── */}
      <div className={styles.toastArea} aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`${styles.toast} ${
              t.variant === "success" ? styles.toastSuccess : styles.toastError
            }`}
            role="status"
          >
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
