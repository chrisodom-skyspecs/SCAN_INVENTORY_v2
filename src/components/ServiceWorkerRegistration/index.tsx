/**
 * ServiceWorkerRegistration
 *
 * Client component that registers the SCAN service worker (/sw.js) once
 * per page load when running in a browser that supports the Service Worker API.
 *
 * Placement: rendered inside the /scan/* layout so the SW is scoped
 * exclusively to SCAN app routes.
 *
 * Scope is explicitly set to "/scan/" — the SW only intercepts requests
 * originating from /scan/* pages and does not affect the INVENTORY dashboard.
 *
 * Renders nothing visible (returns null).
 */

"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    // Service workers require a browser environment and HTTPS (or localhost).
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker
      .register("/sw.js", { scope: "/scan/" })
      .then((registration) => {
        if (process.env.NODE_ENV === "development") {
          // Log scope in development for debugging; silent in production.
          console.log("[SW] Registered. Scope:", registration.scope);
        }

        // Listen for updates so we can notify the user if a new version
        // of the service worker is available.
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // A new SW version is waiting — the activate handler will clean
              // up stale caches on next load.  No user action required for
              // this online-only app; the page will pick up the new version
              // on next navigation due to skipWaiting() in sw.js.
              if (process.env.NODE_ENV === "development") {
                console.log("[SW] New version available; will activate on next load.");
              }
            }
          });
        });
      })
      .catch((err) => {
        // Registration errors are non-fatal — the app works without a SW.
        // Only log in development to avoid noisy production consoles.
        if (process.env.NODE_ENV === "development") {
          console.error("[SW] Registration failed:", err);
        }
      });
  }, []); // Run once on mount

  return null;
}
