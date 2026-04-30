/**
 * @vitest-environment jsdom
 *
 * StopMarkerFactory.test.ts
 *
 * Unit tests for src/components/Map/StopMarkerFactory.ts
 *
 * Coverage matrix
 * ───────────────
 *
 * createStopMarkerSVG — pure function:
 *   ✓ returns a string containing an <svg> element
 *   ✓ default variant ("intermediate") renders correctly
 *   ✓ "first" variant uses the correct token color (deployed/green hsl)
 *   ✓ "last" variant uses the correct token color (transit/blue hsl)
 *   ✓ "intermediate" variant uses the correct token color (history/gray hsl)
 *   ✓ "selected" variant uses the blue color (same as last)
 *   ✓ SVG contains the stop index number as text content
 *   ✓ stop index is truncated to 3 characters for large numbers
 *   ✓ default size matches variant defaults (first/last=26, intermediate=24)
 *   ✓ custom size option is applied to width/height attributes
 *   ✓ IBM Plex Mono is specified in font-family
 *   ✓ SVG has role="img" and aria-label="Stop N"
 *   ✓ selection ring NOT present by default for non-selected variants
 *   ✓ selection ring IS present for "selected" variant by default
 *   ✓ selection ring can be explicitly requested via showSelectionRing=true
 *   ✓ selection ring can be suppressed for "selected" via showSelectionRing=false
 *   ✓ dark theme uses different background colors
 *   ✓ output is a valid SVG string (parseable by DOMParser)
 *   ✓ SVG is JSON-serializable (no circular refs)
 *
 * createStopMarkerElement — DOM factory:
 *   ✓ returns an HTMLElement (wrapper div)
 *   ✓ element has role="img" attribute
 *   ✓ element has aria-label="Stop N" attribute
 *   ✓ element has data-stop-index attribute equal to stopIndex
 *   ✓ element has data-variant attribute equal to variant
 *   ✓ badge child element is present (data-testid="stop-marker-factory-badge")
 *   ✓ badge displays the correct stop number text
 *   ✓ badge text is truncated to 3 characters for large stop indices
 *   ✓ badge background color matches the variant token color
 *   ✓ selection ring NOT present by default for non-selected variants
 *   ✓ selection ring IS present for "selected" variant
 *   ✓ selection ring can be explicitly requested via showSelectionRing=true
 *   ✓ selection ring has data-testid="stop-marker-factory-selection-ring"
 *   ✓ badge size matches the variant default
 *   ✓ custom size is applied to badge width/height styles
 *   ✓ dark theme option changes badge background color
 *   ✓ IBM Plex Mono font-family is set on the badge
 *
 * getStopMarkerImageId — pure function:
 *   ✓ returns "stop-marker-<N>-<variant>" format
 *   ✓ uses "intermediate" as default variant
 *   ✓ different stop indices produce different IDs
 *   ✓ different variants produce different IDs for the same stop index
 *
 * addStopMarkerImage — async Mapbox GL integration:
 *   ✓ calls map.addImage with the correct ID
 *   ✓ calls map.addImage with an HTMLImageElement
 *   ✓ uses devicePixelRatio=2 by default for pixelRatio option
 *   ✓ uses custom devicePixelRatio when provided
 *   ✓ returns the image ID on success
 *   ✓ is idempotent — skips addImage when hasImage returns true
 *   ✓ does NOT call addImage again when the image already exists
 *   ✓ rejects when the image fails to load
 *
 * preloadStopMarkerImages — bulk helper:
 *   ✓ registers all 4 variants for each stop index when given defaults
 *   ✓ returns an array of image IDs with length = maxStopIndex * variants.length
 *   ✓ accepts a custom variants subset
 *   ✓ all returned IDs follow the "stop-marker-<N>-<variant>" format
 *   ✓ is idempotent (skips images already in the sprite)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createStopMarkerSVG,
  createStopMarkerElement,
  getStopMarkerImageId,
  addStopMarkerImage,
  preloadStopMarkerImages,
  type StopMarkerVariant,
  type MapboxGLMapLike,
} from "../StopMarkerFactory";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse an SVG string and return the root element (or throw). */
function parseSVG(svgString: string): SVGSVGElement {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(svgString, "image/svg+xml");
  const errors = doc.querySelectorAll("parsererror");
  if (errors.length > 0) {
    throw new Error(`Invalid SVG: ${errors[0].textContent}`);
  }
  return doc.documentElement as unknown as SVGSVGElement;
}

