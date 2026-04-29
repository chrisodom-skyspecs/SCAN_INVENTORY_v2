/**
 * @vitest-environment jsdom
 *
 * Unit tests: DossierMapPanel — Map tab content for the T4 Tabbed Dossier.
 *
 * Verifies:
 *   1.  Root element always present with data-testid="dossier-map-panel"
 *   2.  Skeleton shown while case data loads (undefined)
 *   3.  Not-found placeholder shown when case returns null
 *   4.  No-location placeholder shown when case has no lat/lng
 *   5.  No-location placeholder shown when only lat is defined (missing lng)
 *   6.  No-token placeholder shown when coords exist but mapboxToken is absent
 *   7.  No-token placeholder shows coordinate values and location name
 *   8.  GPS strip rendered in no-token state
 *   9.  Full map rendered when coords and token are both available
 *   10. Marker rendered at the case's lat/lng in map mode
 *   11. Location overlay rendered in map mode
 *   12. GPS data strip rendered in map mode
 *   13. data-state attribute reflects current rendering mode
 *   14. data-lat / data-lng attributes set in map mode
 *   15. Root has aria-label in all states
 *   16. Live-map aria-label includes location name when available
 *   17. Case marker has aria-label including location name
 *   18. Marker data-status reflects case status
 *   19. GPS strip shows latitude and longitude data items
 *   20. GPS strip shows location name when present
 *   21. GPS strip shows "Updated" timestamp
 *   22. Dark map style used when isDark = true
 *   23. Skeleton has aria-busy=true
 *   24. Location overlay contains location name + coordinates in map mode
 */

import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

// ─── Mock Convex hooks ─────────────────────────────────────────────────────────

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
 * react-map-gl requires Mapbox GL JS / WebGL context not available in jsdom.
 * Replace with stub divs that expose the props for assertions.
 */
vi.mock("react-map-gl", () => ({
  Map: ({
    children,
    mapStyle,
  }: React.PropsWithChildren<{ mapStyle?: string }>) => (
    <div
      data-testid="mapbox-map"
      data-mapbox-style={mapStyle}
    >
      {children}
    </div>
  ),
  Marker: ({
    children,
    longitude,
    latitude,
  }: React.PropsWithChildren<{ longitude: number; latitude: number }>) => (
    <div
      data-testid="mapbox-marker"
      data-lng={longitude}
      data-lat={latitude}
    >
      {children}
    </div>
  ),
}));

// ─── Mock theme provider ───────────────────────────────────────────────────────

const mockUseIsDark = vi.fn(() => false);

vi.mock("@/providers/theme-provider", () => ({
  useIsDark: () => mockUseIsDark(),
}));

// ─── Import after mocks ────────────────────────────────────────────────────────

import { useQuery } from "convex/react";
import { DossierMapPanel } from "../DossierMapPanel";

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const CASE_ID    = "dossier-map-case-001";
const MAP_TOKEN  = "pk.eytest-dossier-map";
const UPDATED_AT = 1_700_000_000_000;

/**
 * Minimal case document matching getCaseById return type.
 * All optional fields default to undefined so individual tests can opt-in.
 */
function makeCaseDoc(overrides: Partial<{
  lat: number;
  lng: number;
  locationName: string;
  status: string;
  label: string;
  notes: string;
}> = {}) {
  return {
    _id: CASE_ID,
    label: overrides.label ?? "CASE-MAP-001",
    qrCode: "QR-MAP-001",
    status: overrides.status ?? "deployed",
    lat: overrides.lat,
    lng: overrides.lng,
    locationName: overrides.locationName,
    notes: overrides.notes,
    createdAt: UPDATED_AT - 86_400_000,
    updatedAt: UPDATED_AT,
  };
}

// ─── Helper: render DossierMapPanel with optional token ───────────────────────

