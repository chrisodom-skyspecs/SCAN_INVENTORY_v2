// @vitest-environment jsdom

/**
 * Unit tests: photo annotation telemetry in ScanDamageReportClient.
 *
 * Verifies that SCAN_ACTION_ANNOTATION_ADDED and SCAN_ACTION_ANNOTATION_REMOVED
 * telemetry events are emitted correctly for every individual annotation pin
 * placement and removal action (spec §23).
 *
 * Per-event fields verified for SCAN_ACTION_ANNOTATION_ADDED:
 *   • eventCategory  = "user_action"
 *   • eventName      = SCAN_ACTION_ANNOTATION_ADDED
 *   • app            = "scan"
 *   • caseId         — the case the damage report belongs to
 *   • annotationType = "pin"
 *   • photoId        — client-generated temp ID (non-empty string)
 *   • reportId       = null  (report not created yet during annotation)
 *   • annotationLabel — text label of the placed pin
 *   • annotationIndex — 0-based index of the new pin in the list
 *   • userId          — from useCurrentUser
 *
 * Per-event fields verified for SCAN_ACTION_ANNOTATION_REMOVED:
 *   • eventCategory  = "user_action"
 *   • eventName      = SCAN_ACTION_ANNOTATION_REMOVED
 *   • app            = "scan"
 *   • caseId         — the case the damage report belongs to
 *   • annotationType = "pin"
 *   • photoId        — same client-generated temp ID as the add events
 *   • reportId       = null
 *   • annotationLabel — text label of the removed pin
 *   • annotationIndex — 0-based index of the pin before removal
 *   • userId          — from useCurrentUser
 *
 * Annotation placement mechanics
 * ────────────────────────────────
 * Placing a pin is a two-step user flow:
 *   1. Type a label and click "+ Pin" → pendingAnnotation is set.
 *   2. Click (pointer-down) on the photo preview → pin is placed.
 *
 * Because jsdom does not implement PointerEvent / getBoundingClientRect
 * properly, annotation placement is tested by calling the component's
 * internal `onTap` callback (passed to PhotoPreview) indirectly through
 * keyboard interaction (Enter on the focused photo preview element), which
 * calls `onTap(0.5, 0.5)`.
 *
 * Strategy
 * ────────
 * • `trackEvent` is mocked at module level so we can assert on emitted
 *   events without any real transport or Convex backend.
 * • `convex/react` (useQuery, useMutation) are mocked to return a controlled
 *   case + manifest state so the component renders immediately.
 * • `generateUUID` is mocked to return deterministic IDs so tests can assert
 *   on `photoId` values without randomness.
 * • A custom `fetch` mock satisfies the Convex storage upload step.
 *
 * Covered scenarios
 * ─────────────────
 *  1. SCAN_ACTION_ANNOTATION_ADDED emitted when first pin is placed
 *  2. eventCategory = "user_action" for annotation added event
 *  3. app = "scan" for annotation added event
 *  4. annotationType = "pin" for annotation added event
 *  5. photoId is a non-empty string (deterministic UUID in tests)
 *  6. reportId = null for annotation added event
 *  7. annotationLabel matches the label entered by the technician
 *  8. annotationIndex = 0 for the first pin placed
 *  9. userId from useCurrentUser is included in annotation added event
 * 10. annotationIndex increments for each subsequent pin placed
 * 11. SCAN_ACTION_ANNOTATION_REMOVED emitted when a pin is removed
 * 12. annotationLabel matches the removed pin's label
 * 13. annotationIndex matches the removed pin's original index
 * 14. reportId = null for annotation removed event
 * 15. photoId is stable within the same photo session
 * 16. photoId changes when a new photo is selected (retake)
 * 17. No annotation telemetry emitted when no pending annotation is active
 */

import React from "react";
import {
  render,
  fireEvent,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelemetryEventName } from "@/types/telemetry.types";

// ─── Deterministic UUID mock ──────────────────────────────────────────────────

let uuidCounter = 0;

vi.mock("@/lib/telemetry.lib", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  telemetry: {
    track: vi.fn(),
    identify: vi.fn(),
    flush: vi.fn(),
  },
  generateUUID: () => `test-uuid-${++uuidCounter}`,
}));

const mockTrackEvent = vi.fn();

// ─── Mock convex/react ────────────────────────────────────────────────────────

vi.mock("convex/react", () => ({
  useQuery:    vi.fn(),
  useMutation: vi.fn(),
}));