/** Build a minimal mock Mapbox GL map. */
function makeMockMap(existingIds: string[] = []): MapboxGLMapLike & {
  addImageCalls: Array<{ id: string; image: unknown; options: unknown }>;
} {
  const imageSet = new Set(existingIds);
  const addImageCalls: Array<{ id: string; image: unknown; options: unknown }> = [];
  return {
    addImageCalls,
    hasImage(id: string) {
      return imageSet.has(id);
    },
    addImage(
      id: string,
      image: unknown,
      options: unknown
    ) {
      addImageCalls.push({ id, image, options });
      imageSet.add(id);
    },
  };
}

/**
 * Simulate a successful `Image.onload` trigger by overriding `Image.src` setter.
 * When `src` is set, the `onload` handler is called in the next microtask.
 */
function installLoadingImageMock() {
  // We override window.Image in jsdom for the duration of a test
  const OriginalImage = window.Image;
  const MockImage = class MockImage {
    public onload: (() => void) | null    = null;
    public onerror: ((e: unknown) => void) | null = null;
    public width  = 0;
    public height = 0;
    private _src  = "";

    get src() { return this._src; }
    set src(value: string) {
      this._src = value;
      // Trigger onload in the next microtask (simulates async image loading)
      if (this.onload) {
        const cb = this.onload;
        Promise.resolve().then(() => cb());
      }
    }
  };
  // @ts-expect-error — intentional DOM mock override for testing
  window.Image = MockImage;
  return () => { window.Image = OriginalImage; };
}

/**
 * Simulate a failing `Image.onerror` trigger.
 */
function installFailingImageMock() {
  const OriginalImage = window.Image;
  const MockImage = class MockImage {
    public onload: (() => void) | null    = null;
    public onerror: ((e: unknown) => void) | null = null;
    public width  = 0;
    public height = 0;
    private _src  = "";

    get src() { return this._src; }
    set src(value: string) {
      this._src = value;
      if (this.onerror) {
        const cb = this.onerror;
        Promise.resolve().then(() => cb(new ErrorEvent("error", { message: "SVG load failed" })));
      }
    }
  };
  // @ts-expect-error — intentional DOM mock override for testing
  window.Image = MockImage;
  return () => { window.Image = OriginalImage; };
}

// ─── Token color values (matching StopMarkerFactory.ts TOKEN_COLORS.light) ────
const COLOR_FIRST        = "hsl(142, 54%, 48%)";
const COLOR_LAST         = "hsl(211, 85%, 52%)";
const COLOR_INTERMEDIATE = "hsl(210, 9%, 50%)";
const COLOR_SELECTED     = "hsl(211, 85%, 52%)";

// ─── Default sizes (matching DEFAULT_SIZE in StopMarkerFactory.ts) ─────────────
const SIZE_FIRST        = 26;
const SIZE_LAST         = 26;
const SIZE_INTERMEDIATE = 24;
const SIZE_SELECTED     = 28;

// ═══════════════════════════════════════════════════════════════════════════════
// createStopMarkerSVG
// ═══════════════════════════════════════════════════════════════════════════════

