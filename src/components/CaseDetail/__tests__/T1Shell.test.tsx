/**
 * @vitest-environment jsdom
 *
 * Unit tests: T1Shell — 50/50 CSS grid container for the T1 Summary layout.
 *
 * Verifies:
 *   1. Shell renders with the correct test IDs for structural queries.
 *   2. leftPanel content appears inside the left panel element.
 *   3. rightPanel content appears inside the right panel element.
 *   4. ARIA labels are present for accessibility (screen reader regions).
 *   5. data-testid attributes are correct for integration-test targeting.
 *   6. Both panels render independently (null content doesn't break the layout).
 *   7. Component accepts and renders arbitrary ReactNode children.
 *   8. Shell container is a direct parent of both panels (single DOM node).
 */

import React from "react";
import { render, screen, within, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { T1Shell } from "../T1Shell";

// Clean up after every test to avoid DOM accumulation across assertions.
afterEach(() => cleanup());

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderShell(
  leftPanel: React.ReactNode = null,
  rightPanel: React.ReactNode = null
) {
  return render(<T1Shell leftPanel={leftPanel} rightPanel={rightPanel} />);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("T1Shell — 50/50 grid container", () => {
  // ─── 1. Structural test IDs ───────────────────────────────────────────────

  it("renders the shell container with data-testid=t1-shell", () => {
    renderShell();
    expect(screen.getByTestId("t1-shell")).toBeTruthy();
  });

  it("renders the left panel with data-testid=t1-shell-left", () => {
    renderShell();
    expect(screen.getByTestId("t1-shell-left")).toBeTruthy();
  });

  it("renders the right panel with data-testid=t1-shell-right", () => {
    renderShell();
    expect(screen.getByTestId("t1-shell-right")).toBeTruthy();
  });

  // ─── 2. Left panel content ────────────────────────────────────────────────

  it("renders leftPanel content inside the left panel element", () => {
    renderShell(
      <p data-testid="left-content">Case identity info</p>,
      null
    );

    const leftPanel = screen.getByTestId("t1-shell-left");
    expect(within(leftPanel).getByTestId("left-content")).toBeTruthy();
    expect(within(leftPanel).getByText("Case identity info")).toBeTruthy();
  });

  it("does NOT render leftPanel content in the right panel", () => {
    renderShell(
      <p data-testid="left-only">Left only</p>,
      null
    );

    const rightPanel = screen.getByTestId("t1-shell-right");
    expect(within(rightPanel).queryByTestId("left-only")).toBeNull();
  });

  // ─── 3. Right panel content ───────────────────────────────────────────────

  it("renders rightPanel content inside the right panel element", () => {
    renderShell(
      null,
      <p data-testid="right-content">Operational status</p>
    );

    const rightPanel = screen.getByTestId("t1-shell-right");
    expect(within(rightPanel).getByTestId("right-content")).toBeTruthy();
    expect(within(rightPanel).getByText("Operational status")).toBeTruthy();
  });

  it("does NOT render rightPanel content in the left panel", () => {
    renderShell(
      null,
      <p data-testid="right-only">Right only</p>
    );

    const leftPanel = screen.getByTestId("t1-shell-left");
    expect(within(leftPanel).queryByTestId("right-only")).toBeNull();
  });

  // ─── 4. ARIA labels ───────────────────────────────────────────────────────

  it("renders the shell container with aria-label", () => {
    renderShell();
    const shell = screen.getByTestId("t1-shell");
    expect(shell.getAttribute("aria-label")).toBeTruthy();
    expect(shell.getAttribute("aria-label")).toContain("summary");
  });

  it("renders the left panel with aria-label referencing identity", () => {
    renderShell();
    const leftPanel = screen.getByTestId("t1-shell-left");
    expect(leftPanel.getAttribute("aria-label")).toBeTruthy();
    expect(leftPanel.getAttribute("aria-label")).toContain("identity");
  });

  it("renders the right panel with aria-label referencing status", () => {
    renderShell();
    const rightPanel = screen.getByTestId("t1-shell-right");
    expect(rightPanel.getAttribute("aria-label")).toBeTruthy();
    expect(rightPanel.getAttribute("aria-label")).toContain("status");
  });

  // ─── 5. Both panels present simultaneously ────────────────────────────────

  it("renders both panels side-by-side at the same time", () => {
    renderShell(
      <span>Left content</span>,
      <span>Right content</span>
    );

    expect(screen.getByTestId("t1-shell-left")).toBeTruthy();
    expect(screen.getByTestId("t1-shell-right")).toBeTruthy();
    expect(screen.getByText("Left content")).toBeTruthy();
    expect(screen.getByText("Right content")).toBeTruthy();
  });

  // ─── 6. Null content ─────────────────────────────────────────────────────

  it("renders without error when both panels receive null", () => {
    expect(() => renderShell(null, null)).not.toThrow();
    expect(screen.getByTestId("t1-shell")).toBeTruthy();
  });

  it("renders without error when only leftPanel has content", () => {
    expect(() =>
      renderShell(<span>Only left</span>, null)
    ).not.toThrow();
    expect(screen.getByText("Only left")).toBeTruthy();
  });

  it("renders without error when only rightPanel has content", () => {
    expect(() =>
      renderShell(null, <span>Only right</span>)
    ).not.toThrow();
    expect(screen.getByText("Only right")).toBeTruthy();
  });

  // ─── 7. Arbitrary ReactNode children ─────────────────────────────────────

  it("accepts complex nested ReactNode trees in leftPanel", () => {
    renderShell(
      <section>
        <h2>Case Label</h2>
        <dl>
          <dt>Location</dt>
          <dd>Site A</dd>
        </dl>
      </section>,
      null
    );

    expect(screen.getByRole("heading", { name: "Case Label" })).toBeTruthy();
    expect(screen.getByText("Site A")).toBeTruthy();
  });

  it("accepts complex nested ReactNode trees in rightPanel", () => {
    renderShell(
      null,
      <div>
        <h3>Checklist</h3>
        <progress value={75} max={100} aria-label="progress" />
      </div>
    );

    expect(screen.getByRole("heading", { name: "Checklist" })).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  // ─── 8. Shell is a single DOM element (no fragment) ──────────────────────

  it("the shell container is a direct parent of both panels", () => {
    renderShell(
      <span>Left</span>,
      <span>Right</span>
    );

    const shell = screen.getByTestId("t1-shell");
    const leftPanel = screen.getByTestId("t1-shell-left");
    const rightPanel = screen.getByTestId("t1-shell-right");

    // Both panels should be contained within the shell
    expect(shell.contains(leftPanel)).toBe(true);
    expect(shell.contains(rightPanel)).toBe(true);
  });

  it("the shell container has exactly two direct children (left and right panels)", () => {
    renderShell(
      <span>Left</span>,
      <span>Right</span>
    );

    const shell = screen.getByTestId("t1-shell");
    // The shell should have exactly 2 direct children (the two panel divs)
    expect(shell.children).toHaveLength(2);
  });
});

// ─── leftPanelHasMap prop ─────────────────────────────────────────────────────

describe("T1Shell — leftPanelHasMap prop", () => {
  // ─── Default behaviour (no map) ───────────────────────────────────────────

  it("left panel has aria-label containing 'identity' by default", () => {
    render(<T1Shell leftPanel={null} rightPanel={null} />);
    const leftPanel = screen.getByTestId("t1-shell-left");
    expect(leftPanel.getAttribute("aria-label")).toContain("identity");
  });

  it("left panel does NOT have data-has-map attribute by default", () => {
    render(<T1Shell leftPanel={null} rightPanel={null} />);
    const leftPanel = screen.getByTestId("t1-shell-left");
    expect(leftPanel.getAttribute("data-has-map")).toBeNull();
  });

  // ─── Map mode ────────────────────────────────────────────────────────────

  it("left panel has aria-label containing 'map' when leftPanelHasMap is true", () => {
    render(
      <T1Shell
        leftPanel={<div data-testid="map-content">Map here</div>}
        rightPanel={null}
        leftPanelHasMap={true}
      />
    );
    const leftPanel = screen.getByTestId("t1-shell-left");
    expect(leftPanel.getAttribute("aria-label")).toContain("map");
  });

  it("left panel has data-has-map='true' when leftPanelHasMap is true", () => {
    render(
      <T1Shell leftPanel={null} rightPanel={null} leftPanelHasMap={true} />
    );
    const leftPanel = screen.getByTestId("t1-shell-left");
    expect(leftPanel.getAttribute("data-has-map")).toBe("true");
  });

  it("renders map panel content inside the left panel when leftPanelHasMap is true", () => {
    render(
      <T1Shell
        leftPanel={<div data-testid="mini-map">Mini map</div>}
        rightPanel={<span>Right</span>}
        leftPanelHasMap={true}
      />
    );
    const leftPanel = screen.getByTestId("t1-shell-left");
    expect(within(leftPanel).getByTestId("mini-map")).toBeTruthy();
    expect(within(leftPanel).getByText("Mini map")).toBeTruthy();
  });

  it("right panel is unaffected when leftPanelHasMap is true", () => {
    render(
      <T1Shell
        leftPanel={null}
        rightPanel={<p data-testid="right-content">Right content</p>}
        leftPanelHasMap={true}
      />
    );
    const rightPanel = screen.getByTestId("t1-shell-right");
    expect(within(rightPanel).getByTestId("right-content")).toBeTruthy();
    expect(rightPanel.getAttribute("aria-label")).toContain("status");
  });

  it("shell structure is preserved (exactly 2 children) when leftPanelHasMap is true", () => {
    render(
      <T1Shell
        leftPanel={<span>Map</span>}
        rightPanel={<span>Info</span>}
        leftPanelHasMap={true}
      />
    );
    const shell = screen.getByTestId("t1-shell");
    expect(shell.children).toHaveLength(2);
  });
});
