import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "./page";

const mockUseQuery = vi.fn();
const mockUseCurrentAppUser = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

vi.mock("@/components/use-current-app-user", () => ({
  useCurrentAppUser: () => mockUseCurrentAppUser(),
}));

describe("HomePage", () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
    mockUseCurrentAppUser.mockReset();
    mockUseCurrentAppUser.mockReturnValue({
      currentAppUser: {
        _id: "app-user-1",
        displayName: "Teacher One",
        createdAt: 1710000000000,
      },
      isReady: true,
      bootstrapError: null,
    });
  });

  it("hides the manage roster section when there are no rosters", () => {
    mockUseQuery.mockReturnValue([]);

    render(<HomePage />);

    expect(screen.queryByText("Manage a Roster")).not.toBeInTheDocument();
  });

  it("shows an Active badge only for rosters with an active session", () => {
    mockUseQuery.mockReturnValue([
      {
        _id: "roster-active",
        name: "Morning",
        createdAt: 1710000000000,
        studentCount: 20,
        sessionCount: 1,
        hasActiveSession: true,
        latestSessionId: "session-1",
      },
      {
        _id: "roster-inactive",
        name: "Afternoon",
        createdAt: 1710000000000,
        studentCount: 18,
        sessionCount: 1,
        hasActiveSession: false,
        latestSessionId: "session-2",
      },
    ]);

    render(<HomePage />);

    expect(screen.getByText("Manage a Roster")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.queryByText("Session status syncing")).not.toBeInTheDocument();
  });
});
