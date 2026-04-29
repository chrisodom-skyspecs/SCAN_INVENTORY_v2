/**
 * LayerEngineProvider — React context for sharing a single LayerEngine instance
 * across the INVENTORY map component tree.
 *
 * Problem it solves
 * ─────────────────
 * Multiple components need read/write access to the same layer visibility state:
 *   • LayerPicker (write — toggle buttons)
 *   • M1FleetOverview / M2SiteDetail / … map canvases (read — filter pins)
 *   • Legend (read — which layers are shown)
 *   • Map mode toolbar (read — active layer badge count)
 *
 * Without this provider each call to `useLayerEngine()` would create its own
 * isolated engine, so toggling a layer in the picker would not affect the map.
 *
 * How it works
 * ────────────
 * 1. `LayerEngineProvider` creates one `LayerEngine` instance (via `useRef`)
 *    and exposes it through `LayerEngineContext`.
 * 2. Children call `useLayerEngineContext()` to get the shared engine.
 * 3. `useLayerEngine(engine)` is called with the shared engine so each
 *    consumer subscribes to the same store.
 *
 * Persistence (Sub-AC 4)
 * ──────────────────────
 * When `storageKey` is provided, the provider:
 *   1. Reads the initial visibility state from localStorage on first mount.
 *   2. Subscribes to engine changes and writes every new state snapshot back
 *      to localStorage so preferences survive page refreshes and browser restarts.
 *
 * The storage key is versioned internally (e.g. "inv-layer-visibility:v1") so
 * breaking schema changes automatically clear stale persisted data.
 *
 * Usage
 * ─────
 *   // In the inventory layout or page:
 *   import { LayerEngineProvider } from "@/providers/layer-engine-provider";
 *
 *   export default function InventoryLayout({ children }) {
 *     return (
 *       <LayerEngineProvider storageKey="inv-layer-visibility">
 *         {children}
 *       </LayerEngineProvider>
 *     );
 *   }
 *
 *   // In any child component:
 *   import { useLayerEngineContext } from "@/providers/layer-engine-provider";
 *   import { useLayerEngine } from "@/hooks/use-layer-engine";
 *
 *   function LayerPicker() {
 *     const engine = useLayerEngineContext();
 *     const { state, toggle, registry } = useLayerEngine(engine);
 *     // ...
 *   }
 *
 *   // Or via the combined convenience hook:
 *   import { useSharedLayerEngine } from "@/providers/layer-engine-provider";
 *
 *   function MapCanvas() {
 *     const { state, isVisible } = useSharedLayerEngine();
 *     // ...
 *   }
 */

"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";

import { LayerEngine } from "@/lib/layer-engine";
import { useLayerEngine, type UseLayerEngineReturn } from "@/hooks/use-layer-engine";
import { useLayerEngineStorage } from "@/hooks/use-layer-engine-storage";
import type { LayerEngineState } from "@/types/layer-engine";

// ─── Context ──────────────────────────────────────────────────────────────────

/**
 * Holds the shared `LayerEngine` instance.
 * `null` when used outside of a `LayerEngineProvider`.
 */
const LayerEngineContext = createContext<LayerEngine | null>(null);

LayerEngineContext.displayName = "LayerEngineContext";

// ─── Provider ─────────────────────────────────────────────────────────────────

export interface LayerEngineProviderProps {
  children: ReactNode;
  /**
   * Optional initial visibility overrides.
   * Applied only on first render — subsequent changes must go through the engine.
   * Useful for restoring state from URL params on page load.
   *
   * When both `initialState` and `storageKey` are provided, `storageKey` takes
   * precedence for any layer IDs that have a stored value.  `initialState` only
   * applies to keys that are absent from storage.
   */
  initialState?: Partial<LayerEngineState>;

  /**
   * Optional localStorage key for persisting layer visibility across sessions.
   *
   * When provided:
   *   1. The provider reads any previously-stored visibility state from
   *      localStorage and merges it over the defaults (stored values take
   *      precedence over `initialState`).
   *   2. Every engine state change is written back to localStorage so the
   *      user's layer preferences survive page refresh and browser restart.
   *
   * A version suffix is appended automatically (e.g. "inv-layer-visibility:v1")
   * so future schema changes can clear stale data without manual migration.
   *
   * @example
   * <LayerEngineProvider storageKey="inv-layer-visibility">
   *   {children}
   * </LayerEngineProvider>
   */
  storageKey?: string;
}

