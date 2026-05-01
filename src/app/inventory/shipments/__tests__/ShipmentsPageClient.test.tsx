/**
 * @vitest-environment jsdom
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const useQueryMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { ShipmentsPageClient } from "../ShipmentsPageClient";

describe("ShipmentsPageClient", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
  });

  it("renders outbound shipment rows named by unit identity", () => {
    useQueryMock.mockReturnValue([
      {
        _id: "outbound_1",
        displayName: 'FS-101 "Lakefly" (N101FS)',
        status: "draft",
        destinationName: "SkySpecs Hangar - Ann Arbor, MI",
        recipientName: "Sarah Novak",
        releasedAt: undefined,
        caseIds: ["case_1", "case_2", "case_3"],
        unit: {
          platform: "ForeSight",
          version: "V1",
          pairedBeakon: "BK-4101",
        },
        cases: [],
      },
    ]);

    render(<ShipmentsPageClient />);

    expect(screen.getByRole("heading", { name: "Outbound Shipments" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /\+ New shipment/i }).getAttribute("href"))
      .toBe("/inventory/shipments/new");
    expect(screen.getByRole("link", { name: /FS-101/ }).getAttribute("href"))
      .toBe("/inventory/shipments/outbound_1");
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });
});
