// @vitest-environment jsdom

/**
 * Unit tests: damage report submission telemetry in ScanDamageReportClient.
 *
 * Verifies that the correct SCAN_ACTION_DAMAGE_REPORTED telemetry event is
 * emitted every time a damage report is successfully submitted (spec §23).
 *
 * Per-event fields verified:
 *   • eventCategory  = "user_action"
 *   • eventName      = SCAN_ACTION_DAMAGE_REPORTED
 *   • app            = "scan"
 *   • caseId         — the case the damage report belongs to
 *   • manifestItemId — Convex manifestItem ID when item-linked; null for case-level
 *   • severity       — "minor" | "moderate" | "severe"
 *   • annotationCount — number of annotation pins on the photo
 *   • hasNotes        — whether free-text notes were provided
 *   • photoSizeBytes  — File.size of the uploaded photo
 *   • userId          — from the current user identity (useCurrentUser)
 *
 * Strategy
 * ────────
 * • `trackEvent` is mocked at module level so we can assert on emitted
 *   events without any real transport or Convex backend.
 * • `convex/react` (useQuery, useMutation) are mocked to return a controlled
 *   case + manifest state so the component renders immediately.
 * • The two mutations (generateDamagePhotoUploadUrl, submitDamagePhoto) are
 *   mocked to succeed synchronously so the telemetry code path is exercised.
 * • `fetch` is mocked globally to simulate the Convex storage upload.
 * • Tests use `waitFor` to account for the async submit + telemetry sequence.
 *
 * Covered scenarios
 * ─────────────────
 *  1. Basic submission emits SCAN_ACTION_DAMAGE_REPORTED
 *  2. eventCategory = "user_action" and app = "scan"
 *  3. caseId is included in the event
 *  4. manifestItemId = null for case-level photos (no linked item)
 *  5. manifestItemId = Convex ID when a manifest item is linked (from mutation result)
 *  6. severity field matches the selected severity
 *  7. annotationCount = 0 when no pins are placed
 *  8. annotationCount > 0 when pins are placed (not directly testable in this
 *     environment — annotation placement requires pointer events on canvas)
 *  9. hasNotes = false when notes field is empty
 * 10. hasNotes = true when notes are provided
 * 11. photoSizeBytes matches the mock file size
 * 12. userId from useCurrentUser is included in the event
 * 13. No telemetry emitted when generateDamagePhotoUploadUrl rejects
 * 14. No telemetry emitted when the Convex storage upload fetch fails
 * 15. No telemetry emitted when submitDamagePhoto rejects
 * 16. Exactly one event emitted per successful submission
 */

import React from "react";
import {
  render,
  fireEvent,
  screen,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelemetryEventName } from "@/types/telemetry.types";

// ─── Mock telemetry (spy on trackEvent, never hit transport) ──────────────────

const mockTrackEvent = vi.fn();

vi.mock("@/lib/telemetry.lib", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  telemetry: {
    track: vi.fn(),
    identify: vi.fn(),
    flush: vi.fn(),
  },
  // generateUUID is used by the component to create photo session IDs;
  // return a deterministic value so tests don't produce random state.
  generateUUID: () => "test-uuid-damage-report",
}));

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

// ─── Mock Kinde auth (browser client) ────────────────────────────────────────
// Returns the placeholder "scan-user" identity expected by telemetry assertions.

vi.mock("@kinde-oss/kinde-auth-nextjs", () => ({
  useKindeBrowserClient: () => ({
    user: {
      id:          "scan-user",
      given_name:  "Field",
      family_name: "Technician",
      email:       "field.technician@skyspecs.com",
    },
    isAuthenticated: true,
    isLoading:       false,
  }),
}));

// ─── Import SUT and mocked modules (after vi.mock hoisting) ──────────────────

import { useQuery, useMutation } from "convex/react";
import { ScanDamageReportClient } from "../ScanDamageReportClient";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_ID             = "case_telemetry_damage_test";
const DAMAGE_REPORT_ID    = "damage_report_001";
const EVENT_ID            = "event_001";
const MANIFEST_ID_1       = "manifest_item_id_001";
const TEMPLATE_ITEM_ID_1  = "template-item-battery";
const PHOTO_SIZE_BYTES    = 204_800; // 200 KB