// ─── Mock the Convex generated API ───────────────────────────────────────────

vi.mock("../../../../../../convex/_generated/api", () => ({
  api: {
    cases: {
      getCaseById: "cases:getCaseById",
    },
    checklists: {
      getChecklistByCase: "checklists:getChecklistByCase",
    },
    damageReports: {
      generateDamagePhotoUploadUrl: "damageReports:generateDamagePhotoUploadUrl",
      submitDamagePhoto:            "damageReports:submitDamagePhoto",
    },
  },
}));

// ─── Import SUT and mocked modules (after vi.mock hoisting) ──────────────────

import { useQuery, useMutation } from "convex/react";
import { ScanDamageReportClient } from "../ScanDamageReportClient";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_ID          = "case_annotation_telemetry_test";
const DAMAGE_REPORT_ID = "damage_report_ann_001";
const EVENT_ID         = "event_ann_001";
const PHOTO_SIZE_BYTES = 204_800;

const MOCK_CASE = {
  _id:           CASE_ID,
  _creationTime: 1_700_000_000_000,
  label:         "CASE-ANN-001",
  status:        "in_field" as const,
};

const MOCK_MANIFEST_ITEMS = [
  {
    _id:            "manifest_item_ann_001",
    _creationTime:  1_700_000_000_000,
    caseId:         CASE_ID,
    templateItemId: "template-item-battery",
    name:           "Battery Pack",
    status:         "unchecked" as const,
  },
];

// ─── Mock mutation factories ───────────────────────────────────────────────────

function makeGenerateUrlMock() {
  return vi.fn().mockResolvedValue("https://storage.convex.cloud/upload/test");
}

function makeSubmitPhotoMock() {
  return vi.fn().mockResolvedValue({
    damageReportId: DAMAGE_REPORT_ID,
    caseId:         CASE_ID,
    manifestItemId: undefined,
    eventId:        EVENT_ID,
  });
}

function makeSuccessfulFetch() {
  return vi.fn().mockResolvedValue({
    ok:   true,
    json: () => Promise.resolve({ storageId: "storage-id-ann-001" }),
  });
}

// ─── Test setup ───────────────────────────────────────────────────────────────

function setupAndRender() {
  vi.stubGlobal("fetch", makeSuccessfulFetch());

  (useQuery as ReturnType<typeof vi.fn>).mockImplementation(
    (queryFn: unknown) => {
      if (queryFn === "cases:getCaseById")         return MOCK_CASE;
      if (queryFn === "checklists:getChecklistByCase") return MOCK_MANIFEST_ITEMS;
      return undefined;
    }
  );

  (useMutation as ReturnType<typeof vi.fn>).mockImplementation(
    (mutationFn: unknown) => {
      if (mutationFn === "damageReports:generateDamagePhotoUploadUrl")
        return makeGenerateUrlMock();
      if (mutationFn === "damageReports:submitDamagePhoto")
        return makeSubmitPhotoMock();
      return vi.fn();
    }
  );

  render(
    <ScanDamageReportClient
      caseId={CASE_ID}
      templateItemId={null}
    />
  );
}

/**
 * Simulate selecting a photo by firing a change event on the hidden file input.
 * Returns the File object so callers can assert on its size.
 */
function simulatePhotoCapture(sizeBytes: number = PHOTO_SIZE_BYTES): File {
  const photoFile = new File(
    [new ArrayBuffer(sizeBytes)],
    "damage-ann-photo.jpg",
    { type: "image/jpeg" }
  );

  const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!fileInput) throw new Error("File input not found");

  Object.defineProperty(fileInput, "files", {
    value:        [photoFile],
    writable:     false,
    configurable: true,
  });
  fireEvent.change(fileInput);

  return photoFile;
}

/**
 * Simulate the two-step annotation placement flow:
 *   1. Type a label into the annotation input and click the "+ Pin" button.
 *   2. Press Enter on the photo preview (calls onTap(0.5, 0.5) internally).
 *
 * Note: The "+ Pin" button has aria-label "Add annotation pin — then tap
 * the photo to place it" which overrides the text content for accessibility.
 */
