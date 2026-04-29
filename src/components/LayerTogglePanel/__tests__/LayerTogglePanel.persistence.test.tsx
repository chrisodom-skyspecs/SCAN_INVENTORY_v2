/**
 * LayerTogglePanel persistence tests — Sub-AC 4.
 *
 * Validates that the LayerEngineProvider persists layer toggle preferences
 * to localStorage and restores them across "sessions" (provider remounts).
 *
 * Test groups
 * ───────────
 *   1. Initial state loaded from localStorage on mount
 *   2. State written to localStorage when a toggle is clicked
 *   3. State written on external engine mutations (activateAll, reset)
 *   4. Provider falls back to defaults when localStorage is empty
 *   5. Provider falls back to defaults when localStorage is corrupt
 *   6. storageKey=undefined → no persistence (no reads, no writes)
 *   7. Stale stored key (unknown layer ID) is silently dropped
 *
 * @vitest-environment jsdom
 */

import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LayerTogglePanelConnected } from "../LayerTogglePanelConnected";
import { LayerEngineProvider } from "@/providers/layer-engine-provider";
import { useLayerEngineContext } from "@/providers/layer-engine-provider";
import { LayerEngine } from "@/lib/layer-engine";
import { SEMANTIC_LAYER_IDS } from "@/types/layer-engine";
import { buildStorageKey, writeToStorage } from "@/hooks/use-layer-engine-storage";
import type { LayerSlotId } from "../LayerTogglePanel";

// ─── Constants ────────────────────────────────────────────────────────────────

const TEST_BASE_KEY = "test-inv-layer-persistence";
const VERSIONED_KEY = buildStorageKey(TEST_BASE_KEY);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInput(layerId: LayerSlotId): HTMLInputElement {
  return screen.getByTestId(`layer-toggle-input-${layerId}`) as HTMLInputElement;
}

function EngineExtractorRef(ref: { current: LayerEngine | null }) {
  function Inner() {
    ref.current = useLayerEngineContext();
    return null;
  }
  return Inner;
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  cleanup();
  vi.restoreAllMocks();
});

// ─── 1. Initial state loaded from localStorage ────────────────────────────────

