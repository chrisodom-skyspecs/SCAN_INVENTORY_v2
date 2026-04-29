/**
 * useLayerEngineStorage — localStorage persistence for INVENTORY map layer state.
 *
 * Reads the initial `LayerEngineState` from `localStorage` on first call and
 * provides a stable `persist` function that serialises the current state back
 * to `localStorage` on every engine change.
 *
 * Why a separate hook?
 * ─────────────────────
 * `LayerEngine` and `LayerEngineProvider` are intentionally free of browser
 * APIs so they stay safe in SSR and pure-JS test environments.  This hook
 * acts as the thin "storage adapter" layer — it is only imported by the
 * provider when a `storageKey` prop is supplied.
 *
 * SSR safety
 * ──────────
 * `localStorage` is accessed inside a try/catch guarded by a `typeof window`
 * check so the hook never throws on the server or in environments that do not
 * have a DOM (Vitest jsdom still exposes `window`, but the value will be
 * `null` on first read → falls back to `undefined` → defaults apply).
 *
 * Quota / corruption handling
 * ───────────────────────────
 * Any read or write error is caught and logged; the hook silently falls back
 * to `undefined` (read) or a no-op (write) so a localStorage failure never
 * breaks the map UI.
 *
 * Usage
 * ─────
 *   // In LayerEngineProvider:
 *   const { storedState, persist } = useLayerEngineStorage("inv-layer-visibility");
 *
 *   // Create engine with stored state (falls back to defaults when not present)
 *   engineRef.current = new LayerEngine(storedState);
 *
 *   // Subscribe and persist on every change
 *   engine.subscribe(persist);
 */

"use client";

import { useCallback, useMemo } from "react";
import {
  DEFAULT_LAYER_ENGINE_STATE,
  SEMANTIC_LAYER_IDS,
  isSemanticLayerId,
  type LayerEngineState,
} from "@/types/layer-engine";

// ─── Storage key prefix ───────────────────────────────────────────────────────

/**
 * Version prefix appended to the storage key.
 * Increment when the state schema changes in a breaking way to automatically
 * clear stale data from older browser sessions.
 */
const STORAGE_VERSION = "v1";

// ─── Return type ──────────────────────────────────────────────────────────────

export interface UseLayerEngineStorageReturn {
  /**
   * The layer visibility state recovered from localStorage, or `undefined` if
   * nothing was stored (first visit, cleared storage, or parse error).
   *
   * When `undefined`, the engine will use `DEFAULT_LAYER_ENGINE_STATE`.
   * When defined, every key in `LayerEngineState` is present with a boolean
   * value (any missing / invalid keys fall back to their default value).
   */
  storedState: Partial<LayerEngineState> | undefined;

  /**
   * Write the given state snapshot to localStorage.
   *
   * Stable across re-renders (memoised with `useCallback`).  Safe to pass
   * directly to `engine.subscribe()`.
   *
   * @param state — full engine state snapshot to persist.
   */
  persist: (state: LayerEngineState) => void;

  /**
   * Erase the persisted state from localStorage.
   *
   * Useful for "Reset to defaults" actions — call this before calling
   * `engine.reset()` so the default state is also persisted on the next
   * engine change notification.
   *
   * Stable across re-renders (memoised with `useCallback`).
   */
  clear: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derive the versioned localStorage key from the consumer-supplied base key.
 *
 * @example
 * buildStorageKey("inv-layer-visibility")
 * // → "inv-layer-visibility:v1"
 */
function buildStorageKey(baseKey: string): string {
  return `${baseKey}:${STORAGE_VERSION}`;
}

/**
 * Read and parse the stored layer state JSON from localStorage.
 *
 * Returns a validated `Partial<LayerEngineState>` where:
 *   - Only keys that are valid `SemanticLayerId` strings are kept.
 *   - Only boolean values are kept.
 *   - Any invalid / extra keys are silently dropped.
 *
 * Returns `undefined` on any error (missing key, invalid JSON, wrong shape).
 */
function readFromStorage(storageKey: string): Partial<LayerEngineState> | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return undefined;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }

    // Validate and filter: keep only known SemanticLayerId keys with boolean values.
    // Use a plain mutable Record<string, boolean> as the accumulator to avoid
    // TypeScript's "cannot assign to read-only property" error on
    // Partial<Readonly<Record<...>>>, then cast to Partial<LayerEngineState>.
    const validated: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isSemanticLayerId(key) && typeof value === "boolean") {
        validated[key] = value;
      }
    }

    // Return undefined when nothing survived validation.
    return Object.keys(validated).length > 0
      ? (validated as Partial<LayerEngineState>)
      : undefined;
  } catch {
    // JSON parse error, quota exceeded, or security error — fail silently.
    return undefined;
  }
}