function placeAnnotationPin(label: string): void {
  // Step 1: type the label
  const labelInput = screen.getByPlaceholderText("Label (e.g. crack, dent, burn)…");
  fireEvent.change(labelInput, { target: { value: label } });

  // Click the "+ Pin" button (accessible name from aria-label)
  const pinBtn = screen.getByRole("button", {
    name: "Add annotation pin — then tap the photo to place it",
  });
  fireEvent.click(pinBtn);

  // Step 2: activate placement via keyboard (Enter on photo preview).
  // PhotoPreview renders a div with role="button" when pendingAnnotation is set.
  const photoPreview = screen.getByRole("button", {
    name: `Tap to place annotation "${label}"`,
  });
  fireEvent.keyDown(photoPreview, { key: "Enter" });
}

/**
 * Click the remove button for the annotation at the given 1-based display index.
 */
function removeAnnotationPin(label: string): void {
  const removeBtn = screen.getByRole("button", {
    name: `Remove annotation "${label}"`,
  });
  fireEvent.click(removeBtn);
}

/** Filter mockTrackEvent calls to only SCAN_ACTION_ANNOTATION_ADDED events. */
function getAnnotationAddedCalls(): Record<string, unknown>[] {
  return mockTrackEvent.mock.calls
    .map((args: unknown[]) => args[0] as Record<string, unknown>)
    .filter((e) => e.eventName === TelemetryEventName.SCAN_ACTION_ANNOTATION_ADDED);
}

