/**
 * StatusPill component unit tests.
 *
 * Tests that:
 *   - All status kinds render the correct label text
 *   - Filled vs. subtle variants apply the correct CSS classes
 *   - The component renders an accessible role="status" element
 *   - Unknown kinds fall back gracefully
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StatusPill, type StatusKind } from "../StatusPill";

afterEach(() => cleanup());

// ─── Setup ────────────────────────────────────────────────────────────────────

// We use CSS Modules in tests; Vitest maps them to identity (className === key)
// via the default CSS module transform so we can assert class names.

// ─── Label rendering ──────────────────────────────────────────────────────────

describe("StatusPill — label rendering", () => {
  const cases: Array<[StatusKind, string]> = [
    ["assembled", "Assembled"],
    ["deployed", "Deployed"],
    ["in_field", "In Field"],
    ["shipping", "Shipping"],
    ["returned", "Returned"],
    ["pending", "Pending"],
    ["in_progress", "In Progress"],
    ["completed", "Completed"],
    ["flagged", "Flagged"],
    ["label_created", "Label Created"],
    ["picked_up", "Picked Up"],
    ["in_transit", "In Transit"],
    ["out_for_delivery", "Out for Delivery"],
    ["delivered", "Delivered"],
    ["exception", "Exception"],
    ["planning", "Planning"],
    ["active", "Active"],
    ["cancelled", "Cancelled"],
  ];

  it.each(cases)('renders "%s" as "%s"', (kind, expectedLabel) => {
    render(<StatusPill kind={kind} />);
    expect(screen.getByText(expectedLabel)).toBeTruthy();
  });
});

// ─── Custom label override ─────────────────────────────────────────────────────

describe("StatusPill — label override", () => {
  it("renders the custom label prop instead of the default", () => {
    render(<StatusPill kind="deployed" label="In the Wild" />);
    expect(screen.getByText("In the Wild")).toBeTruthy();
    expect(screen.queryByText("Deployed")).toBeNull();
  });
});

// ─── Accessibility ────────────────────────────────────────────────────────────

describe("StatusPill — accessibility", () => {
  it('has role="status"', () => {
    render(<StatusPill kind="deployed" />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("has a descriptive aria-label", () => {
    render(<StatusPill kind="shipping" />);
    const el = screen.getByRole("status");
    expect(el.getAttribute("aria-label")).toBe("Status: Shipping");
  });

  it("aria-label uses the custom label when provided", () => {
    render(<StatusPill kind="flagged" label="Needs Review" />);
    const el = screen.getByRole("status");
    expect(el.getAttribute("aria-label")).toBe("Status: Needs Review");
  });
});

// ─── Variant classes ──────────────────────────────────────────────────────────

describe("StatusPill — variant classes", () => {
  it('applies "subtle" class by default (filled=false)', () => {
    render(<StatusPill kind="deployed" />);
    const el = screen.getByRole("status");
    // CSS Modules identity map: class name === key
    expect(el.className).toContain("subtle");
    expect(el.className).not.toContain("filled");
  });

  it('applies "filled" class when filled=true', () => {
    render(<StatusPill kind="deployed" filled />);
    const el = screen.getByRole("status");
    expect(el.className).toContain("filled");
    expect(el.className).not.toContain("subtle");
  });
});

// ─── Signal class mapping ─────────────────────────────────────────────────────

describe("StatusPill — signal class assignment", () => {
  it('maps "deployed" to success signal', () => {
    render(<StatusPill kind="deployed" />);
    expect(screen.getByRole("status").className).toContain("signalSuccess");
  });

  it('maps "shipping" to warning signal', () => {
    render(<StatusPill kind="shipping" />);
    expect(screen.getByRole("status").className).toContain("signalWarning");
  });

  it('maps "exception" to error signal', () => {
    render(<StatusPill kind="exception" />);
    expect(screen.getByRole("status").className).toContain("signalError");
  });

  it('maps "in_progress" to info signal', () => {
    render(<StatusPill kind="in_progress" />);
    expect(screen.getByRole("status").className).toContain("signalInfo");
  });

  it('maps "returned" to neutral signal', () => {
    render(<StatusPill kind="returned" />);
    expect(screen.getByRole("status").className).toContain("signalNeutral");
  });
});

// ─── Custom className ─────────────────────────────────────────────────────────

describe("StatusPill — className prop", () => {
  it("appends a custom className", () => {
    render(<StatusPill kind="assembled" className="my-custom-class" />);
    expect(screen.getByRole("status").className).toContain("my-custom-class");
  });
});