/**
 * Serialise the full `LayerEngineState` to localStorage.
 *
 * Only writes known `SemanticLayerId` keys to avoid storing garbage.
 */
function writeToStorage(storageKey: string, state: LayerEngineState): void {
  if (typeof window === "undefined") return;

  try {
    // Build a clean object with only the 7 known layer IDs so we don't
    // accidentally persist extra keys if the state type ever widens.
    const clean: Record<string, boolean> = {};
    for (const id of SEMANTIC_LAYER_IDS) {
      clean[id] = state[id];
    }
    localStorage.setItem(storageKey, JSON.stringify(clean));
  } catch {
    // Quota exceeded, private browsing, or security error — fail silently.
  }
}

/**
 * Remove the stored state from localStorage.
 */
function clearFromStorage(storageKey: string): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.removeItem(storageKey);
  } catch {
    // Security error — fail silently.
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Provides localStorage read/write utilities for `LayerEngineState`.
 *
 * @param baseKey — consumer-supplied storage key (e.g. "inv-layer-visibility").
 *   A version suffix is appended automatically to enable future schema migrations.
 *
 * @returns
 *   `storedState` — partial state recovered from localStorage (or `undefined`)
 *   `persist`     — stable callback to write a full state snapshot to storage
 *   `clear`       — stable callback to erase the stored state
 *
 * @example
 * // Inside LayerEngineProvider:
 * const { storedState, persist } = useLayerEngineStorage("inv-layer-visibility");
 * const engine = new LayerEngine(storedState); // storedState overrides defaults
 * engine.subscribe(persist);                   // auto-persist on every change
 */
export function useLayerEngineStorage(
  baseKey: string
): UseLayerEngineStorageReturn {
  // Build the full versioned key once — stable across re-renders.
  const storageKey = useMemo(() => buildStorageKey(baseKey), [baseKey]);

  // Read stored state once during module evaluation (not in render) so we
  // don't cause unnecessary re-renders on mount.  The value is stable for the
  // lifetime of the provider (the hook is called exactly once per provider
  // mount, and the provider recreates the engine only once via useRef).
  //
  // `useMemo` with [storageKey] dependency ensures the read happens exactly
  // once per storageKey change (which is practically never after mount).
  const storedState = useMemo(
    () => readFromStorage(storageKey),
    [storageKey]
  );

  // Stable persist callback — passes through to the write helper.
  const persist = useCallback(
    (state: LayerEngineState) => {
      writeToStorage(storageKey, state);
    },
    [storageKey]
  );

  // Stable clear callback.
  const clear = useCallback(() => {
    clearFromStorage(storageKey);
  }, [storageKey]);

  return { storedState, persist, clear };
}

// ─── Default export ───────────────────────────────────────────────────────────

export default useLayerEngineStorage;

// ─── Re-export helpers for testing ───────────────────────────────────────────

export { buildStorageKey, readFromStorage, writeToStorage, clearFromStorage };

/**
 * Build an initial state from stored state merged over defaults.
 *
 * Convenience utility for providers that need a full `LayerEngineState` (not
 * partial) for the engine constructor.  When `stored` is `undefined`, returns
 * `DEFAULT_LAYER_ENGINE_STATE` unchanged so the return type is always
 * `Partial<LayerEngineState>` (compatible with the `LayerEngine` constructor).
 *
 * @param stored — partial state from `readFromStorage` (or `undefined`)
 * @returns merged state (stored overrides defaults)
 */
export function mergeWithDefaults(
  stored: Partial<LayerEngineState> | undefined
): Partial<LayerEngineState> {
  if (!stored) return {};
  // Only include keys that differ from the default so we don't unnecessarily
  // override defaults for keys that were not explicitly stored.
  // Use a plain mutable Record<string, boolean> accumulator to avoid
  // TypeScript's "cannot assign to read-only property" error on
  // Partial<Readonly<Record<...>>>, then cast to Partial<LayerEngineState>.
  const patch: Record<string, boolean> = {};
  for (const id of SEMANTIC_LAYER_IDS) {
    const val = stored[id];
    if (val !== undefined) {
      patch[id] = val;
    }
  }
  return patch as Partial<LayerEngineState>;
}