describe("createStopMarkerSVG", () => {
  it("returns a string containing an <svg> element", () => {
    const svg = createStopMarkerSVG(1);
    expect(typeof svg).toBe("string");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("default variant ('intermediate') renders without error", () => {
    expect(() => createStopMarkerSVG(1)).not.toThrow();
    const svg = createStopMarkerSVG(1);
    expect(svg).toContain("<svg");
  });

  it("'first' variant includes the deployed/green token color", () => {
    const svg = createStopMarkerSVG(1, "first");
    expect(svg).toContain(COLOR_FIRST);
  });

  it("'last' variant includes the transit/blue token color", () => {
    const svg = createStopMarkerSVG(1, "last");
    expect(svg).toContain(COLOR_LAST);
  });

  it("'intermediate' variant includes the history/gray token color", () => {
    const svg = createStopMarkerSVG(1, "intermediate");
    expect(svg).toContain(COLOR_INTERMEDIATE);
  });

  it("'selected' variant includes the transit/blue color (same as last)", () => {
    const svg = createStopMarkerSVG(1, "selected");
    expect(svg).toContain(COLOR_SELECTED);
  });

  it("SVG contains the stop index number as text content", () => {
    const svg = createStopMarkerSVG(7, "intermediate");
    expect(svg).toContain(">7<");
  });

  it("stop index is truncated to 3 characters for large numbers (4+ digits)", () => {
    const svg = createStopMarkerSVG(1234, "intermediate");
    // "1234" truncated to "123"
    expect(svg).toContain(">123<");
    expect(svg).not.toContain(">1234<");
  });

  it("'first' variant default size is 26px", () => {
    const svg = createStopMarkerSVG(1, "first");
    expect(svg).toMatch(/width="26"/);
    expect(svg).toMatch(/height="26"/);
  });

  it("'last' variant default size is 26px", () => {
    const svg = createStopMarkerSVG(1, "last");
    expect(svg).toMatch(/width="26"/);
  });

  it("'intermediate' variant default size is 24px", () => {
    const svg = createStopMarkerSVG(1, "intermediate");
    expect(svg).toMatch(/width="24"/);
  });

  it("'selected' variant default size is 28px", () => {
    const svg = createStopMarkerSVG(1, "selected");
    expect(svg).toMatch(/width="28"/);
  });

  it("custom size option is reflected in SVG width/height attributes", () => {
    const svg = createStopMarkerSVG(3, "intermediate", { size: 32 });
    expect(svg).toMatch(/width="32"/);
    expect(svg).toMatch(/height="32"/);
  });

  it("IBM Plex Mono is specified in font-family", () => {
    const svg = createStopMarkerSVG(5, "intermediate");
    expect(svg).toContain("IBM Plex Mono");
  });

  it("SVG root has role='img'", () => {
    const svg = createStopMarkerSVG(1, "intermediate");
    expect(svg).toContain('role="img"');
  });

  it("SVG root has aria-label='Stop N'", () => {
    const svg = createStopMarkerSVG(4, "intermediate");
    expect(svg).toContain('aria-label="Stop 4"');
  });

  it("no selection ring by default for 'intermediate' variant", () => {
    const svg = createStopMarkerSVG(1, "intermediate");
    // The ring is a separate circle element; without it, there should be
    // exactly 2 circle elements (halo + badge)
    const circles = (svg.match(/<circle/g) ?? []).length;
    expect(circles).toBe(2);
  });

  it("no selection ring by default for 'first' variant", () => {
    const svg = createStopMarkerSVG(1, "first");
    const circles = (svg.match(/<circle/g) ?? []).length;
    expect(circles).toBe(2);
  });

  it("selection ring IS present for 'selected' variant by default", () => {
    const svg = createStopMarkerSVG(1, "selected");
    // Ring adds a third circle
    const circles = (svg.match(/<circle/g) ?? []).length;
    expect(circles).toBe(3);
  });

  it("selection ring can be explicitly requested via showSelectionRing=true", () => {
    const svg = createStopMarkerSVG(2, "intermediate", { showSelectionRing: true });
    const circles = (svg.match(/<circle/g) ?? []).length;
    expect(circles).toBe(3);
  });

  it("selection ring can be suppressed for 'selected' variant via showSelectionRing=false", () => {
    const svg = createStopMarkerSVG(2, "selected", { showSelectionRing: false });
    const circles = (svg.match(/<circle/g) ?? []).length;
    expect(circles).toBe(2);
  });

  it("dark theme uses a different background color than light theme for 'first' variant", () => {
    const svgLight = createStopMarkerSVG(1, "first", { darkTheme: false });
    const svgDark  = createStopMarkerSVG(1, "first", { darkTheme: true });
    // They should contain different hsl values for the fill
    expect(svgLight).toContain(COLOR_FIRST);
    expect(svgDark).not.toContain(COLOR_FIRST); // dark uses different HSLA
  });

  it("output is a valid SVG string parseable by DOMParser", () => {
    const svg = createStopMarkerSVG(3, "last");
    expect(() => parseSVG(svg)).not.toThrow();
    const el = parseSVG(svg);
    expect(el.tagName.toLowerCase()).toBe("svg");
  });

  it("output is JSON-serializable (no circular refs or non-serializable values)", () => {
    const svg = createStopMarkerSVG(5, "first");
    expect(() => JSON.stringify(svg)).not.toThrow();
  });

  it("stop index 1 through 9 render single-digit labels correctly", () => {
    for (let i = 1; i <= 9; i++) {
      const svg = createStopMarkerSVG(i);
      expect(svg).toContain(`>${i}<`);
    }
  });

  it("stop index 10-99 render two-digit labels correctly", () => {
    const svg = createStopMarkerSVG(42);
    expect(svg).toContain(">42<");
  });

  it("stop index 100-999 render three-digit labels correctly", () => {
    const svg = createStopMarkerSVG(123);
    expect(svg).toContain(">123<");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// createStopMarkerElement
// ═══════════════════════════════════════════════════════════════════════════════

describe("createStopMarkerElement", () => {
  it("returns an HTMLElement (div)", () => {
    const el = createStopMarkerElement(1);
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.tagName.toLowerCase()).toBe("div");
  });

  it("element has role='img'", () => {
    const el = createStopMarkerElement(1);
    expect(el.getAttribute("role")).toBe("img");
  });

  it("element has aria-label='Stop N'", () => {
    const el = createStopMarkerElement(5);
    expect(el.getAttribute("aria-label")).toBe("Stop 5");
  });

  it("data-stop-index equals the provided stopIndex", () => {
    const el = createStopMarkerElement(12);
    expect(el.getAttribute("data-stop-index")).toBe("12");
  });

  it("data-variant equals the provided variant", () => {
    const el = createStopMarkerElement(1, "first");
    expect(el.getAttribute("data-variant")).toBe("first");
  });

  it("data-variant defaults to 'intermediate' when not provided", () => {
    const el = createStopMarkerElement(1);
    expect(el.getAttribute("data-variant")).toBe("intermediate");
  });

  it("badge child element is present (data-testid='stop-marker-factory-badge')", () => {
    const el = createStopMarkerElement(1);
    const badge = el.querySelector("[data-testid='stop-marker-factory-badge']");
    expect(badge).not.toBeNull();
  });

  it("badge displays the correct stop number text", () => {
    const el    = createStopMarkerElement(7, "intermediate");
    const badge = el.querySelector("[data-testid='stop-marker-factory-badge']")!;
    expect(badge.textContent).toContain("7");
  });

  it("badge text is truncated to 3 characters for large stop indices", () => {
    const el    = createStopMarkerElement(5678, "intermediate");
    const badge = el.querySelector("[data-testid='stop-marker-factory-badge']")!;
    expect(badge.textContent).toContain("567");
    expect(badge.textContent).not.toContain("5678");
  });

  it("badge background-color style contains the 'first' variant token color", () => {
    const el    = createStopMarkerElement(1, "first");
    const badge = el.querySelector("[data-testid='stop-marker-factory-badge']") as HTMLElement;
    expect(badge.style.background).toContain("hsl");
    // Should contain green-ish hsl for "first" variant
    // The exact string is from TOKEN_COLORS.light.first = "hsl(142, 54%, 48%)"
    expect(badge.style.background).toBe(COLOR_FIRST);
  });

  it("badge background contains 'last' variant token color (blue)", () => {
    const el    = createStopMarkerElement(1, "last");
    const badge = el.querySelector("[data-testid='stop-marker-factory-badge']") as HTMLElement;
    expect(badge.style.background).toBe(COLOR_LAST);
  });

  it("badge background contains 'intermediate' variant token color (gray)", () => {
    const el    = createStopMarkerElement(1, "intermediate");
    const badge = el.querySelector("[data-testid='stop-marker-factory-badge']") as HTMLElement;
    expect(badge.style.background).toBe(COLOR_INTERMEDIATE);
  });

  it("no selection ring by default for 'intermediate' variant", () => {
    const el   = createStopMarkerElement(1, "intermediate");
    const ring = el.querySelector("[data-testid='stop-marker-factory-selection-ring']");
    expect(ring).toBeNull();
  });

  it("no selection ring by default for 'first' variant", () => {
    const el   = createStopMarkerElement(1, "first");
    const ring = el.querySelector("[data-testid='stop-marker-factory-selection-ring']");
    expect(ring).toBeNull();
  });

  it("selection ring IS present for 'selected' variant by default", () => {
    const el   = createStopMarkerElement(1, "selected");
    const ring = el.querySelector("[data-testid='stop-marker-factory-selection-ring']");
    expect(ring).not.toBeNull();
  });

  it("selection ring can be explicitly requested via showSelectionRing=true", () => {
    const el   = createStopMarkerElement(2, "intermediate", { showSelectionRing: true });
    const ring = el.querySelector("[data-testid='stop-marker-factory-selection-ring']");
    expect(ring).not.toBeNull();
  });

  it("selection ring can be suppressed for 'selected' via showSelectionRing=false", () => {
    const el   = createStopMarkerElement(2, "selected", { showSelectionRing: false });
    const ring = el.querySelector("[data-testid='stop-marker-factory-selection-ring']");
    expect(ring).toBeNull();
  });

  it("badge size matches 'first' variant default (26px)", () => {
    const el    = createStopMarkerElement(1, "first");
    const badge = el.querySelector("[data-testid='stop-marker-factory-badge']") as HTMLElement;
    expect(badge.style.width).toBe(`${SIZE_FIRST}px`);
    expect(badge.style.height).toBe(`${SIZE_FIRST}px`);
  });

  it("badge size matches 'last' variant default (26px)", () => {
    const el    = createStopMarkerElement(1, "last");
    const badge = el.querySelector("[data-testid='stop-marker-factory-badge']") as HTMLElement;
    expect(badge.style.width).toBe(`${SIZE_LAST}px`);
  });

  it("badge size matches 'intermediate' variant default (24px)", () => {
    const el    = createStopMarkerElement(1, "intermediate");
    const badge = el.querySelector("[data-testid='stop-marker-factory-badge']") as HTMLElement;
    expect(badge.style.width).toBe(`${SIZE_INTERMEDIATE}px`);
  });

  it("badge size matches 'selected' variant default (28px)", () => {
    const el    = createStopMarkerElement(1, "selected");
    const badge = el.querySelector("[data-testid='stop-marker-factory-badge']") as HTMLElement;
    expect(badge.style.width).toBe(`${SIZE_SELECTED}px`);
  });

  it("custom size option is applied to badge width/height styles", () => {
    const el    = createStopMarkerElement(1, "intermediate", { size: 40 });
    const badge = el.querySelector("[data-testid='stop-marker-factory-badge']") as HTMLElement;
    expect(badge.style.width).toBe("40px");
    expect(badge.style.height).toBe("40px");
  });

  it("dark theme option changes badge background color for 'first' variant", () => {
    const elLight = createStopMarkerElement(1, "first", { darkTheme: false });
    const elDark  = createStopMarkerElement(1, "first", { darkTheme: true });
    const badgeLight = elLight.querySelector("[data-testid='stop-marker-factory-badge']") as HTMLElement;
    const badgeDark  = elDark.querySelector("[data-testid='stop-marker-factory-badge']")  as HTMLElement;
    expect(badgeLight.style.background).not.toBe(badgeDark.style.background);
  });

  it("IBM Plex Mono font-family is set on the badge element", () => {
    const el    = createStopMarkerElement(3, "intermediate");
    const badge = el.querySelector("[data-testid='stop-marker-factory-badge']") as HTMLElement;
    expect(badge.style.fontFamily).toContain("IBM Plex Mono");
  });

  it("wrapper element uses position:relative for ring stacking", () => {
    const el = createStopMarkerElement(1);
    expect(el.style.position).toBe("relative");
  });

  it("wrapper uses inline-flex display for centering", () => {
    const el = createStopMarkerElement(1);
    expect(el.style.display).toBe("inline-flex");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getStopMarkerImageId
// ═══════════════════════════════════════════════════════════════════════════════

describe("getStopMarkerImageId", () => {
  it("returns 'stop-marker-<N>-<variant>' format", () => {
    expect(getStopMarkerImageId(3, "first")).toBe("stop-marker-3-first");
    expect(getStopMarkerImageId(7, "last")).toBe("stop-marker-7-last");
    expect(getStopMarkerImageId(1, "intermediate")).toBe("stop-marker-1-intermediate");
    expect(getStopMarkerImageId(2, "selected")).toBe("stop-marker-2-selected");
  });

  it("uses 'intermediate' as the default variant", () => {
    expect(getStopMarkerImageId(5)).toBe("stop-marker-5-intermediate");
  });

  it("different stop indices produce different IDs for the same variant", () => {
    const id1 = getStopMarkerImageId(1, "first");
    const id2 = getStopMarkerImageId(2, "first");
    expect(id1).not.toBe(id2);
  });

  it("different variants produce different IDs for the same stop index", () => {
    const idFirst        = getStopMarkerImageId(3, "first");
    const idLast         = getStopMarkerImageId(3, "last");
    const idIntermediate = getStopMarkerImageId(3, "intermediate");
    const idSelected     = getStopMarkerImageId(3, "selected");

    const ids = [idFirst, idLast, idIntermediate, idSelected];
    const unique = new Set(ids);
    expect(unique.size).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// addStopMarkerImage
// ═══════════════════════════════════════════════════════════════════════════════

describe("addStopMarkerImage", () => {
  let restoreImage: () => void;

  beforeEach(() => {
    restoreImage = installLoadingImageMock();
  });

  afterEach(() => {
    restoreImage();
  });

  it("calls map.addImage with the correct ID", async () => {
    const map = makeMockMap();
    const id  = await addStopMarkerImage(map, 3, "first");
    expect(id).toBe("stop-marker-3-first");
    expect(map.addImageCalls).toHaveLength(1);
    expect(map.addImageCalls[0].id).toBe("stop-marker-3-first");
  });

  it("calls map.addImage with an image-like object (not null)", async () => {
    const map = makeMockMap();
    await addStopMarkerImage(map, 1, "intermediate");
    expect(map.addImageCalls[0].image).not.toBeNull();
    expect(map.addImageCalls[0].image).toBeDefined();
  });

  it("uses devicePixelRatio=2 by default for the pixelRatio option", async () => {
    const map = makeMockMap();
    await addStopMarkerImage(map, 1, "intermediate");
    expect((map.addImageCalls[0].options as { pixelRatio?: number })?.pixelRatio).toBe(2);
  });

  it("uses a custom devicePixelRatio when provided", async () => {
    const map = makeMockMap();
    await addStopMarkerImage(map, 1, "intermediate", { devicePixelRatio: 3 });
    expect((map.addImageCalls[0].options as { pixelRatio?: number })?.pixelRatio).toBe(3);
  });

  it("returns the image ID on success", async () => {
    const map = makeMockMap();
    const id  = await addStopMarkerImage(map, 5, "last");
    expect(id).toBe("stop-marker-5-last");
  });

  it("is idempotent — returns the ID without calling addImage when image already exists", async () => {
    const existingId = "stop-marker-2-intermediate";
    const map        = makeMockMap([existingId]);
    const id         = await addStopMarkerImage(map, 2, "intermediate");
    expect(id).toBe(existingId);
    expect(map.addImageCalls).toHaveLength(0); // no addImage call
  });

  it("does not call addImage a second time for the same stop/variant", async () => {
    const map = makeMockMap();
    await addStopMarkerImage(map, 4, "first");
    await addStopMarkerImage(map, 4, "first"); // second call — image already in sprite
    expect(map.addImageCalls).toHaveLength(1);
  });

  it("rejects with an error when the image fails to load", async () => {
    restoreImage(); // restore before installing failing mock
    const restoreFailing = installFailingImageMock();

    const map = makeMockMap();
    await expect(addStopMarkerImage(map, 1, "first")).rejects.toThrow(
      /StopMarkerFactory/
    );

    restoreFailing();
    restoreImage = installLoadingImageMock(); // re-install for afterEach
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// preloadStopMarkerImages
// ═══════════════════════════════════════════════════════════════════════════════

describe("preloadStopMarkerImages", () => {
  let restoreImage: () => void;

  beforeEach(() => {
    restoreImage = installLoadingImageMock();
  });

  afterEach(() => {
    restoreImage();
  });

  const ALL_VARIANTS: StopMarkerVariant[] = ["first", "last", "intermediate", "selected"];

  it("registers all 4 variants for each stop index by default", async () => {
    const map = makeMockMap();
    await preloadStopMarkerImages(map, 3);
    // 3 stop indices × 4 variants = 12 images
    expect(map.addImageCalls).toHaveLength(3 * 4);
  });

  it("returns an array of image IDs with length = maxStopIndex × variants.length", async () => {
    const map = makeMockMap();
    const ids = await preloadStopMarkerImages(map, 5);
    expect(ids).toHaveLength(5 * 4);
  });

  it("accepts a custom variants subset", async () => {
    const map  = makeMockMap();
    const ids  = await preloadStopMarkerImages(map, 4, ["first", "last"]);
    // 4 stop indices × 2 variants = 8 images
    expect(ids).toHaveLength(4 * 2);
    expect(map.addImageCalls).toHaveLength(4 * 2);
  });

  it("all returned IDs follow the 'stop-marker-<N>-<variant>' format", async () => {
    const map = makeMockMap();
    const ids = await preloadStopMarkerImages(map, 2);
    for (const id of ids) {
      expect(id).toMatch(/^stop-marker-\d+-(?:first|last|intermediate|selected)$/);
    }
  });

  it("is idempotent — pre-existing images are skipped without addImage calls", async () => {
    // Pre-seed the map with all stop-1 images
    const preExisting = ALL_VARIANTS.map((v) => `stop-marker-1-${v}`);
    const map         = makeMockMap(preExisting);

    await preloadStopMarkerImages(map, 1); // should skip all 4 (already loaded)
    expect(map.addImageCalls).toHaveLength(0);
  });

  it("registers stop indices 1 through maxStopIndex (inclusive)", async () => {
    const map = makeMockMap();
    await preloadStopMarkerImages(map, 3, ["intermediate"]);
    const registeredIds = map.addImageCalls.map((c) => c.id);
    expect(registeredIds).toContain("stop-marker-1-intermediate");
    expect(registeredIds).toContain("stop-marker-2-intermediate");
    expect(registeredIds).toContain("stop-marker-3-intermediate");
    expect(registeredIds).not.toContain("stop-marker-4-intermediate");
  });

  it("when maxStopIndex=0, returns an empty array", async () => {
    const map = makeMockMap();
    const ids = await preloadStopMarkerImages(map, 0);
    expect(ids).toHaveLength(0);
    expect(map.addImageCalls).toHaveLength(0);
  });
});
