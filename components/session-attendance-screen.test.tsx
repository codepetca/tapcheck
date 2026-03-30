import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionAttendanceScreen } from "./session-attendance-screen";

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();
const mockToggleAttendance = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

vi.mock("@/lib/time", () => ({
  getCurrentTimestamp: () => 1_742_000_000_000,
}));

const sessionData = {
  session: {
    _id: "session-1",
    title: "Homeroom",
    date: "2026-03-29",
    isOpen: true,
  },
  roster: {
    _id: "roster-1",
    name: "Homeroom",
  },
  totalCount: 2,
  presentCount: 1,
  students: [
    {
      studentRef: "student-1",
      studentId: "1001",
      rawName: "Able, Alice",
      displayName: "Alice Able",
      firstName: "Alice",
      lastName: "Able",
      present: true,
      markedAt: 1_710_000_000_000,
      modifiedAt: 1_710_000_000_000,
      lastModifiedAt: 1_710_000_000_000,
    },
    {
      studentRef: "student-2",
      studentId: "1002",
      rawName: "Baker, John",
      displayName: "John Baker",
      firstName: "John",
      lastName: "Baker",
      present: false,
      markedAt: undefined,
      modifiedAt: 1_710_000_000_000,
      lastModifiedAt: undefined,
    },
  ],
};

describe("SessionAttendanceScreen", () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
    mockUseMutation.mockReset();
    mockToggleAttendance.mockReset();

    mockUseQuery.mockImplementation((_: unknown, args: unknown) => {
      if (args && typeof args === "object" && "token" in args) {
        return sessionData;
      }

      return undefined;
    });

    mockToggleAttendance.mockResolvedValue(undefined);
    mockUseMutation.mockReturnValue({
      withOptimisticUpdate: () => mockToggleAttendance,
    });
  });

  it("shows only the marked time for present students", () => {
    render(<SessionAttendanceScreen token="editor-token-1" />);

    const timeLabel = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(1_710_000_000_000);

    const aliceRow = screen.getByText("Alice").closest("button");
    expect(aliceRow).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Homeroom" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search name or student ID")).toBeInTheDocument();
    expect(within(aliceRow!).getByText(timeLabel)).toBeInTheDocument();
    expect(within(aliceRow!).queryByText(/^Present/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("1 of 2 students marked present")).toBeInTheDocument();
  });

  it("submits attendance toggles with the expected token and timestamp", async () => {
    render(<SessionAttendanceScreen token="editor-token-1" />);

    const searchInput = screen.getByPlaceholderText("Search name or student ID");
    fireEvent.change(searchInput, { target: { value: "John" } });

    const johnRow = screen.getByText("John").closest("button");
    expect(johnRow).not.toBeNull();

    fireEvent.click(johnRow!);

    await waitFor(() => {
      expect(mockToggleAttendance).toHaveBeenCalledWith({
        token: "editor-token-1",
        studentRef: "student-2",
        clientNow: 1_742_000_000_000,
      });
    });

    expect(searchInput).toHaveValue("");
  });
});