describe("LayerEngineProvider — Sub-AC 4: initial state from localStorage", () => {
  it("loads a previously-stored partial state on mount", () => {
    // Pre-populate localStorage as if from a previous session
    writeToStorage(VERSIONED_KEY, {
      deployed: false,
      transit: false,
      flagged: true,
      hangar: true,
      heat: true,
      history: true,
      turbines: false,
    });

    render(
      <LayerEngineProvider storageKey={TEST_BASE_KEY}>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    expect(getInput("deployed").checked).toBe(false);  // stored OFF
    expect(getInput("transit").checked).toBe(false);   // stored OFF
    expect(getInput("flagged").checked).toBe(true);    // stored ON
    expect(getInput("heat").checked).toBe(true);       // stored ON (overrides default OFF)
    expect(getInput("history").checked).toBe(true);    // stored ON (overrides default OFF)
    expect(getInput("turbines").checked).toBe(false);  // stored OFF
  });

  it("uses defaults when localStorage is empty", () => {
    // No pre-populated storage
    render(
      <LayerEngineProvider storageKey={TEST_BASE_KEY}>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    // Default state: deployed, transit, flagged, hangar, turbines ON; heat, history OFF
    expect(getInput("deployed").checked).toBe(true);
    expect(getInput("transit").checked).toBe(true);
    expect(getInput("heat").checked).toBe(false);
    expect(getInput("history").checked).toBe(false);
  });
});

// ─── 2. State written to localStorage when toggle is clicked ──────────────────

describe("LayerEngineProvider — Sub-AC 4: persist on toggle click", () => {
  it("writes updated state to localStorage after a toggle click", async () => {
    render(
      <LayerEngineProvider storageKey={TEST_BASE_KEY}>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    // deployed starts ON
    expect(getInput("deployed").checked).toBe(true);

    // Toggle deployed OFF
    await userEvent.click(getInput("deployed"));
    expect(getInput("deployed").checked).toBe(false);

    // Read what was persisted
    const raw = localStorage.getItem(VERSIONED_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.deployed).toBe(false);
  });

  it("persists each layer toggle independently", async () => {
    render(
      <LayerEngineProvider storageKey={TEST_BASE_KEY}>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    // Toggle heat ON (starts OFF)
    await userEvent.click(getInput("heat"));

    const stored = JSON.parse(localStorage.getItem(VERSIONED_KEY)!);
    expect(stored.heat).toBe(true);

    // Toggle heat OFF again
    await userEvent.click(getInput("heat"));

    const stored2 = JSON.parse(localStorage.getItem(VERSIONED_KEY)!);
    expect(stored2.heat).toBe(false);
  });

  it("persisted state matches the panel after multiple toggle operations", async () => {
    render(
      <LayerEngineProvider storageKey={TEST_BASE_KEY}>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    // Toggle deployed OFF, heat ON, history ON
    await userEvent.click(getInput("deployed")); // OFF
    await userEvent.click(getInput("heat"));     // ON
    await userEvent.click(getInput("history"));  // ON

    const stored = JSON.parse(localStorage.getItem(VERSIONED_KEY)!);
    expect(stored.deployed).toBe(false);
    expect(stored.heat).toBe(true);
    expect(stored.history).toBe(true);
    // Others remain at their defaults
    expect(stored.transit).toBe(true);
    expect(stored.turbines).toBe(true);
  });
});

// ─── 3. State written on external engine mutations ────────────────────────────

describe("LayerEngineProvider — Sub-AC 4: persist on external engine mutation", () => {
  it("persists state after engine.activateAll()", () => {
    const engineRef = { current: null as LayerEngine | null };
    const EngineExtractor = EngineExtractorRef(engineRef);

    render(
      <LayerEngineProvider storageKey={TEST_BASE_KEY}>
        <EngineExtractor />
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    act(() => {
      engineRef.current!.activateAll();
    });

    const stored = JSON.parse(localStorage.getItem(VERSIONED_KEY)!);
    for (const id of SEMANTIC_LAYER_IDS) {
      expect(stored[id]).toBe(true);
    }
  });

  it("persists state after engine.deactivateAll()", () => {
    const engineRef = { current: null as LayerEngine | null };
    const EngineExtractor = EngineExtractorRef(engineRef);

    render(
      <LayerEngineProvider storageKey={TEST_BASE_KEY}>
        <EngineExtractor />
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    act(() => {
      engineRef.current!.deactivateAll();
    });

    const stored = JSON.parse(localStorage.getItem(VERSIONED_KEY)!);
    for (const id of SEMANTIC_LAYER_IDS) {
      expect(stored[id]).toBe(false);
    }
  });

  it("persists state after engine.reset()", () => {
    // Pre-populate with all-on state
    writeToStorage(VERSIONED_KEY, {
      deployed: true,
      transit: true,
      flagged: true,
      hangar: true,
      heat: true,
      history: true,
      turbines: true,
    });

    const engineRef = { current: null as LayerEngine | null };
    const EngineExtractor = EngineExtractorRef(engineRef);

    render(
      <LayerEngineProvider storageKey={TEST_BASE_KEY}>
        <EngineExtractor />
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    act(() => {
      engineRef.current!.reset();
    });

    const stored = JSON.parse(localStorage.getItem(VERSIONED_KEY)!);
    // Default state: heat and history OFF
    expect(stored.heat).toBe(false);
    expect(stored.history).toBe(false);
    expect(stored.deployed).toBe(true);
  });
});

// ─── 4. Falls back to defaults when localStorage is empty ────────────────────

describe("LayerEngineProvider — Sub-AC 4: fallback to defaults", () => {
  it("uses DEFAULT_LAYER_ENGINE_STATE when no stored state exists", () => {
    render(
      <LayerEngineProvider storageKey={TEST_BASE_KEY}>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    // Default: deployed, transit, flagged, hangar, turbines = ON
    expect(getInput("deployed").checked).toBe(true);
    expect(getInput("transit").checked).toBe(true);
    expect(getInput("flagged").checked).toBe(true);
    expect(getInput("hangar").checked).toBe(true);
    expect(getInput("turbines").checked).toBe(true);
    // heat, history = OFF by default
    expect(getInput("heat").checked).toBe(false);
    expect(getInput("history").checked).toBe(false);

    // Footer reflects the default active count (5 of 7)
    expect(screen.getByText("5 of 7 layers visible")).toBeTruthy();
  });
});

// ─── 5. Falls back to defaults when localStorage is corrupt ──────────────────

describe("LayerEngineProvider — Sub-AC 4: corrupt storage falls back gracefully", () => {
  it("ignores malformed JSON and uses defaults", () => {
    localStorage.setItem(VERSIONED_KEY, "{{not-valid-json}}");

    render(
      <LayerEngineProvider storageKey={TEST_BASE_KEY}>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    // Should not throw; should fall back to defaults
    expect(getInput("deployed").checked).toBe(true);
    expect(getInput("heat").checked).toBe(false);
  });

  it("ignores a stored number (not an object) and uses defaults", () => {
    localStorage.setItem(VERSIONED_KEY, "42");

    render(
      <LayerEngineProvider storageKey={TEST_BASE_KEY}>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    expect(getInput("deployed").checked).toBe(true);
  });
});

// ─── 6. No persistence when storageKey is omitted ────────────────────────────

describe("LayerEngineProvider — Sub-AC 4: no persistence without storageKey", () => {
  it("does NOT write to localStorage when storageKey is not provided", async () => {
    render(
      <LayerEngineProvider>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    await userEvent.click(getInput("deployed"));

    // Nothing should have been written to localStorage
    expect(localStorage.length).toBe(0);
  });

  it("uses default state without any storage interaction", () => {
    render(
      <LayerEngineProvider>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    expect(getInput("deployed").checked).toBe(true);
    expect(getInput("heat").checked).toBe(false);
  });
});

// ─── 7. Stale / unknown keys are silently dropped ─────────────────────────────

describe("LayerEngineProvider — Sub-AC 4: stale stored keys are dropped", () => {
  it("drops unknown layer IDs and uses defaults for those keys", () => {
    // Simulate a stale storage entry from an older app version
    localStorage.setItem(
      VERSIONED_KEY,
      JSON.stringify({
        deployed: false,     // valid
        oldLayer: true,      // unknown — should be dropped
        anotherOld: false,   // unknown — should be dropped
        heat: true,          // valid
      })
    );

    render(
      <LayerEngineProvider storageKey={TEST_BASE_KEY}>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    // Valid stored overrides apply
    expect(getInput("deployed").checked).toBe(false);
    expect(getInput("heat").checked).toBe(true);

    // Unknown keys are ignored; defaults apply to unlisted keys
    expect(getInput("transit").checked).toBe(true);   // default
    expect(getInput("turbines").checked).toBe(true);  // default
  });
});

// ─── 8. Session simulation: remount uses persisted state ─────────────────────

describe("LayerEngineProvider — Sub-AC 4: simulated session persistence", () => {
  it("second mount reads the state that was persisted by the first mount", async () => {
    // --- Session 1 ---
    const { unmount } = render(
      <LayerEngineProvider storageKey={TEST_BASE_KEY}>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    // Toggle heat ON (starts OFF by default)
    await userEvent.click(getInput("heat"));
    expect(getInput("heat").checked).toBe(true);

    // Unmount simulates the user closing / refreshing the browser tab
    unmount();
    cleanup();

    // Verify something was stored
    const stored = localStorage.getItem(VERSIONED_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).heat).toBe(true);

    // --- Session 2 ---
    render(
      <LayerEngineProvider storageKey={TEST_BASE_KEY}>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    // heat should be ON because it was persisted in session 1
    expect(getInput("heat").checked).toBe(true);
    // Other layers should still reflect the session-1 state (defaults + heat ON)
    expect(getInput("deployed").checked).toBe(true);
    expect(getInput("history").checked).toBe(false);
  });
});