// ─── Inner provider (persistence wired) ──────────────────────────────────────

/**
 * Inner provider component that has access to the storage hook.
 * Split from the outer wrapper so the storage hook can read the key as a prop.
 */
function LayerEngineProviderInner({
  children,
  initialState,
  storageKey,
}: LayerEngineProviderProps & { storageKey: string }) {
  const { storedState, persist } = useLayerEngineStorage(storageKey);

  const engineRef = useRef<LayerEngine | null>(null);

  // Lazy initialization — creates the engine once on first render.
  // Priority: stored values > initialState > defaults.
  if (!engineRef.current) {
    const mergedInitial: Partial<LayerEngineState> = {
      ...(initialState ?? {}),
      ...(storedState ?? {}),
    };
    engineRef.current = new LayerEngine(
      Object.keys(mergedInitial).length > 0 ? mergedInitial : initialState
    );
  }

  const engine = engineRef.current;

  // Subscribe to engine changes and persist every new state snapshot.
  // The subscription is set up once after mount (engine ref is stable).
  // Cleanup: unsubscribe when the provider unmounts.
  useEffect(() => {
    return engine.subscribe(persist);
  }, [engine, persist]);

  return (
    <LayerEngineContext.Provider value={engine}>
      {children}
    </LayerEngineContext.Provider>
  );
}

// ─── Outer provider (non-persistence path) ────────────────────────────────────

/**
 * Provides a shared `LayerEngine` instance to all descendant components.
 *
 * Creates exactly one engine per provider mount.  The engine instance is stable
 * (created in `useRef`) — it does NOT re-create when `initialState` changes
 * after mount.
 *
 * When `storageKey` is provided, the engine is initialised from the stored
 * state and every change is automatically persisted back to localStorage.
 */
export function LayerEngineProvider({
  children,
  initialState,
  storageKey,
}: LayerEngineProviderProps) {
  // Route to persistence-enabled inner provider when a storage key is given.
  if (storageKey) {
    return (
      <LayerEngineProviderInner
        initialState={initialState}
        storageKey={storageKey}
      >
        {children}
      </LayerEngineProviderInner>
    );
  }

  // Non-persistent path — same as original implementation.
  return (
    <LayerEngineProviderNoStorage initialState={initialState}>
      {children}
    </LayerEngineProviderNoStorage>
  );
}

/**
 * Non-persistent path — creates the engine once and exposes it via context.
 * No localStorage interaction.
 */
function LayerEngineProviderNoStorage({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState?: Partial<LayerEngineState>;
}) {
  const engineRef = useRef<LayerEngine | null>(null);

  // Lazy initialization — creates the engine once on first render.
  if (!engineRef.current) {
    engineRef.current = new LayerEngine(initialState);
  }

  return (
    <LayerEngineContext.Provider value={engineRef.current}>
      {children}
    </LayerEngineContext.Provider>
  );
}

// ─── Context hook ─────────────────────────────────────────────────────────────

/**
 * Returns the shared `LayerEngine` instance from the nearest
 * `LayerEngineProvider`.
 *
 * @throws {Error} When called outside of a `LayerEngineProvider`.
 *   This is intentional — it is always a programmer error to call this hook
 *   without a provider in the ancestor tree.
 */
export function useLayerEngineContext(): LayerEngine {
  const engine = useContext(LayerEngineContext);
  if (!engine) {
    throw new Error(
      "[LayerEngineContext] useLayerEngineContext() must be called inside a " +
        "<LayerEngineProvider>. Make sure the inventory layout wraps children " +
        "with <LayerEngineProvider>."
    );
  }
  return engine;
}

// ─── Combined convenience hook ─────────────────────────────────────────────────

/**
 * Combined hook: reads the shared engine from context and returns the full
 * `UseLayerEngineReturn` value.
 *
 * This is the primary entry point for most components — they don't need to
 * call both `useLayerEngineContext` and `useLayerEngine` separately.
 *
 * @example
 * function LayerPicker() {
 *   const { state, toggle, registry } = useSharedLayerEngine();
 *   return (
 *     <ul>
 *       {registry.map(def => (
 *         <li key={def.id}>
 *           <button
 *             aria-pressed={state[def.id]}
 *             onClick={() => toggle(def.id)}
 *           >
 *             {def.label}
 *           </button>
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 */
export function useSharedLayerEngine(): UseLayerEngineReturn {
  const engine = useLayerEngineContext();
  return useLayerEngine(engine);
}
