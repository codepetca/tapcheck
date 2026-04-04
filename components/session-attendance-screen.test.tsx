import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionAttendanceScreen } from "./session-attendance-screen";

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();
const mockCloseSession = vi.fn();
const mockMarkManual = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

vi.mock("@/components/clerk-header-controls", () => ({
  ClerkHeaderControls: () => null,
}));

vi.mock("react-qr-code", () => ({
  default: ({ value }: { value: string }) => <div data-testid="qr-value">{value}</div>,
}));

const liveSession = {
  session: {
    _id: "session-1",
    title: "Homeroom",
    date: "2026-04-04",
    status: "open" as const,
    checkInToken: "check-in-token-1",
  },
  roster: {
    _id: "roster-1",
    name: "Homeroom",
  },
  counts: {
    total: 2,
    present: 1,
    late: 0,
    unmarked: 1,
    absent: 0,
  },
  rows: [
    {
      participantId: "participant-1",
      displayName: "Alice Able",
      firstName: "Alice",
      lastName: "Able",
      studentId: "1001",
      schoolEmail: "alice@example.edu",
      status: "present" as const,
      lastMarkedAt: 1_742_000_000_000,
      modifiedAt: 1_742_000_000_000,
      linkStatus: "linked" as const,
      linkedAppUserId: "app-user-1",
    },
    {
      participantId: "participant-2",
      displayName: "John Baker",
      firstName: "John",
      lastName: "Baker",
      studentId: "1002",
      schoolEmail: undefined,
      status: "unmarked" as const,
      lastMarkedAt: undefined,
      modifiedAt: 1_742_000_000_000,
      linkStatus: "unlinked" as const,
      linkedAppUserId: undefined,
    },
  ],
  unresolvedEvents: [
    {
      participantId: undefined,
      participantName: undefined,
      result: "review_needed" as const,
      reasonCode: "not_on_roster",
      createdAt: 1_742_000_000_000,
    },
  ],
};

describe("SessionAttendanceScreen", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mockUseQuery.mockReset();
    mockUseMutation.mockReset();
    mockCloseSession.mockReset();
    mockMarkManual.mockReset();

    mockUseQuery.mockReturnValue(liveSession);
    mockCloseSession.mockResolvedValue(undefined);
    mockMarkManual.mockResolvedValue(undefined);
    mockUseMutation.mockImplementation(() => mockMarkManual);
  });

  it("shows a loading shell before the session query resolves", () => {
    mockUseQuery.mockReturnValue(undefined);

    const { container } = render(
      <SessionAttendanceScreen rosterId="roster-1" sessionId="session-1" />,
    );

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByText("Homeroom")).not.toBeInTheDocument();
  });

  it("renders live attendance rows and review events", () => {
    render(<SessionAttendanceScreen rosterId="roster-1" sessionId="session-1" />);

    expect(screen.getByRole("heading", { name: "Homeroom" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search name, ID, or email")).toBeInTheDocument();
    expect(screen.getByText("Alice Able")).toBeInTheDocument();
    expect(screen.getByText("John Baker")).toBeInTheDocument();
    expect(screen.getByText(/Unmatched student/i)).toBeInTheDocument();
    expect(screen.getByText(/not on roster/i)).toBeInTheDocument();
  });

  it("uses the configured public app url for the QR target", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://tap.codepet.ca");

    render(<SessionAttendanceScreen rosterId="roster-1" sessionId="session-1" />);

    expect(screen.getByTestId("qr-value")).toHaveTextContent(
      "https://tap.codepet.ca/check-in/check-in-token-1",
    );
  });

  it("submits manual present updates with the expected participant and session ids", async () => {
    render(<SessionAttendanceScreen rosterId="roster-1" sessionId="session-1" />);

    fireEvent.click(screen.getAllByRole("button", { name: /Present/i })[1]!);

    await waitFor(() => {
      expect(mockMarkManual).toHaveBeenCalledWith({
        sessionId: "session-1",
        participantId: "participant-2",
        nextStatus: "present",
      });
    });
  });
});
