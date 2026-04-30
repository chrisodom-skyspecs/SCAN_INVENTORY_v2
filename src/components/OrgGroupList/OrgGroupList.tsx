/**
 * OrgGroupList — Admin UI for organization group management.
 *
 * Renders a paginated, searchable table of org groups showing:
 *   • Name (+ optional description)
 *   • Type badge (Internal / Contractor)
 *   • Active member count
 *   • Active/Inactive status
 *
 * Real-time:
 *   Uses useOrgsWithMemberCount() which wraps the listOrgsWithMemberCount
 *   Convex query — subscriptions push diffs within ~100–300 ms of any change.
 *
 * Features:
 *   - Debounced search by org name
 *   - Type filter dropdown (All / Internal / Contractor)
 *   - "Show inactive" toggle (admin/operator only — enforced server-side)
 *   - Client-side pagination with configurable page size
 *   - Sortable columns: Name, Type, Members
 *   - Skeleton loading state
 *   - Empty state when no orgs match the current filter
 *
 * Design system compliance:
 *   - All colors via CSS custom properties (no hex literals)
 *   - Inter Tight for UI text; IBM Plex Mono for numeric values
 *   - WCAG AA contrast in both light and dark themes
 */

"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useOrgsWithMemberCount, type OrgWithCount } from "@/hooks/use-organizations";
import { useUserIdentity } from "@/providers/user-identity-provider";
import { OrgGroupFormModal } from "@/components/OrgGroupFormModal";
import { OrgTypeBadge } from "@/components/OrgTypeBadge";
import styles from "./OrgGroupList.module.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

// ─── Types ────────────────────────────────────────────────────────────────────

type SortKey = "name" | "orgType" | "memberCount";
type SortDir = "asc" | "desc";

// ─── Icons ────────────────────────────────────────────────────────────────────

function SearchIcon({ className }: { className?: string }) {
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
        d="M9.965 11.026a5 5 0 1 1 1.06-1.06l2.755 2.754a.75.75 0 1 1-1.06 1.06l-2.755-2.754ZM10.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ChevronUpIcon({ className }: { className?: string }) {
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
        d="M11.78 9.78a.75.75 0 0 1-1.06 0L8 7.06 5.28 9.78a.75.75 0 0 1-1.06-1.06l3.25-3.25a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
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
        d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ChevronLeftIcon({ className }: { className?: string }) {
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
        d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
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
        d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function BuildingOfficeIcon({ className }: { className?: string }) {
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
      <path d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
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
      <path d="M13.488 2.513a1.75 1.75 0 0 0-2.475 0L6.75 6.774a2.75 2.75 0 0 0-.596.892l-.848 2.047a.75.75 0 0 0 .98.98l2.047-.848a2.75 2.75 0 0 0 .892-.596l4.261-4.263a1.75 1.75 0 0 0 0-2.474Zm-1.414 1.06a.25.25 0 0 1 .354 0l.486.486a.25.25 0 0 1 0 .354l-4.262 4.263a1.25 1.25 0 0 1-.405.27l-.944.392.393-.944a1.25 1.25 0 0 1 .27-.405l4.108-4.416ZM3.75 11.5a.25.25 0 0 0-.25.25v.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-.5a.25.25 0 0 0-.25-.25h-8.5Z" />
    </svg>
  );
}

// ─── Skeleton rows ────────────────────────────────────────────────────────────

function SkeletonRows({ count = 8, isAdmin = false }: { count?: number; isAdmin?: boolean }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <tr key={i} className={styles.skeletonRow} aria-hidden="true">
          <td><div className={`${styles.skeletonBar} ${styles.skeletonBarName}`} /></td>
          <td><div className={`${styles.skeletonBar} ${styles.skeletonBarType}`} /></td>
          <td><div className={`${styles.skeletonBar} ${styles.skeletonBarCount}`} /></td>
          <td><div className={`${styles.skeletonBar} ${styles.skeletonBarType}`} /></td>
          {isAdmin && <td />}
        </tr>
      ))}
    </>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

interface EmptyStateProps {
  hasFilter: boolean;
}