/** Filter mockTrackEvent calls to only SCAN_ACTION_ANNOTATION_REMOVED events. */
function getAnnotationRemovedCalls(): Record<string, unknown>[] {
  return mockTrackEvent.mock.calls
    .map((args: unknown[]) => args[0] as Record<string, unknown>)
    .filter((e) => e.eventName === TelemetryEventName.SCAN_ACTION_ANNOTATION_REMOVED);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ScanDamageReportClient — annotation telemetry (spec §23)", () => {
  beforeEach(() => {
    uuidCounter = 0;
    mockTrackEvent.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  // ─── SCAN_ACTION_ANNOTATION_ADDED emission ────────────────────────────────

  describe("SCAN_ACTION_ANNOTATION_ADDED event emission", () => {
    it("emits SCAN_ACTION_ANNOTATION_ADDED when a pin is placed on the photo", () => {
      setupAndRender();
      simulatePhotoCapture();
      placeAnnotationPin("crack");

      expect(getAnnotationAddedCalls()).toHaveLength(1);
      expect(getAnnotationAddedCalls()[0].eventName).toBe(
        TelemetryEventName.SCAN_ACTION_ANNOTATION_ADDED
      );
    });

    it("sets eventCategory = 'user_action'", () => {
      setupAndRender();
      simulatePhotoCapture();
      placeAnnotationPin("dent");

      expect(getAnnotationAddedCalls()[0].eventCategory).toBe("user_action");
    });

    it("sets app = 'scan'", () => {
      setupAndRender();
      simulatePhotoCapture();
      placeAnnotationPin("burn");

      expect(getAnnotationAddedCalls()[0].app).toBe("scan");
    });

    it("sets annotationType = 'pin'", () => {
      setupAndRender();
      simulatePhotoCapture();
      placeAnnotationPin("scratch");

      expect(getAnnotationAddedCalls()[0].annotationType).toBe("pin");
    });

    it("includes the caseId prop", () => {
      setupAndRender();
      simulatePhotoCapture();
      placeAnnotationPin("scuff");

      expect(getAnnotationAddedCalls()[0].caseId).toBe(CASE_ID);
    });

    it("photoId is a non-empty string (client-generated temp ID)", () => {
      setupAndRender();
      simulatePhotoCapture();
      placeAnnotationPin("tear");

      const photoId = getAnnotationAddedCalls()[0].photoId;
      expect(typeof photoId).toBe("string");
      expect((photoId as string).length).toBeGreaterThan(0);
    });

    it("sets reportId = null (report does not exist during annotation)", () => {
      setupAndRender();
      simulatePhotoCapture();
      placeAnnotationPin("impact");

      expect(getAnnotationAddedCalls()[0].reportId).toBeNull();
    });

    it("sets annotationLabel to the label text entered by the technician", () => {
      setupAndRender();
      simulatePhotoCapture();
      placeAnnotationPin("hairline crack");

      expect(getAnnotationAddedCalls()[0].annotationLabel).toBe("hairline crack");
    });

    it("sets annotationIndex = 0 for the first pin placed", () => {
      setupAndRender();
      simulatePhotoCapture();
      placeAnnotationPin("first pin");

      expect(getAnnotationAddedCalls()[0].annotationIndex).toBe(0);
    });

    it("sets userId from useCurrentUser ('scan-user' placeholder)", () => {
      setupAndRender();
      simulatePhotoCapture();
      placeAnnotationPin("corrosion");

      expect(getAnnotationAddedCalls()[0].userId).toBe("scan-user");
    });

    it("increments annotationIndex for each subsequent pin placed", () => {
      setupAndRender();
      simulatePhotoCapture();

      placeAnnotationPin("pin-one");
      placeAnnotationPin("pin-two");
      placeAnnotationPin("pin-three");

      const calls = getAnnotationAddedCalls();
      expect(calls).toHaveLength(3);
      expect(calls[0].annotationIndex).toBe(0);
      expect(calls[1].annotationIndex).toBe(1);
      expect(calls[2].annotationIndex).toBe(2);
    });

    it("emits exactly one SCAN_ACTION_ANNOTATION_ADDED per pin placement", () => {
      setupAndRender();
      simulatePhotoCapture();
      placeAnnotationPin("one");
      placeAnnotationPin("two");

      expect(getAnnotationAddedCalls()).toHaveLength(2);
    });
  });

  // ─── SCAN_ACTION_ANNOTATION_REMOVED emission ──────────────────────────────

  describe("SCAN_ACTION_ANNOTATION_REMOVED event emission", () => {
    it("emits SCAN_ACTION_ANNOTATION_REMOVED when a pin is removed", () => {
      setupAndRender();
      simulatePhotoCapture();
      placeAnnotationPin("crack");
      removeAnnotationPin("crack");

      expect(getAnnotationRemovedCalls()).toHaveLength(1);
      expect(getAnnotationRemovedCalls()[0].eventName).toBe(
        TelemetryEventName.SCAN_ACTION_ANNOTATION_REMOVED
      );
    });

    it("sets eventCategory = 'user_action'", () => {
      setupAndRender();
      simulatePhotoCapture();
      placeAnnotationPin("dent");
      removeAnnotationPin("dent");

      expect(getAnnotationRemovedCalls()[0].eventCategory).toBe("user_action");
    });

    it("sets app = 'scan'", () => {
      setupAndRender();
      simulatePhotoCapture();
      placeAnnotationPin("burn");
      removeAnnotationPin("burn");

      expect(getAnnotationRemovedCalls()[0].app).toBe("scan");
    });

    it("sets annotationType = 'pin'", () => {
      setupAndRender();
      simulatePhotoCapture();
      placeAnnotationPin("nick");
      removeAnnotationPin("nick");

      expect(getAnnotationRemovedCalls()[0].annotationType).toBe("pin");
    });

    it("sets reportId = null", () => {
      setupAndRender();
      simulatePhotoCapture();
      placeAnnotationPin("abrasion");
      removeAnnotationPin("abrasion");

      expect(getAnnotationRemovedCalls()[0].reportId).toBeNull();
    });

    it("sets annotationLabel to the removed pin's label", () => {
      setupAndRender();
      simulatePhotoCapture();
      placeAnnotationPin("specific-label");
      removeAnnotationPin("specific-label");

      expect(getAnnotationRemovedCalls()[0].annotationLabel).toBe("specific-label");
    });

    it("sets annotationIndex = 0 when removing the only pin", () => {
      setupAndRender();
      simulatePhotoCapture();
      placeAnnotationPin("only-pin");
      removeAnnotationPin("only-pin");

      expect(getAnnotationRemovedCalls()[0].annotationIndex).toBe(0);
    });

    it("sets annotationIndex to the correct 0-based position before removal", () => {
      setupAndRender();
      simulatePhotoCapture();

      placeAnnotationPin("first");
      placeAnnotationPin("second");
      placeAnnotationPin("third");

      // Remove the second pin (index 1)
      removeAnnotationPin("second");

      expect(getAnnotationRemovedCalls()).toHaveLength(1);
      expect(getAnnotationRemovedCalls()[0].annotationIndex).toBe(1);
      expect(getAnnotationRemovedCalls()[0].annotationLabel).toBe("second");
    });

    it("sets userId from useCurrentUser", () => {
      setupAndRender();
      simulatePhotoCapture();
      placeAnnotationPin("remove-me");
      removeAnnotationPin("remove-me");

      expect(getAnnotationRemovedCalls()[0].userId).toBe("scan-user");
    });

    it("includes the caseId", () => {
      setupAndRender();
      simulatePhotoCapture();
      placeAnnotationPin("pin");
      removeAnnotationPin("pin");

      expect(getAnnotationRemovedCalls()[0].caseId).toBe(CASE_ID);
    });
  });

  // ─── photoId stability within a session ──────────────────────────────────

  describe("photoId stability within a photo session", () => {
    it("photoId is consistent across all annotation added events in the same session", () => {
      setupAndRender();
      simulatePhotoCapture();

      placeAnnotationPin("alpha");
      placeAnnotationPin("beta");

      const calls = getAnnotationAddedCalls();
      expect(calls).toHaveLength(2);
      expect(calls[0].photoId).toBe(calls[1].photoId);
    });

    it("photoId is consistent between ADDED and REMOVED events in the same session", () => {
      setupAndRender();
      simulatePhotoCapture();

      placeAnnotationPin("gamma");
      removeAnnotationPin("gamma");

      const addedCalls   = getAnnotationAddedCalls();
      const removedCalls = getAnnotationRemovedCalls();

      expect(addedCalls).toHaveLength(1);
      expect(removedCalls).toHaveLength(1);
      expect(addedCalls[0].photoId).toBe(removedCalls[0].photoId);
    });
  });

  // ─── photoId changes on retake ────────────────────────────────────────────

  describe("photoId changes when photo is retaken", () => {
    it("photoId changes after retaking the photo", () => {
      setupAndRender();

      // Select first photo and place a pin
      simulatePhotoCapture();
      placeAnnotationPin("before-retake");

      const photoIdBefore = getAnnotationAddedCalls()[0].photoId as string;

      // Retake: click the Retake Photo button
      const retakeBtn = screen.getByRole("button", {
        name: "Retake or replace the damage photo",
      });
      fireEvent.click(retakeBtn);

      // Re-clear and select a new photo
      mockTrackEvent.mockClear();
      simulatePhotoCapture();
      placeAnnotationPin("after-retake");

      const photoIdAfter = getAnnotationAddedCalls()[0].photoId as string;

      // The photo session IDs must be different
      expect(photoIdAfter).not.toBe(photoIdBefore);
    });
  });

  // ─── No annotation telemetry without photo selection ─────────────────────

  describe("annotation telemetry requires a photo", () => {
    it("does NOT emit SCAN_ACTION_ANNOTATION_ADDED without a photo selected (no annotation UI shown)", () => {
      setupAndRender();
      // Intentionally skip simulatePhotoCapture()
      // The annotation input is not rendered before a photo is selected.
      expect(getAnnotationAddedCalls()).toHaveLength(0);
    });
  });

  // ─── Full event shape assertion ───────────────────────────────────────────

  describe("complete annotation added event shape", () => {
    it("emits a fully-formed SCAN_ACTION_ANNOTATION_ADDED event", () => {
      setupAndRender();
      simulatePhotoCapture();
      placeAnnotationPin("complete-check-label");

      expect(getAnnotationAddedCalls()).toHaveLength(1);

      const event = getAnnotationAddedCalls()[0];
      expect(event).toMatchObject({
        eventCategory:   "user_action",
        eventName:       TelemetryEventName.SCAN_ACTION_ANNOTATION_ADDED,
        app:             "scan",
        caseId:          CASE_ID,
        annotationType:  "pin",
        reportId:        null,
        annotationLabel: "complete-check-label",
        annotationIndex: 0,
        userId:          "scan-user",
      });
      // photoId must be a non-empty string
      expect(typeof event.photoId).toBe("string");
      expect((event.photoId as string).length).toBeGreaterThan(0);
    });
  });

  describe("complete annotation removed event shape", () => {
    it("emits a fully-formed SCAN_ACTION_ANNOTATION_REMOVED event", () => {
      setupAndRender();
      simulatePhotoCapture();
      placeAnnotationPin("full-remove-label");
      removeAnnotationPin("full-remove-label");

      expect(getAnnotationRemovedCalls()).toHaveLength(1);

      const event = getAnnotationRemovedCalls()[0];
      expect(event).toMatchObject({
        eventCategory:   "user_action",
        eventName:       TelemetryEventName.SCAN_ACTION_ANNOTATION_REMOVED,
        app:             "scan",
        caseId:          CASE_ID,
        annotationType:  "pin",
        reportId:        null,
        annotationLabel: "full-remove-label",
        annotationIndex: 0,
        userId:          "scan-user",
      });
      expect(typeof event.photoId).toBe("string");
      expect((event.photoId as string).length).toBeGreaterThan(0);
    });
  });
});
