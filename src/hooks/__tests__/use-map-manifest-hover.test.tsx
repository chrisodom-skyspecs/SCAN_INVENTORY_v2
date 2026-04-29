/**
 * @vitest-environment jsdom
 *
 * Tests for the map ↔ manifest hover binding.
 *
 * Covers:
 *  1. useMapManifestHover — null-safe fallback outside a provider
 *  2. MapManifestHoverProvider — initial state
 *  3. setHoveredCaseId — updates hoveredCaseId for consumers
 *  4. Clearing hover — setHoveredCaseId(null)
 *  5. Multiple consumers sharing the same context
 *  6. Provider isolation — nested providers are independent
 *  7. Stable setter — setHoveredCaseId reference does not change on re-render
 */

import React, { useState } from "react";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";

import {
  MapManifestHoverProvider,
  useMapManifestHover,
} from "@/providers/map-manifest-hover-provider";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A test consumer that renders hoveredCaseId and exposes two buttons
 * for setting and clearing the hover state.
 */
function HoverConsumer({ caseId }: { caseId: string }) {
  const { hoveredCaseId, setHoveredCaseId } = useMapManifestHover();
  return (
    <div>
      <span data-testid="hovered-value">{hoveredCaseId ?? "null"}</span>
      <span data-testid="is-highlighted">{hoveredCaseId === caseId ? "yes" : "no"}</span>
      <button
        data-testid="set-hover"
        onClick={() => setHoveredCaseId(caseId)}
      >
        Hover
      </button>
      <button
        data-testid="clear-hover"
        onClick={() => setHoveredCaseId(null)}
      >
        Clear
      </button>
    </div>
  );
}

/**
 * A minimal consumer that only reads hoveredCaseId — used to verify
 * consumers re-render when the hovered ID changes.
 */