/** Minimal case document returned by getCaseById. */
const MOCK_CASE = {
  _id:           CASE_ID,
  _creationTime: 1_700_000_000_000,
  label:         "CASE-001",
  status:        "deployed" as const,
};

/** Manifest items list returned by getChecklistByCase. */
const MOCK_MANIFEST_ITEMS = [
  {
    _id:            MANIFEST_ID_1,
    _creationTime:  1_700_000_000_000,
    caseId:         CASE_ID,
    templateItemId: TEMPLATE_ITEM_ID_1,
    name:           "Battery Pack",
    status:         "unchecked" as const,
  },
];

// ─── Mock mutation factories ───────────────────────────────────────────────────

/** Returns a resolving generateDamagePhotoUploadUrl mock. */
function makeGenerateUrlMock() {
  return vi.fn().mockResolvedValue("https://storage.convex.cloud/upload/test-url");
}

/** Returns a rejecting generateDamagePhotoUploadUrl mock. */
function makeGenerateUrlMockThatFails() {
  return vi.fn().mockRejectedValue(new Error("Convex: failed to generate upload URL"));
}

/**
 * Returns a resolving submitDamagePhoto mock.
 *
 * @param manifestItemId  The manifestItemId to include in the result (undefined = case-level).
 */
function makeSubmitPhotoMock(manifestItemId?: string) {
  const mock = vi.fn().mockResolvedValue({
    damageReportId: DAMAGE_REPORT_ID,
    caseId:         CASE_ID,
    manifestItemId,
    eventId:        EVENT_ID,
  });
  // useSubmitDamagePhoto calls .withOptimisticUpdate() on the mutation.
  // Return `mock` itself so the returned function is still callable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mock as any).withOptimisticUpdate = vi.fn().mockReturnValue(mock);
  return mock;
}