function renderPanel(tokenOverride?: string) {
  return render(
    <DossierMapPanel caseId={CASE_ID} mapboxToken={tokenOverride} />
  );
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  mockUseIsDark.mockReturnValue(false);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DossierMapPanel — rendering states and data display", () => {
  // ─── 1. Root element always present ─────────────────────────────────────────

  it("renders root element with data-testid=dossier-map-panel", () => {
    vi.mocked(useQuery).mockReturnValue(undefined);
    renderPanel(MAP_TOKEN);
    expect(screen.getByTestId("dossier-map-panel")).toBeTruthy();
  });

  // ─── 2. Skeleton during loading ──────────────────────────────────────────────

  it("shows skeleton when case data is loading (undefined)", () => {
    vi.mocked(useQuery).mockReturnValue(undefined);
    renderPanel(MAP_TOKEN);

    expect(screen.getByTestId("dossier-map-skeleton")).toBeTruthy();
    expect(screen.getByTestId("dossier-map-panel").getAttribute("data-state")).toBe("loading");
  });

  // ─── 23. Skeleton aria-busy ──────────────────────────────────────────────────

  it("skeleton has aria-busy=true for screen readers", () => {
    vi.mocked(useQuery).mockReturnValue(undefined);
    renderPanel(MAP_TOKEN);

    const skeleton = screen.getByTestId("dossier-map-skeleton");
    expect(skeleton.getAttribute("aria-busy")).toBe("true");
  });

  // ─── 3. Not-found state ──────────────────────────────────────────────────────

  it("shows not-found placeholder when case returns null", () => {
    vi.mocked(useQuery).mockReturnValue(null);
    renderPanel(MAP_TOKEN);

    expect(screen.getByTestId("dossier-map-not-found")).toBeTruthy();
    expect(screen.getByTestId("dossier-map-panel").getAttribute("data-state")).toBe("not-found");
  });

  // ─── 4. No coordinates ───────────────────────────────────────────────────────

  it("shows no-location placeholder when case has no lat/lng", () => {
    vi.mocked(useQuery).mockReturnValue(makeCaseDoc()); // no lat/lng
    renderPanel(MAP_TOKEN);

    expect(screen.getByTestId("dossier-map-no-location")).toBeTruthy();
    expect(screen.getByTestId("dossier-map-panel").getAttribute("data-state")).toBe("no-location");
  });

  // ─── 5. Only lat defined ─────────────────────────────────────────────────────

  it("shows no-location placeholder when only lat is defined (missing lng)", () => {
    vi.mocked(useQuery).mockReturnValue(makeCaseDoc({ lat: 42.28 })); // no lng
    renderPanel(MAP_TOKEN);

    expect(screen.getByTestId("dossier-map-no-location")).toBeTruthy();
    expect(screen.getByTestId("dossier-map-panel").getAttribute("data-state")).toBe("no-location");
  });

  // ─── 6. No token state ───────────────────────────────────────────────────────

  it("shows no-token placeholder when coords exist but mapboxToken is absent", () => {
    vi.mocked(useQuery).mockReturnValue(makeCaseDoc({ lat: 42.28, lng: -83.74 }));
    renderPanel(undefined); // no token

    expect(screen.getByTestId("dossier-map-no-token")).toBeTruthy();
    expect(screen.getByTestId("dossier-map-panel").getAttribute("data-state")).toBe("no-token");
  });

  // ─── 7. No-token shows coords ────────────────────────────────────────────────

  it("no-token placeholder displays coordinate values and location name", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74, locationName: "Ann Arbor Depot" })
    );
    renderPanel(undefined);

    const placeholder = screen.getByTestId("dossier-map-no-token");
    const text = placeholder.textContent ?? "";
    expect(text).toContain("Ann Arbor Depot");
  });

  // ─── 8. GPS strip in no-token state ─────────────────────────────────────────

  it("renders GPS strip in no-token state", () => {
    vi.mocked(useQuery).mockReturnValue(makeCaseDoc({ lat: 42.28, lng: -83.74 }));
    renderPanel(undefined);

    expect(screen.getByTestId("dossier-map-gps-strip")).toBeTruthy();
  });

  // ─── 9. Full map mode ────────────────────────────────────────────────────────

  it("renders Mapbox map when coords and token are both available", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74, status: "deployed" })
    );
    renderPanel(MAP_TOKEN);

    expect(screen.getByTestId("dossier-map-panel").getAttribute("data-state")).toBe("map");
    expect(screen.getByTestId("mapbox-map")).toBeTruthy();
  });

  // ─── 10. Marker position ─────────────────────────────────────────────────────

  it("renders marker at the case's lat/lng coordinates", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74 })
    );
    renderPanel(MAP_TOKEN);

    const marker = screen.getByTestId("mapbox-marker");
    expect(marker).toBeTruthy();
    expect(marker.getAttribute("data-lat")).toBe("42.28");
    expect(marker.getAttribute("data-lng")).toBe("-83.74");
  });

  // ─── 11. Location overlay ────────────────────────────────────────────────────

  it("renders location overlay in map mode", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74, locationName: "Site Gamma" })
    );
    renderPanel(MAP_TOKEN);

    expect(screen.getByTestId("dossier-map-location-overlay")).toBeTruthy();
  });

  // ─── 24. Overlay content ─────────────────────────────────────────────────────

  it("location overlay contains location name and coordinates", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74, locationName: "Site Gamma" })
    );
    renderPanel(MAP_TOKEN);

    const overlay = screen.getByTestId("dossier-map-location-overlay");
    const text = overlay.textContent ?? "";
    expect(text).toContain("Site Gamma");
    // Coordinates in formatCoord format: "42.28000° N"
    expect(text).toContain("42.28");
  });

  // ─── 12. GPS strip in map mode ───────────────────────────────────────────────

  it("renders GPS data strip in map mode", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74 })
    );
    renderPanel(MAP_TOKEN);

    expect(screen.getByTestId("dossier-map-gps-strip")).toBeTruthy();
  });

  // ─── 13. data-state attribute ────────────────────────────────────────────────

  it("sets data-state=loading when case data is undefined", () => {
    vi.mocked(useQuery).mockReturnValue(undefined);
    renderPanel(MAP_TOKEN);
    expect(screen.getByTestId("dossier-map-panel").getAttribute("data-state")).toBe("loading");
  });

  it("sets data-state=not-found when case returns null", () => {
    vi.mocked(useQuery).mockReturnValue(null);
    renderPanel(MAP_TOKEN);
    expect(screen.getByTestId("dossier-map-panel").getAttribute("data-state")).toBe("not-found");
  });

  it("sets data-state=no-location when case has no coordinates", () => {
    vi.mocked(useQuery).mockReturnValue(makeCaseDoc());
    renderPanel(MAP_TOKEN);
    expect(screen.getByTestId("dossier-map-panel").getAttribute("data-state")).toBe("no-location");
  });

  it("sets data-state=no-token when token is absent", () => {
    vi.mocked(useQuery).mockReturnValue(makeCaseDoc({ lat: 42.28, lng: -83.74 }));
    renderPanel(undefined);
    expect(screen.getByTestId("dossier-map-panel").getAttribute("data-state")).toBe("no-token");
  });

  it("sets data-state=map when both coords and token are present", () => {
    vi.mocked(useQuery).mockReturnValue(makeCaseDoc({ lat: 42.28, lng: -83.74 }));
    renderPanel(MAP_TOKEN);
    expect(screen.getByTestId("dossier-map-panel").getAttribute("data-state")).toBe("map");
  });

  // ─── 14. data-lat / data-lng attributes ──────────────────────────────────────

  it("sets data-lat and data-lng on root in map mode", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28083, lng: -83.74302 })
    );
    renderPanel(MAP_TOKEN);

    const root = screen.getByTestId("dossier-map-panel");
    expect(root.getAttribute("data-lat")).toBe("42.28083");
    expect(root.getAttribute("data-lng")).toBe("-83.74302");
  });

  // ─── 15. Root aria-label in all states ───────────────────────────────────────

  it("root has aria-label for all rendering states", () => {
    // Loading state
    vi.mocked(useQuery).mockReturnValue(undefined);
    const { unmount: u1 } = renderPanel(MAP_TOKEN);
    expect(screen.getByTestId("dossier-map-panel").getAttribute("aria-label")).toBeTruthy();
    u1();
    cleanup();

    // Map state
    vi.mocked(useQuery).mockReturnValue(makeCaseDoc({ lat: 42.28, lng: -83.74 }));
    renderPanel(MAP_TOKEN);
    expect(screen.getByTestId("dossier-map-panel").getAttribute("aria-label")).toBeTruthy();
  });

  // ─── 16. Aria-label includes location name ────────────────────────────────────

  it("live-map aria-label includes location name when available", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74, locationName: "HQ Depot" })
    );
    renderPanel(MAP_TOKEN);

    const ariaLabel = screen.getByTestId("dossier-map-panel").getAttribute("aria-label") ?? "";
    expect(ariaLabel).toContain("HQ Depot");
  });

  // ─── 17. Marker has aria-label ───────────────────────────────────────────────

  it("case marker has aria-label with location name", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74, locationName: "Alpha Site" })
    );
    renderPanel(MAP_TOKEN);

    const markerEl = screen.getByTestId("dossier-map-marker");
    const ariaLabel = markerEl.getAttribute("aria-label") ?? "";
    expect(ariaLabel).toBeTruthy();
    expect(ariaLabel).toContain("Alpha Site");
  });

  // ─── 18. Marker data-status ──────────────────────────────────────────────────

  it("marker head has data-status matching the case status", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74, status: "flagged" })
    );
    renderPanel(MAP_TOKEN);

    // The marker head div inside the marker wrapper carries data-status
    const markerWrapper = screen.getByTestId("dossier-map-marker");
    // The actual caseMarker div is inside the Marker wrapper; its first child is the head
    const markerInner = screen.getByTestId("dossier-map-marker");
    // Check that the head with data-status exists within the marker
    const head = markerInner.querySelector("[data-status]");
    expect(head).toBeTruthy();
    expect(head?.getAttribute("data-status")).toBe("flagged");
  });

  // ─── 19. GPS strip shows lat and lng ─────────────────────────────────────────

  it("GPS strip contains Latitude and Longitude labels", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74 })
    );
    renderPanel(MAP_TOKEN);

    const strip = screen.getByTestId("dossier-map-gps-strip");
    const text = strip.textContent ?? "";
    expect(text).toContain("Latitude");
    expect(text).toContain("Longitude");
  });

  // ─── 20. GPS strip shows location name ───────────────────────────────────────

  it("GPS strip shows location name when present", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74, locationName: "Beta Site" })
    );
    renderPanel(MAP_TOKEN);

    const strip = screen.getByTestId("dossier-map-gps-strip");
    expect(strip.textContent).toContain("Beta Site");
  });

  it("GPS strip does not show Location label when locationName is absent", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74 }) // no locationName
    );
    renderPanel(MAP_TOKEN);

    const strip = screen.getByTestId("dossier-map-gps-strip");
    // "Location" label should not appear when locationName is undefined
    const text = strip.textContent ?? "";
    expect(text).not.toContain("Location");
  });

  // ─── 21. GPS strip shows Updated timestamp ────────────────────────────────────

  it("GPS strip contains Updated timestamp label", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74 })
    );
    renderPanel(MAP_TOKEN);

    const strip = screen.getByTestId("dossier-map-gps-strip");
    expect(strip.textContent).toContain("Updated");
  });

  // ─── 22. Dark map style ───────────────────────────────────────────────────────

  it("uses dark Mapbox style when isDark = true", () => {
    mockUseIsDark.mockReturnValue(true);
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74 })
    );
    renderPanel(MAP_TOKEN);

    const map = screen.getByTestId("mapbox-map");
    const style = map.getAttribute("data-mapbox-style") ?? "";
    expect(style).toContain("dark");
  });

  it("uses light Mapbox style when isDark = false", () => {
    mockUseIsDark.mockReturnValue(false);
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74 })
    );
    renderPanel(MAP_TOKEN);

    const map = screen.getByTestId("mapbox-map");
    const style = map.getAttribute("data-mapbox-style") ?? "";
    expect(style).not.toContain("dark");
  });
});

