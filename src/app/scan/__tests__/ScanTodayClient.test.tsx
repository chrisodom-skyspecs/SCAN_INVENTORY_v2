// @vitest-environment jsdom

import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useQueryMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("../../../../convex/_generated/api", () => ({
  api: {
    scanMobile: {
      todayForUser: "scanMobile:todayForUser",
    },
  },
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

import { ScanTodayClient } from "../ScanTodayClient";

describe("ScanTodayClient", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
  });

  it("renders custody and manifest tasks from the SCAN mobile read model", () => {
    useQueryMock.mockReturnValue({
      user: { name: "Chris Odom" },
      stats: { inHand: 1, todaysStops: 1, flags: 1 },
      sections: [
        {
          key: "in_custody",
          label: "In your custody",
          cases: [
            {
              case: {
                _id: "case_1",
                label: "PCN-12",
                status: "flagged",
                locationName: "Site B-North",
                assigneeName: "Chris Odom",
              },
              latestCustody: { toUserName: "Chris Odom" },
              checklist: { total: 14, unchecked: 2 },
              conditionNotes: [],
            },
          ],
        },
        {
          key: "todays_plan",
          label: "Today's plan",
          items: [
            {
              type: "manifest_verify",
              caseId: "case_1",
              label: "Verify PCN-12 manifest",
              detail: "12 of 14 verified",
            },
          ],
        },
      ],
    });

    render(<ScanTodayClient />);

    expect(useQueryMock).toHaveBeenCalledWith("scanMobile:todayForUser", {});
    expect(screen.getByText("PCN-12")).toBeTruthy();
    expect(screen.getByText("Verify PCN-12 manifest")).toBeTruthy();
    expect(screen.getByText("Flagged")).toBeTruthy();
  });
});