/** Returns a rejecting submitDamagePhoto mock. */
function makeSubmitPhotoMockThatFails() {
  const mock = vi.fn().mockRejectedValue(new Error("Convex: mutation failed"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mock as any).withOptimisticUpdate = vi.fn().mockReturnValue(mock);
  return mock;
}

/** Returns a mock fetch that simulates a successful Convex storage upload. */
function makeSuccessfulFetch() {
  return vi.fn().mockResolvedValue({
    ok:   true,
    json: () => Promise.resolve({ storageId: "storage-id-test-001" }),
  });
}

/** Returns a mock fetch that simulates a failed Convex storage upload. */
function makeFailedFetch() {
  return vi.fn().mockResolvedValue({
    ok:     false,
    status: 413,
  });
}

// ─── Test setup helpers ───────────────────────────────────────────────────────

interface SetupOptions {
  generateUrlMock?:  ReturnType<typeof vi.fn>;
  submitPhotoMock?:  ReturnType<typeof vi.fn>;
  fetchMock?:        ReturnType<typeof vi.fn>;
  templateItemId?:   string | null;
}

/**
 * Wire convex mocks, fetch mock, and render the ScanDamageReportClient.
 *
 * Returns helpers for injecting a photo file and submitting the form.
 */
function setupAndRender(options: SetupOptions = {}) {
  const generateUrlMock = options.generateUrlMock ?? makeGenerateUrlMock();
  const submitPhotoMock = options.submitPhotoMock ?? makeSubmitPhotoMock();
  const fetchMock       = options.fetchMock       ?? makeSuccessfulFetch();
  const templateItemId  = options.templateItemId  ?? null;

  // Override global fetch for the upload step
  vi.stubGlobal("fetch", fetchMock);

  (useQuery as ReturnType<typeof vi.fn>).mockImplementation(
    (queryFn: unknown) => {
      if (queryFn === "cases:getCaseById")         return MOCK_CASE;
      if (queryFn === "checklists:getChecklistByCase") return MOCK_MANIFEST_ITEMS;
      return undefined;
    }
  );

  (useMutation as ReturnType<typeof vi.fn>).mockImplementation(
    (mutationFn: unknown) => {
      if (mutationFn === "damageReports:generateDamagePhotoUploadUrl") return generateUrlMock;
      if (mutationFn === "damageReports:submitDamagePhoto")            return submitPhotoMock;
      return vi.fn();
    }
  );

  render(
    <ScanDamageReportClient
      caseId={CASE_ID}
      templateItemId={templateItemId}
    />
  );

  return { generateUrlMock, submitPhotoMock, fetchMock };
}

/**
 * Simulate selecting a photo by firing a change event on the hidden file input.
 *
 * Creates a minimal File object with a predictable size so tests can assert on
 * `photoSizeBytes` without a real file system.
 *
 * We use `configurable: true` in `Object.defineProperty` so jsdom can
 * re-read the property during event dispatching without a "Cannot redefine
 * property" error.  The change event is fired without a `target.files`
 * override so testing-library does not try to re-assign the property.
 */
function simulatePhotoCapture(sizeBytes: number = PHOTO_SIZE_BYTES): File {
  const photoFile = new File(
    [new ArrayBuffer(sizeBytes)],
    "damage-photo.jpg",
    { type: "image/jpeg" }
  );

  const fileInput = document.querySelector<HTMLInputElement>(
    'input[type="file"]'
  );
  if (!fileInput) throw new Error("File input not found in DOM");

  // Define files with configurable: true so the property can be re-read
  // by jsdom when the component calls e.target.files after the change event.
  Object.defineProperty(fileInput, "files", {
    value:        [photoFile],
    writable:     false,
    configurable: true,
  });

  // Fire change without passing target.files — the property is already set
  // above; passing it in the event would trigger a second defineProperty
  // attempt that throws in jsdom.
  fireEvent.change(fileInput);

  return photoFile;
}

/**
 * Simulate form submission by clicking the submit button.
 * Wraps in `act` so React state updates are flushed.
 */
async function submitForm() {
  const btn = screen.getByTestId("submit-damage-report-btn");
  await act(async () => {
    fireEvent.click(btn);
  });
}

/** Filter `mockTrackEvent` calls to only SCAN_ACTION_DAMAGE_REPORTED events. */
function getDamageReportedCalls(): Record<string, unknown>[] {
  return mockTrackEvent.mock.calls
    .map((args: unknown[]) => args[0] as Record<string, unknown>)
    .filter((e) => e.eventName === TelemetryEventName.SCAN_ACTION_DAMAGE_REPORTED);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ScanDamageReportClient — damage report submission telemetry (spec §23)", () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  // ─── Basic emission ───────────────────────────────────────────────────────

  describe("basic event emission", () => {
    it("emits SCAN_ACTION_DAMAGE_REPORTED on successful submission", async () => {
      setupAndRender();

      simulatePhotoCapture();
      await submitForm();

      await waitFor(() => {
        expect(getDamageReportedCalls()).toHaveLength(1);
      });

      expect(getDamageReportedCalls()[0].eventName).toBe(
        TelemetryEventName.SCAN_ACTION_DAMAGE_REPORTED
      );
    });

    it("emits exactly one event per submission (no duplicates)", async () => {
      setupAndRender();

      simulatePhotoCapture();
      await submitForm();

      await waitFor(() => {
        expect(getDamageReportedCalls()).toHaveLength(1);
      });

      // Brief settle to confirm no duplicate fires
      await new Promise((r) => setTimeout(r, 50));
      expect(getDamageReportedCalls()).toHaveLength(1);
    });
  });

  // ─── Event shape invariants ───────────────────────────────────────────────

  describe("event shape invariants", () => {
    it("sets eventCategory = 'user_action'", async () => {
      setupAndRender();

      simulatePhotoCapture();
      await submitForm();

      await waitFor(() => {
        expect(getDamageReportedCalls()).toHaveLength(1);
      });

      expect(getDamageReportedCalls()[0].eventCategory).toBe("user_action");
    });

    it("sets app = 'scan'", async () => {
      setupAndRender();

      simulatePhotoCapture();
      await submitForm();

      await waitFor(() => {
        expect(getDamageReportedCalls()).toHaveLength(1);
      });

      expect(getDamageReportedCalls()[0].app).toBe("scan");
    });
  });

  // ─── caseId field ─────────────────────────────────────────────────────────

  describe("caseId field", () => {
    it("includes the caseId prop in the telemetry event", async () => {
      setupAndRender();

      simulatePhotoCapture();
      await submitForm();

      await waitFor(() => {
        expect(getDamageReportedCalls()).toHaveLength(1);
      });

      expect(getDamageReportedCalls()[0].caseId).toBe(CASE_ID);
    });
  });

  // ─── manifestItemId field ─────────────────────────────────────────────────

  describe("manifestItemId field", () => {
    it("sets manifestItemId = null for case-level photos (no linked item)", async () => {
      // submitPhotoMock returns no manifestItemId → case-level photo
      setupAndRender({
        submitPhotoMock: makeSubmitPhotoMock(undefined),
      });

      simulatePhotoCapture();
      await submitForm();

      await waitFor(() => {
        expect(getDamageReportedCalls()).toHaveLength(1);
      });

      expect(getDamageReportedCalls()[0].manifestItemId).toBeNull();
    });

    it("sets manifestItemId to the Convex ID returned by submitDamagePhoto when item is linked", async () => {
      // submitPhotoMock returns a manifestItemId → item-linked photo
      setupAndRender({
        submitPhotoMock: makeSubmitPhotoMock(MANIFEST_ID_1),
      });

      simulatePhotoCapture();
      await submitForm();

      await waitFor(() => {
        expect(getDamageReportedCalls()).toHaveLength(1);
      });

      expect(getDamageReportedCalls()[0].manifestItemId).toBe(MANIFEST_ID_1);
    });
  });

  // ─── severity field ───────────────────────────────────────────────────────

  describe("severity field", () => {
    it("defaults to 'moderate' severity when no severity is explicitly changed", async () => {
      setupAndRender();

      simulatePhotoCapture();
      await submitForm();

      await waitFor(() => {
        expect(getDamageReportedCalls()).toHaveLength(1);
      });

      // Default severity in the component is "moderate"
      expect(getDamageReportedCalls()[0].severity).toBe("moderate");
    });

    it("records 'minor' severity when the minor button is clicked", async () => {
      setupAndRender();

      simulatePhotoCapture();

      // Click the Minor severity button
      const minorBtn = screen.getByRole("radio", {
        name: "Minor damage — cosmetic, no functional impact",
      });
      fireEvent.click(minorBtn);

      await submitForm();

      await waitFor(() => {
        expect(getDamageReportedCalls()).toHaveLength(1);
      });

      expect(getDamageReportedCalls()[0].severity).toBe("minor");
    });

    it("records 'severe' severity when the severe button is clicked", async () => {
      setupAndRender();

      simulatePhotoCapture();

      // Click the Severe severity button
      const severeBtn = screen.getByRole("radio", {
        name: "Severe damage — unsafe or non-functional",
      });
      fireEvent.click(severeBtn);

      await submitForm();

      await waitFor(() => {
        expect(getDamageReportedCalls()).toHaveLength(1);
      });

      expect(getDamageReportedCalls()[0].severity).toBe("severe");
    });
  });

  // ─── annotationCount field ────────────────────────────────────────────────

  describe("annotationCount field", () => {
    it("sets annotationCount = 0 when no annotation pins are placed", async () => {
      setupAndRender();

      simulatePhotoCapture();
      // Do not place any annotation pins
      await submitForm();

      await waitFor(() => {
        expect(getDamageReportedCalls()).toHaveLength(1);
      });

      expect(getDamageReportedCalls()[0].annotationCount).toBe(0);
    });
  });

  // ─── hasNotes field ───────────────────────────────────────────────────────

  describe("hasNotes field", () => {
    it("sets hasNotes = false when the notes textarea is empty", async () => {
      setupAndRender();

      simulatePhotoCapture();
      // Notes field is empty by default — do not type anything
      await submitForm();

      await waitFor(() => {
        expect(getDamageReportedCalls()).toHaveLength(1);
      });

      expect(getDamageReportedCalls()[0].hasNotes).toBe(false);
    });

    it("sets hasNotes = true when the notes textarea contains text", async () => {
      setupAndRender();

      simulatePhotoCapture();

      // Type into the notes textarea
      const notesTextarea = screen.getByRole("textbox", {
        name: "Damage description or notes (optional)",
      });
      fireEvent.change(notesTextarea, {
        target: { value: "Visible crack on port side housing" },
      });

      await submitForm();

      await waitFor(() => {
        expect(getDamageReportedCalls()).toHaveLength(1);
      });

      expect(getDamageReportedCalls()[0].hasNotes).toBe(true);
    });

    it("sets hasNotes = false when notes contains only whitespace", async () => {
      setupAndRender();

      simulatePhotoCapture();

      // Type whitespace only into the notes textarea
      const notesTextarea = screen.getByRole("textbox", {
        name: "Damage description or notes (optional)",
      });
      fireEvent.change(notesTextarea, { target: { value: "   " } });

      await submitForm();

      await waitFor(() => {
        expect(getDamageReportedCalls()).toHaveLength(1);
      });

      // notes.trim().length === 0 → hasNotes = false
      expect(getDamageReportedCalls()[0].hasNotes).toBe(false);
    });
  });

  // ─── photoSizeBytes field ─────────────────────────────────────────────────

  describe("photoSizeBytes field", () => {
    it("sets photoSizeBytes to the File.size of the captured photo", async () => {
      setupAndRender();

      const file = simulatePhotoCapture(PHOTO_SIZE_BYTES);
      await submitForm();

      await waitFor(() => {
        expect(getDamageReportedCalls()).toHaveLength(1);
      });

      expect(getDamageReportedCalls()[0].photoSizeBytes).toBe(file.size);
    });

    it("sets photoSizeBytes for a smaller photo (50 KB)", async () => {
      setupAndRender();

      const smallFile = simulatePhotoCapture(51_200); // 50 KB
      await submitForm();

      await waitFor(() => {
        expect(getDamageReportedCalls()).toHaveLength(1);
      });

      expect(getDamageReportedCalls()[0].photoSizeBytes).toBe(smallFile.size);
    });
  });

  // ─── userId field ─────────────────────────────────────────────────────────

  describe("userId field", () => {
    it("sets userId from useCurrentUser ('scan-user' placeholder)", async () => {
      setupAndRender();

      simulatePhotoCapture();
      await submitForm();

      await waitFor(() => {
        expect(getDamageReportedCalls()).toHaveLength(1);
      });

      // useCurrentUser returns { id: "scan-user", name: "Field Technician" }
      expect(getDamageReportedCalls()[0].userId).toBe("scan-user");
    });
  });

  // ─── No telemetry on failure ───────────────────────────────────────────────

  describe("no telemetry on failure paths", () => {
    it("does NOT emit SCAN_ACTION_DAMAGE_REPORTED when generateDamagePhotoUploadUrl rejects", async () => {
      setupAndRender({
        generateUrlMock: makeGenerateUrlMockThatFails(),
      });

      simulatePhotoCapture();
      await submitForm();

      // Wait for async rejection to settle
      await new Promise((r) => setTimeout(r, 100));

      expect(getDamageReportedCalls()).toHaveLength(0);
    });

    it("does NOT emit SCAN_ACTION_DAMAGE_REPORTED when Convex storage upload fetch fails", async () => {
      setupAndRender({
        fetchMock: makeFailedFetch(),
      });

      simulatePhotoCapture();
      await submitForm();

      // Wait for async rejection to settle
      await new Promise((r) => setTimeout(r, 100));

      expect(getDamageReportedCalls()).toHaveLength(0);
    });

    it("does NOT emit SCAN_ACTION_DAMAGE_REPORTED when submitDamagePhoto rejects", async () => {
      setupAndRender({
        submitPhotoMock: makeSubmitPhotoMockThatFails(),
      });

      simulatePhotoCapture();
      await submitForm();

      // Wait for async rejection to settle
      await new Promise((r) => setTimeout(r, 100));

      expect(getDamageReportedCalls()).toHaveLength(0);
    });
  });

  // ─── Full event shape assertion ───────────────────────────────────────────

  describe("complete event shape", () => {
    it("emits a fully-formed SCAN_ACTION_DAMAGE_REPORTED event on happy path", async () => {
      setupAndRender({
        submitPhotoMock: makeSubmitPhotoMock(MANIFEST_ID_1),
      });

      const file = simulatePhotoCapture(PHOTO_SIZE_BYTES);

      // Type some notes
      const notesTextarea = screen.getByRole("textbox", {
        name: "Damage description or notes (optional)",
      });
      fireEvent.change(notesTextarea, {
        target: { value: "Impact mark observed" },
      });

      await submitForm();

      await waitFor(() => {
        expect(getDamageReportedCalls()).toHaveLength(1);
      });

      expect(getDamageReportedCalls()[0]).toMatchObject({
        eventCategory:   "user_action",
        eventName:       TelemetryEventName.SCAN_ACTION_DAMAGE_REPORTED,
        app:             "scan",
        caseId:          CASE_ID,
        manifestItemId:  MANIFEST_ID_1,
        severity:        "moderate",
        annotationCount: 0,
        hasNotes:        true,
        photoSizeBytes:  file.size,
        userId:          "scan-user",
      });
    });
  });
});