function EmptyState({ hasFilter }: EmptyStateProps) {
  return (
    <tr>
      <td colSpan={4}>
        <div className={styles.emptyState} data-testid="org-group-list-empty">
          <BuildingOfficeIcon className={styles.emptyIcon} />
          <h3 className={styles.emptyTitle}>
            {hasFilter ? "No org groups match your filters" : "No org groups yet"}
          </h3>
          <p className={styles.emptyText}>
            {hasFilter
              ? "Try clearing the search or changing the type filter."
              : "Organizations represent internal SkySpecs teams and external contractor groups. Create them in Kinde and they will appear here."}
          </p>
        </div>
      </td>
    </tr>
  );
}

// ─── Sort icon helper ─────────────────────────────────────────────────────────

function SortIcon({
  column,
  sortKey,
  sortDir,
}: {
  column: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
}) {
  if (sortKey !== column) {
    return <ChevronDownIcon className={styles.sortIcon} />;
  }
  return sortDir === "asc" ? (
    <ChevronUpIcon className={styles.sortIcon} />
  ) : (
    <ChevronDownIcon className={styles.sortIcon} />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * OrgGroupList — self-contained admin org group list view.
 *
 * No props required — reads user identity from context and wires
 * Convex subscriptions internally.
 */
export function OrgGroupList() {
  const { id: userId, roles, isLoading: identityLoading } = useUserIdentity();
  const isAdmin = roles.includes("admin") || roles.includes("operator");

  // ── Create / edit modal state ─────────────────────────────────────────────
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editTarget, setEditTarget] = useState<OrgWithCount | null>(null);

  // ── Toast / feedback state ────────────────────────────────────────────────
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushToast = useCallback(
    (kind: "success" | "error", message: string) => {
      setToast({ kind, message });
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToast(null), 5000);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // ── Filter / search state ──────────────────────────────────────────────────
  const [rawSearch, setRawSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | "internal" | "contractor">("");
  const [showInactive, setShowInactive] = useState(false);

  // Debounced search term (200 ms) to avoid hammering client-side filter
  const [search, setSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((val: string) => {
    setRawSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(val), 200);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ── Convex subscription ────────────────────────────────────────────────────
  const { orgs, isLoading } = useOrgsWithMemberCount(
    userId,
    typeFilter === "" ? undefined : typeFilter,
    isAdmin ? showInactive : false
  );

  // ── Client-side filtering (search) ────────────────────────────────────────
  const filteredOrgs = useMemo(() => {
    if (!orgs) return [];
    const q = search.trim().toLowerCase();
    if (!q) return orgs;
    return orgs.filter((org) => org.name.toLowerCase().includes(q));
  }, [orgs, search]);

  // ── Sorting ────────────────────────────────────────────────────────────────
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey]
  );

  const sortedOrgs = useMemo(() => {
    return [...filteredOrgs].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") {
        cmp = a.name.localeCompare(b.name);
      } else if (sortKey === "orgType") {
        cmp = a.orgType.localeCompare(b.orgType);
      } else if (sortKey === "memberCount") {
        cmp = a.memberCount - b.memberCount;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filteredOrgs, sortKey, sortDir]);

  // ── Pagination ─────────────────────────────────────────────────────────────
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);

  // Reset to page 1 whenever filter/search changes
  useEffect(() => {
    setPage(1);
  }, [search, typeFilter, showInactive, sortKey, sortDir]);

  const totalCount   = sortedOrgs.length;
  const totalPages   = Math.max(1, Math.ceil(totalCount / pageSize));
  const clampedPage  = Math.min(page, totalPages);
  const pageStart    = (clampedPage - 1) * pageSize;
  const pageEnd      = Math.min(pageStart + pageSize, totalCount);
  const pageOrgs     = sortedOrgs.slice(pageStart, pageEnd);

  // Counts for header subtitle
  const activeCount = orgs?.filter((o) => o.isActive).length ?? 0;
  const totalDbCount = orgs?.length ?? 0;

  const hasFilter = search.trim() !== "" || typeFilter !== "" || showInactive;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={styles.root} data-testid="org-group-list">

      {/* ── Page header ─────────────────────────────────────── */}
      <header className={styles.pageHeader}>
        <div className={styles.headerLeft}>
          <h1 className={styles.pageTitle}>Org Groups</h1>
          {!isLoading && !identityLoading && (
            <div className={styles.pageTitleSub}>
              {totalDbCount === 0
                ? "No org groups"
                : `${activeCount} active · ${totalDbCount} total`}
            </div>
          )}
        </div>

        {/* New group button — admin only */}
        {isAdmin && !identityLoading && (
          <button
            type="button"
            className={styles.newGroupBtn}
            onClick={() => setShowCreateModal(true)}
            aria-label="Create new org group"
          >
            <PlusIcon className={styles.newGroupBtnIcon} />
            New group
          </button>
        )}
      </header>

      {/* ── Toast notification ──────────────────────────────── */}
      {toast && (
        <div
          className={`${styles.toast} ${
            toast.kind === "success" ? styles.toastSuccess : styles.toastError
          }`}
          role="status"
          aria-live="polite"
          data-testid="org-group-toast"
        >
          <span className={styles.toastMessage}>{toast.message}</span>
          <button
            type="button"
            className={styles.toastClose}
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className={styles.toolbar} role="search" aria-label="Filter org groups">
        {/* Search input */}
        <div className={styles.searchWrapper}>
          <SearchIcon className={styles.searchIcon} />
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search by name…"
            value={rawSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            aria-label="Search org groups by name"
          />
        </div>

        {/* Type filter */}
        <select
          className={styles.filterSelect}
          value={typeFilter}
          onChange={(e) =>
            setTypeFilter(e.target.value as "" | "internal" | "contractor")
          }
          aria-label="Filter by org type"
        >
          <option value="">All types</option>
          <option value="internal">Internal</option>
          <option value="contractor">Contractor</option>
        </select>

        {/* Show inactive toggle — admin/operator only */}
        {isAdmin && (
          <div className={styles.toolbarRight}>
            <label className={styles.showInactiveLabel}>
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                aria-label="Show inactive org groups"
              />
              Show inactive
            </label>
          </div>
        )}
      </div>

      {/* ── Table area ──────────────────────────────────────── */}
      <div className={styles.scrollArea}>
        <div className={styles.tableWrapper}>
          <table
            className={styles.table}
            aria-label="Organization groups"
            aria-busy={isLoading || identityLoading}
          >
            <thead className={styles.thead}>
              <tr>
                <th className={styles.th} scope="col">
                  <button
                    type="button"
                    className={styles.sortBtn}
                    onClick={() => handleSort("name")}
                    aria-sort={
                      sortKey === "name"
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    Name
                    <SortIcon column="name" sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
                <th className={styles.th} scope="col">
                  <button
                    type="button"
                    className={styles.sortBtn}
                    onClick={() => handleSort("orgType")}
                    aria-sort={
                      sortKey === "orgType"
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    Type
                    <SortIcon column="orgType" sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
                <th className={styles.th} scope="col">
                  <button
                    type="button"
                    className={styles.sortBtn}
                    onClick={() => handleSort("memberCount")}
                    aria-sort={
                      sortKey === "memberCount"
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    Members
                    <SortIcon
                      column="memberCount"
                      sortKey={sortKey}
                      sortDir={sortDir}
                    />
                  </button>
                </th>
                <th className={styles.th} scope="col">
                  Status
                </th>
                {/* Actions column — visible to admin/operator */}
                {isAdmin && (
                  <th className={`${styles.th} ${styles.thActions}`} scope="col">
                    <span className={styles.visuallyHidden}>Actions</span>
                  </th>
                )}
              </tr>
            </thead>

            <tbody className={styles.tbody}>
              {/* Loading state */}
              {(isLoading || identityLoading) && (
                <SkeletonRows count={pageSize > 10 ? 8 : pageSize} isAdmin={isAdmin} />
              )}

              {/* Data rows */}
              {!isLoading && !identityLoading && pageOrgs.length > 0 &&
                pageOrgs.map((org) => (
                  <OrgRow
                    key={org._id}
                    org={org}
                    isAdmin={isAdmin}
                    onEdit={setEditTarget}
                  />
                ))}

              {/* Empty state */}
              {!isLoading && !identityLoading && pageOrgs.length === 0 && (
                <EmptyState hasFilter={hasFilter} />
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Pagination ──────────────────────────────────────── */}
      {!isLoading && !identityLoading && totalCount > 0 && (
        <Pagination
          page={clampedPage}
          totalPages={totalPages}
          pageStart={pageStart}
          pageEnd={pageEnd}
          totalCount={totalCount}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}

      {/* ── Create modal ────────────────────────────────────── */}
      {showCreateModal && isAdmin && (
        <OrgGroupFormModal
          mode="create"
          adminId={userId}
          onClose={() => setShowCreateModal(false)}
          onSuccess={(msg) => {
            setShowCreateModal(false);
            pushToast("success", msg);
          }}
          onError={(msg) => pushToast("error", msg)}
        />
      )}

      {/* ── Edit modal ──────────────────────────────────────── */}
      {editTarget && isAdmin && (
        <OrgGroupFormModal
          mode="edit"
          org={editTarget}
          adminId={userId}
          onClose={() => setEditTarget(null)}
          onSuccess={(msg) => {
            setEditTarget(null);
            pushToast("success", msg);
          }}
          onError={(msg) => pushToast("error", msg)}
        />
      )}
    </div>
  );
}

// ─── OrgRow ───────────────────────────────────────────────────────────────────

interface OrgRowProps {
  org: OrgWithCount;
  isAdmin: boolean;
  onEdit: (org: OrgWithCount) => void;
}

function OrgRow({ org, isAdmin, onEdit }: OrgRowProps) {
  return (
    <tr>
      <td className={styles.td}>
        <div className={styles.orgName}>{org.name}</div>
        {org.description && (
          <div className={styles.orgDescription} title={org.description}>
            {org.description}
          </div>
        )}
      </td>
      <td className={styles.td}>
        <OrgTypeBadge orgType={org.orgType} />
      </td>
      <td className={styles.td}>
        <span
          className={
            org.memberCount === 0
              ? `${styles.memberCount} ${styles.memberCountZero}`
              : styles.memberCount
          }
        >
          {org.memberCount}
        </span>
      </td>
      <td className={styles.td}>
        {org.isActive ? (
          <span className={styles.activeBadge}>
            Active
          </span>
        ) : (
          <span className={styles.inactiveBadge}>Inactive</span>
        )}
      </td>
      {/* Actions column — admin only */}
      {isAdmin && (
        <td className={styles.td}>
          <button
            type="button"
            className={styles.rowEditBtn}
            onClick={() => onEdit(org)}
            aria-label={`Edit ${org.name}`}
            title="Edit org group"
          >
            <PencilIcon className={styles.rowEditBtnIcon} />
            Edit
          </button>
        </td>
      )}
    </tr>
  );
}

// ─── Pagination component ─────────────────────────────────────────────────────

interface PaginationProps {
  page: number;
  totalPages: number;
  pageStart: number;
  pageEnd: number;
  totalCount: number;
  pageSize: PageSize;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSize) => void;
}

function Pagination({
  page,
  totalPages,
  pageStart,
  pageEnd,
  totalCount,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  // Build visible page number array (max 5 pages shown)
  const visiblePages = useMemo(() => {
    const pages: number[] = [];
    const half = 2;
    let start = Math.max(1, page - half);
    const end = Math.min(totalPages, start + 4);
    start = Math.max(1, end - 4);
    for (let p = start; p <= end; p++) pages.push(p);
    return pages;
  }, [page, totalPages]);

  return (
    <nav
      className={styles.pagination}
      aria-label="Org group list pagination"
    >
      {/* Info */}
      <span className={styles.paginationInfo}>
        {pageStart + 1}–{pageEnd} of {totalCount}
      </span>

      {/* Page buttons */}
      <div className={styles.paginationControls}>
        <button
          type="button"
          className={styles.pageBtn}
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeftIcon className={styles.pageBtnIcon} />
        </button>

        {visiblePages.map((p) => (
          <button
            key={p}
            type="button"
            className={`${styles.pageBtn} ${p === page ? styles.pageBtnActive : ""}`}
            onClick={() => onPageChange(p)}
            aria-label={`Page ${p}`}
            aria-current={p === page ? "page" : undefined}
          >
            {p}
          </button>
        ))}

        <button
          type="button"
          className={styles.pageBtn}
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          <ChevronRightIcon className={styles.pageBtnIcon} />
        </button>
      </div>

      {/* Rows per page */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
        <span className={styles.paginationInfo}>Rows per page:</span>
        <select
          className={styles.rowsPerPageSelect}
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value) as PageSize)}
          aria-label="Rows per page"
        >
          {PAGE_SIZE_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
    </nav>
  );
}
