/**
 * @vitest-environment jsdom
 *
 * Unit tests: T1MapPanel — mini-map panel for the T1 Summary layout.
 *
 * Verifies:
 *   1. Component renders with data-testid="t1-map-panel" root element.
 *   2. Skeleton placeholder shown when case data is loading (undefined).
 *   3. "Not found" placeholder shown when case is null.
 *   4. "No location" placeholder shown when case has no lat/lng.
 *   5. "No token" placeholder shown when case has coords but no mapbox token.
 *   6. Live map container shown when case has coords + token.
 *   7. data-state attribute reflects current rendering mode.
 *   8. Location overlay rendered in live-map mode.
 *   9. data-lat / data-lng attributes set correctly on root in map mode.
 *  10. CSS module class "root" applied — verifies grid positioning entry point.
 *  11. Root element structure supports T1Shell left-panel placement.
 *  12. ARIA labels present for accessibility (map region, loading state).
 */

import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

// ─── Mock Convex hooks ─────────────────────────────────────────────────────────

/**
 * useQuery is mocked to control what case data T1MapPanel receives.
 * Each test uses vi.mocked(useQuery).mockReturnValue(...) to set the state.
 */
vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
}));

vi.mock("../../../convex/_generated/api", () => ({
  api: {
    cases: {
      getCaseById: "cases:getCaseById",
    },
  },
}));

vi.mock("../../../convex/_generated/dataModel", () => ({
  Id: {},
}));

// ─── Mock react-map-gl ─────────────────────────────────────────────────────────

/**
 * react-map-gl requires a Mapbox GL JS environment that isn't available in jsdom.
 * The Map component is replaced with a simple div so the test can verify it is
 * rendered without instantiating the full WebGL context.
 */
vi.mock("react-map-gl", () => ({
  Map: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div data-testid="mapbox-map" data-mapbox-style={props.mapStyle as string}>
      {children}
    </div>
  ),
  Marker: ({ children, longitude, latitude }: React.PropsWithChildren<{ longitude: number; latitude: number }>) => (
    <div data-testid="mapbox-marker" data-lng={longitude} data-lat={latitude}>
      {children}
    </div>
  ),
}));

// ─── Mock theme provider ───────────────────────────────────────────────────────

vi.mock("@/providers/theme-provider", () => ({
  useIsDark: () => false,
}));

// ─── Import after mocks ────────────────────────────────────────────────────────

import { useQuery } from "convex/react";
import { T1MapPanel } from "../T1MapPanel";

// ─── Test case factory ─────────────────────────────────────────────────────────

const CASE_ID = "case-test-001";
const MAPBOX_TOKEN = "pk.test-token";

/**
 * Minimal case document shape matching convex/cases.ts getCaseById return type.
 */
