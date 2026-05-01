/**
 * @vitest-environment jsdom
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const pushMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => useMutationMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
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

import { NewShipmentClient } from "../NewShipmentClient";

describe("NewShipmentClient", () => {
  beforeEach(() => {
    pushMock.mockReset();
    useMutationMock.mockReset();
    useQueryMock.mockReset();
  });

  it("renders hangar-ready cases in the case inclusion step", () => {
    useQueryMock
      .mockReturnValueOnce([
        {
          _id: "unit_1",
          unitId: "FS-101",
          platform: "ForeSight",
          version: "V1",
          pairedBeakon: "BK-4101",
        },
      ])
      .mockReturnValueOnce([
        {
          _id: "mission_1",
          name: "Lake Michigan Offshore Inspection",
          locationName: "Lake Michigan Field Site",
        },
      ])
      .mockReturnValueOnce([
        {
          _id: "case_1",
          label: "FS-101-GSC",
          status: "assembled",
          unitId: "unit_1",
          locationName: "SkySpecs Hangar - Staging Bay 1",
        },
        {
          _id: "case_2",
          label: "FS-102-AC",
          status: "deployed",
          unitId: "unit_2",
          locationName: "Field Site",
        },
      ]);

    render(<NewShipmentClient />);

    expect(screen.getByRole("heading", { name: "New outbound shipment" })).toBeTruthy();
    expect(screen.getByText("FS-101-GSC")).toBeTruthy();
    expect(screen.queryByText("FS-102-AC")).toBeNull();
  });
});
