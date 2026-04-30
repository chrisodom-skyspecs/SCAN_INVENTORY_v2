"use client";

/**
 * Write a URL with the native History API without discarding framework-owned
 * history metadata. Next.js App Router stores its router tree in history.state;
 * replacing it with null during shallow URL updates can destabilize navigation.
 */
export function writeBrowserHistoryUrl(url: string, replace = true): void {
  if (typeof window === "undefined") return;

  const state = window.history.state;

  if (replace) {
    window.history.replaceState(state, "", url);
  } else {
    window.history.pushState(state, "", url);
  }
}