function makeCaseDoc(overrides: Partial<{
  lat: number;
  lng: number;
  locationName: string;
  status: string;
  label: string;
}> = {}) {
  return {
    _id: CASE_ID,
    label: overrides.label ?? "CASE-001",
    qrCode: "QR-001",
    status: overrides.status ?? "hangar",
    lat: overrides.lat,
    lng: overrides.lng,
    locationName: overrides.locationName,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderPanel(tokenOverride?: string) {
  return render(
    <T1MapPanel caseId={CASE_ID} mapboxToken={tokenOverride} />
  );
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("T1MapPanel — grid placement and rendering states", () => {
  // ─── 1. Root element always present ─────────────────────────────────────────

  it("renders the root element with data-testid=t1-map-panel", () => {
    vi.mocked(useQuery).mockReturnValue(undefined); // loading state
    renderPanel(MAPBOX_TOKEN);
    expect(screen.getByTestId("t1-map-panel")).toBeTruthy();
  });

  // ─── 2. Skeleton during loading ──────────────────────────────────────────────

  it("shows skeleton placeholder when case data is loading (undefined)", () => {
    vi.mocked(useQuery).mockReturnValue(undefined);
    renderPanel(MAPBOX_TOKEN);

    expect(screen.getByTestId("t1-map-panel")).toBeTruthy();
    expect(screen.getByTestId("t1-map-panel-skeleton")).toBeTruthy();
    expect(screen.getByTestId("t1-map-panel").getAttribute("data-state")).toBe("loading");
  });

  it("skeleton has aria-busy=true for screen readers", () => {
    vi.mocked(useQuery).mockReturnValue(undefined);
    renderPanel(MAPBOX_TOKEN);

    const skeleton = screen.getByTestId("t1-map-panel-skeleton");
    expect(skeleton.getAttribute("aria-busy")).toBe("true");
  });

  // ─── 3. Not-found state ──────────────────────────────────────────────────────

  it("shows not-found placeholder when case returns null", () => {
    vi.mocked(useQuery).mockReturnValue(null);
    renderPanel(MAPBOX_TOKEN);

    expect(screen.getByTestId("t1-map-panel-not-found")).toBeTruthy();
    expect(screen.getByTestId("t1-map-panel").getAttribute("data-state")).toBe("not-found");
  });

  // ─── 4. No coordinates ───────────────────────────────────────────────────────

  it("shows no-location placeholder when case has no lat/lng", () => {
    vi.mocked(useQuery).mockReturnValue(makeCaseDoc()); // no lat/lng
    renderPanel(MAPBOX_TOKEN);

    expect(screen.getByTestId("t1-map-panel-no-location")).toBeTruthy();
    expect(screen.getByTestId("t1-map-panel").getAttribute("data-state")).toBe("no-location");
  });

  it("shows no-location placeholder when only lat is defined (missing lng)", () => {
    vi.mocked(useQuery).mockReturnValue(makeCaseDoc({ lat: 42.28 })); // lng missing
    renderPanel(MAPBOX_TOKEN);

    expect(screen.getByTestId("t1-map-panel-no-location")).toBeTruthy();
  });

  // ─── 5. No token ─────────────────────────────────────────────────────────────

  it("shows no-token placeholder when coords exist but mapboxToken is absent", () => {
    vi.mocked(useQuery).mockReturnValue(makeCaseDoc({ lat: 42.28, lng: -83.74 }));
    renderPanel(undefined); // no token

    expect(screen.getByTestId("t1-map-panel-no-token")).toBeTruthy();
    expect(screen.getByTestId("t1-map-panel").getAttribute("data-state")).toBe("no-token");
  });

  it("no-token placeholder displays coordinate values", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74, locationName: "Ann Arbor HQ" })
    );
    renderPanel(undefined);

    // Location name should appear in the placeholder text
    expect(screen.getByTestId("t1-map-panel-no-token")).toBeTruthy();
    const text = screen.getByTestId("t1-map-panel-no-token").textContent ?? "";
    expect(text).toContain("Ann Arbor HQ");
  });

  // ─── 6. Live map mode ────────────────────────────────────────────────────────

  it("renders the Mapbox map when coords and token are both available", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74, status: "deployed" })
    );
    renderPanel(MAPBOX_TOKEN);

    expect(screen.getByTestId("t1-map-panel").getAttribute("data-state")).toBe("map");
    expect(screen.getByTestId("mapbox-map")).toBeTruthy();
  });

  it("renders a Marker at the case coordinates", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74 })
    );
    renderPanel(MAPBOX_TOKEN);

    const marker = screen.getByTestId("mapbox-marker");
    expect(marker).toBeTruthy();
    expect(marker.getAttribute("data-lat")).toBe("42.28");
    expect(marker.getAttribute("data-lng")).toBe("-83.74");
  });

  it("renders the location info overlay in map mode", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74, locationName: "Site Alpha" })
    );
    renderPanel(MAPBOX_TOKEN);

    expect(screen.getByTestId("t1-map-panel-overlay")).toBeTruthy();
    const overlayText = screen.getByTestId("t1-map-panel-overlay").textContent ?? "";
    expect(overlayText).toContain("Site Alpha");
  });

  // ─── 7. data-state attribute ─────────────────────────────────────────────────

  it("sets data-state=loading when case data is undefined", () => {
    vi.mocked(useQuery).mockReturnValue(undefined);
    renderPanel(MAPBOX_TOKEN);
    expect(screen.getByTestId("t1-map-panel").getAttribute("data-state")).toBe("loading");
  });

  it("sets data-state=not-found when case is null", () => {
    vi.mocked(useQuery).mockReturnValue(null);
    renderPanel(MAPBOX_TOKEN);
    expect(screen.getByTestId("t1-map-panel").getAttribute("data-state")).toBe("not-found");
  });

  it("sets data-state=no-location when case has no coordinates", () => {
    vi.mocked(useQuery).mockReturnValue(makeCaseDoc());
    renderPanel(MAPBOX_TOKEN);
    expect(screen.getByTestId("t1-map-panel").getAttribute("data-state")).toBe("no-location");
  });

  it("sets data-state=no-token when token is absent", () => {
    vi.mocked(useQuery).mockReturnValue(makeCaseDoc({ lat: 42.28, lng: -83.74 }));
    renderPanel(undefined);
    expect(screen.getByTestId("t1-map-panel").getAttribute("data-state")).toBe("no-token");
  });

  it("sets data-state=map when both coords and token are present", () => {
    vi.mocked(useQuery).mockReturnValue(makeCaseDoc({ lat: 42.28, lng: -83.74 }));
    renderPanel(MAPBOX_TOKEN);
    expect(screen.getByTestId("t1-map-panel").getAttribute("data-state")).toBe("map");
  });

  // ─── 9. data-lat / data-lng attributes ──────────────────────────────────────

  it("sets data-lat and data-lng on root in map mode", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.2808, lng: -83.743 })
    );
    renderPanel(MAPBOX_TOKEN);

    const root = screen.getByTestId("t1-map-panel");
    expect(root.getAttribute("data-lat")).toBe("42.2808");
    expect(root.getAttribute("data-lng")).toBe("-83.743");
  });

  // ─── 10. CSS class applied (grid positioning) ────────────────────────────────

  it("applies a CSS class to the root element (grid positioning entry point)", () => {
    vi.mocked(useQuery).mockReturnValue(undefined);
    renderPanel(MAPBOX_TOKEN);

    const root = screen.getByTestId("t1-map-panel");
    // The class should be non-empty — the CSS module generates a scoped class name.
    // We can't assert the exact generated name, but we can verify a class exists.
    expect(root.className.length).toBeGreaterThan(0);
  });

  // ─── 11. Custom className prop ───────────────────────────────────────────────

  it("merges custom className with root classes", () => {
    vi.mocked(useQuery).mockReturnValue(undefined);
    render(<T1MapPanel caseId={CASE_ID} mapboxToken={MAPBOX_TOKEN} className="extra-class" />);

    const root = screen.getByTestId("t1-map-panel");
    expect(root.className).toContain("extra-class");
  });

  // ─── 12. ARIA labels ─────────────────────────────────────────────────────────

  it("root has aria-label for all states", () => {
    // Loading state
    vi.mocked(useQuery).mockReturnValue(undefined);
    const { unmount: u1 } = renderPanel(MAPBOX_TOKEN);
    expect(screen.getByTestId("t1-map-panel").getAttribute("aria-label")).toBeTruthy();
    u1();
    cleanup();

    // Map state
    vi.mocked(useQuery).mockReturnValue(makeCaseDoc({ lat: 42.28, lng: -83.74 }));
    renderPanel(MAPBOX_TOKEN);
    expect(screen.getByTestId("t1-map-panel").getAttribute("aria-label")).toBeTruthy();
  });

  it("live-map aria-label includes location name when available", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74, locationName: "HQ Site" })
    );
    renderPanel(MAPBOX_TOKEN);

    const ariaLabel = screen.getByTestId("t1-map-panel").getAttribute("aria-label") ?? "";
    expect(ariaLabel).toContain("HQ Site");
  });

  // ─── Marker has accessibility info ──────────────────────────────────────────

  it("case marker has an aria-label", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74, locationName: "Test Site" })
    );
    renderPanel(MAPBOX_TOKEN);

    const markerEl = screen.getByTestId("t1-map-panel-marker");
    expect(markerEl.getAttribute("aria-label")).toBeTruthy();
    expect(markerEl.getAttribute("aria-label")).toContain("Test Site");
  });
});