function ReadOnlyConsumer({ caseId }: { caseId: string }) {
  const { hoveredCaseId } = useMapManifestHover();
  return (
    <span data-testid={`read-${caseId}`}>
      {hoveredCaseId === caseId ? "highlighted" : "normal"}
    </span>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useMapManifestHover", () => {
  afterEach(() => {
    cleanup();
  });

  // ── 1. Null-safe fallback outside provider ───────────────────────────────────

  it("returns null hoveredCaseId when called outside a provider", () => {
    function Bare() {
      const { hoveredCaseId } = useMapManifestHover();
      return <span data-testid="value">{hoveredCaseId ?? "null"}</span>;
    }
    render(<Bare />);
    expect(screen.getByTestId("value").textContent).toBe("null");
  });

  it("does not throw when setHoveredCaseId is called outside a provider", () => {
    function Bare() {
      const { setHoveredCaseId } = useMapManifestHover();
      return (
        <button data-testid="btn" onClick={() => setHoveredCaseId("x")}>
          click
        </button>
      );
    }
    render(<Bare />);
    // Should not throw
    expect(() => fireEvent.click(screen.getByTestId("btn"))).not.toThrow();
  });

  // ── 2. Provider — initial state ──────────────────────────────────────────────

  it("starts with hoveredCaseId null", () => {
    render(
      <MapManifestHoverProvider>
        <HoverConsumer caseId="case-1" />
      </MapManifestHoverProvider>
    );
    expect(screen.getByTestId("hovered-value").textContent).toBe("null");
  });

  it("starts with is-highlighted = 'no'", () => {
    render(
      <MapManifestHoverProvider>
        <HoverConsumer caseId="case-1" />
      </MapManifestHoverProvider>
    );
    expect(screen.getByTestId("is-highlighted").textContent).toBe("no");
  });

  // ── 3. Setting hover ─────────────────────────────────────────────────────────

  it("updates hoveredCaseId when set button is clicked", () => {
    render(
      <MapManifestHoverProvider>
        <HoverConsumer caseId="case-42" />
      </MapManifestHoverProvider>
    );
    fireEvent.click(screen.getByTestId("set-hover"));
    expect(screen.getByTestId("hovered-value").textContent).toBe("case-42");
  });

  it("shows is-highlighted = 'yes' when hovered caseId matches", () => {
    render(
      <MapManifestHoverProvider>
        <HoverConsumer caseId="case-42" />
      </MapManifestHoverProvider>
    );
    fireEvent.click(screen.getByTestId("set-hover"));
    expect(screen.getByTestId("is-highlighted").textContent).toBe("yes");
  });

  // ── 4. Clearing hover ────────────────────────────────────────────────────────

  it("clears hoveredCaseId when clear button is clicked", () => {
    render(
      <MapManifestHoverProvider>
        <HoverConsumer caseId="case-42" />
      </MapManifestHoverProvider>
    );
    fireEvent.click(screen.getByTestId("set-hover"));
    fireEvent.click(screen.getByTestId("clear-hover"));
    expect(screen.getByTestId("hovered-value").textContent).toBe("null");
  });

  it("resets is-highlighted to 'no' after clearing", () => {
    render(
      <MapManifestHoverProvider>
        <HoverConsumer caseId="case-42" />
      </MapManifestHoverProvider>
    );
    fireEvent.click(screen.getByTestId("set-hover"));
    fireEvent.click(screen.getByTestId("clear-hover"));
    expect(screen.getByTestId("is-highlighted").textContent).toBe("no");
  });

  // ── 5. Multiple consumers share same context ─────────────────────────────────

  it("all consumers share the same hoveredCaseId", () => {
    render(
      <MapManifestHoverProvider>
        <HoverConsumer caseId="case-A" />
        <ReadOnlyConsumer caseId="case-A" />
        <ReadOnlyConsumer caseId="case-B" />
      </MapManifestHoverProvider>
    );

    // Set hover to case-A via the interactive consumer
    fireEvent.click(screen.getByTestId("set-hover"));

    // case-A read-only consumer should highlight
    expect(screen.getByTestId("read-case-A").textContent).toBe("highlighted");
    // case-B read-only consumer should NOT highlight
    expect(screen.getByTestId("read-case-B").textContent).toBe("normal");
  });

  it("clearing hover resets all consumers", () => {
    render(
      <MapManifestHoverProvider>
        <HoverConsumer caseId="case-A" />
        <ReadOnlyConsumer caseId="case-A" />
      </MapManifestHoverProvider>
    );

    fireEvent.click(screen.getByTestId("set-hover"));
    expect(screen.getByTestId("read-case-A").textContent).toBe("highlighted");

    fireEvent.click(screen.getByTestId("clear-hover"));
    expect(screen.getByTestId("read-case-A").textContent).toBe("normal");
  });

  // ── 6. Provider isolation ───────────────────────────────────────────────────

  it("nested providers do not share hover state", () => {
    function OuterConsumer() {
      const { hoveredCaseId } = useMapManifestHover();
      return <span data-testid="outer">{hoveredCaseId ?? "null"}</span>;
    }

    function InnerConsumer() {
      const { setHoveredCaseId } = useMapManifestHover();
      return (
        <button data-testid="inner-set" onClick={() => setHoveredCaseId("inner-case")}>
          set inner
        </button>
      );
    }

    render(
      <MapManifestHoverProvider>
        <OuterConsumer />
        <MapManifestHoverProvider>
          <InnerConsumer />
        </MapManifestHoverProvider>
      </MapManifestHoverProvider>
    );

    // Setting hover in inner provider should NOT affect outer consumer
    fireEvent.click(screen.getByTestId("inner-set"));
    expect(screen.getByTestId("outer").textContent).toBe("null");
  });

  // ── 7. Stable setter reference ───────────────────────────────────────────────

  it("setHoveredCaseId is the same reference across re-renders", () => {
    const setterRefs: Array<(id: string | null) => void> = [];

    function SetterCapture() {
      const { setHoveredCaseId, hoveredCaseId } = useMapManifestHover();
      setterRefs.push(setHoveredCaseId);
      return (
        <button
          data-testid="trigger-rerender"
          onClick={() => setHoveredCaseId(hoveredCaseId === null ? "x" : null)}
        >
          toggle
        </button>
      );
    }

    render(
      <MapManifestHoverProvider>
        <SetterCapture />
      </MapManifestHoverProvider>
    );

    // First render captures the initial setter
    const initial = setterRefs[0];

    // Trigger a re-render by toggling the hover state
    fireEvent.click(screen.getByTestId("trigger-rerender"));

    // Should have captured the setter from both renders
    expect(setterRefs.length).toBeGreaterThanOrEqual(2);
    // All refs should point to the same stable function
    for (const ref of setterRefs) {
      expect(ref).toBe(initial);
    }
  });

  // ── Bidirectional binding integration ────────────────────────────────────────

  it("map pin hovering causes manifest panel data-map-hover to become highlighted", () => {
    /**
     * Simulates the actual map ↔ manifest binding in the INVENTORY dashboard:
     *   - MapPin: sets hoveredCaseId on mouseenter
     *   - ManifestPanel: applies data-map-hover="highlighted" when its caseId matches
     */
    const CASE_ID = "case-integration-test";

    function FakeMapPin({ caseId }: { caseId: string }) {
      const { hoveredCaseId, setHoveredCaseId } = useMapManifestHover();
      return (
        <div
          data-testid="map-pin"
          data-map-hover={hoveredCaseId === caseId ? "highlighted" : undefined}
          onMouseEnter={() => setHoveredCaseId(caseId)}
          onMouseLeave={() => setHoveredCaseId(null)}
        />
      );
    }

    function FakeManifestPanel({ caseId }: { caseId: string }) {
      const { hoveredCaseId, setHoveredCaseId } = useMapManifestHover();
      return (
        <div
          data-testid="manifest-panel"
          data-map-hover={hoveredCaseId === caseId ? "highlighted" : undefined}
          onMouseEnter={() => setHoveredCaseId(caseId)}
          onMouseLeave={() => setHoveredCaseId(null)}
        />
      );
    }

    render(
      <MapManifestHoverProvider>
        <FakeMapPin caseId={CASE_ID} />
        <FakeManifestPanel caseId={CASE_ID} />
      </MapManifestHoverProvider>
    );

    const pin = screen.getByTestId("map-pin");
    const panel = screen.getByTestId("manifest-panel");

    // Initial state — neither highlighted
    expect(pin.getAttribute("data-map-hover")).toBeNull();
    expect(panel.getAttribute("data-map-hover")).toBeNull();

    // Hover the map pin → both should highlight
    fireEvent.mouseEnter(pin);
    expect(pin.getAttribute("data-map-hover")).toBe("highlighted");
    expect(panel.getAttribute("data-map-hover")).toBe("highlighted");

    // Mouse leave → both should clear
    fireEvent.mouseLeave(pin);
    expect(pin.getAttribute("data-map-hover")).toBeNull();
    expect(panel.getAttribute("data-map-hover")).toBeNull();

    // Hover the manifest panel → both should highlight
    fireEvent.mouseEnter(panel);
    expect(pin.getAttribute("data-map-hover")).toBe("highlighted");
    expect(panel.getAttribute("data-map-hover")).toBe("highlighted");

    // Mouse leave → both should clear
    fireEvent.mouseLeave(panel);
    expect(pin.getAttribute("data-map-hover")).toBeNull();
    expect(panel.getAttribute("data-map-hover")).toBeNull();
  });

  it("hovering a pin for case-X does NOT highlight a manifest panel for case-Y", () => {
    function FakeMapPin({ caseId }: { caseId: string }) {
      const { setHoveredCaseId } = useMapManifestHover();
      return (
        <div
          data-testid={`pin-${caseId}`}
          onMouseEnter={() => setHoveredCaseId(caseId)}
          onMouseLeave={() => setHoveredCaseId(null)}
        />
      );
    }

    function FakeManifestPanel({ caseId }: { caseId: string }) {
      const { hoveredCaseId } = useMapManifestHover();
      return (
        <div
          data-testid={`panel-${caseId}`}
          data-map-hover={hoveredCaseId === caseId ? "highlighted" : undefined}
        />
      );
    }

    render(
      <MapManifestHoverProvider>
        <FakeMapPin caseId="case-X" />
        <FakeMapPin caseId="case-Y" />
        <FakeManifestPanel caseId="case-X" />
        <FakeManifestPanel caseId="case-Y" />
      </MapManifestHoverProvider>
    );

    // Hover pin for case-X
    fireEvent.mouseEnter(screen.getByTestId("pin-case-X"));

    // Panel for case-X should highlight
    expect(screen.getByTestId("panel-case-X").getAttribute("data-map-hover")).toBe("highlighted");
    // Panel for case-Y should NOT highlight
    expect(screen.getByTestId("panel-case-Y").getAttribute("data-map-hover")).toBeNull();

    // Switch hover to case-Y
    fireEvent.mouseLeave(screen.getByTestId("pin-case-X"));
    fireEvent.mouseEnter(screen.getByTestId("pin-case-Y"));

    // Now only case-Y panel should highlight
    expect(screen.getByTestId("panel-case-X").getAttribute("data-map-hover")).toBeNull();
    expect(screen.getByTestId("panel-case-Y").getAttribute("data-map-hover")).toBe("highlighted");
  });
});
