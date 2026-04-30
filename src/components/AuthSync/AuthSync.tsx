"use client";

import { useEffect, useRef } from "react";
import { useKindeBrowserClient } from "@kinde-oss/kinde-auth-nextjs";

function getConvexSiteUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!convexUrl) return null;

  try {
    const url = new URL(convexUrl);
    if (url.hostname.endsWith(".convex.cloud")) {
      url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site");
      return url.origin;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function getTokenSyncKey(accessToken: unknown): string {
  if (!accessToken || typeof accessToken !== "object") return "unknown";

  const claims = accessToken as Record<string, unknown>;
  const subject = typeof claims["sub"] === "string" ? claims["sub"] : "unknown";
  const expiresAt =
    typeof claims["exp"] === "number" || typeof claims["exp"] === "string"
      ? String(claims["exp"])
      : "no-exp";

  return `${subject}:${expiresAt}`;
}

/**
 * Sync the authenticated Kinde profile into Convex's `users` table.
 *
 * Convex query authentication only needs a valid JWT, but RBAC and user
 * preferences require a corresponding `users` row. This component bridges that
 * gap immediately after browser auth resolves.
 */
export function AuthSync(): null {
  const { accessToken, getToken, isAuthenticated, isLoading } =
    useKindeBrowserClient();
  const lastSyncedKeyRef = useRef<string | null>(null);
  const inFlightKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (isLoading || !isAuthenticated || accessToken == null) return;

    const syncKey = getTokenSyncKey(accessToken);
    if (
      lastSyncedKeyRef.current === syncKey ||
      inFlightKeyRef.current === syncKey
    ) {
      return;
    }

    const convexSiteUrl = getConvexSiteUrl();
    if (!convexSiteUrl) {
      console.warn(
        "[AuthSync] Skipping Kinde user sync: NEXT_PUBLIC_CONVEX_URL is not configured."
      );
      return;
    }

    let cancelled = false;
    inFlightKeyRef.current = syncKey;

    async function syncUser() {
      const token = getToken?.() ?? null;
      if (!token) {
        if (!cancelled) inFlightKeyRef.current = null;
        return;
      }

      try {
        const response = await fetch(`${convexSiteUrl}/api/auth/sync`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: "{}",
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        if (!cancelled) {
          lastSyncedKeyRef.current = syncKey;
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("[AuthSync] Failed to sync Kinde user to Convex.", error);
        }
      } finally {
        if (!cancelled && inFlightKeyRef.current === syncKey) {
          inFlightKeyRef.current = null;
        }
      }
    }

    void syncUser();

    return () => {
      cancelled = true;
    };
  }, [accessToken, getToken, isAuthenticated, isLoading]);

  return null;
}

export default AuthSync;