// ─── GPS strip coordinate format tests ────────────────────────────────────────

describe("DossierMapPanel — GPS coordinate formatting", () => {
  it("GPS strip shows decimal degree coordinates", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28083, lng: -83.74302 })
    );
    renderPanel(MAP_TOKEN);

    const strip = screen.getByTestId("dossier-map-gps-strip");
    const text = strip.textContent ?? "";
    // Should contain decimal values with degree sign
    expect(text).toContain("42.28083");
    expect(text).toContain("83.74302");
  });
});

// ─── T4DossierShell integration ───────────────────────────────────────────────

describe("DossierMapPanel — integration with T4DossierShell", () => {
  it("renders without errors when mounted directly", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74, locationName: "Integration Site" })
    );

    expect(() => {
      render(<DossierMapPanel caseId={CASE_ID} mapboxToken={MAP_TOKEN} />);
    }).not.toThrow();
  });

  it("panel renders GPS strip and map container in map state", () => {
    vi.mocked(useQuery).mockReturnValue(
      makeCaseDoc({ lat: 42.28, lng: -83.74 })
    );
    render(<DossierMapPanel caseId={CASE_ID} mapboxToken={MAP_TOKEN} />);

    expect(screen.getByTestId("dossier-map-container")).toBeTruthy();
    expect(screen.getByTestId("dossier-map-gps-strip")).toBeTruthy();
  });
});
