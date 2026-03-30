import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RosterDetailPage from "./page";

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();
const mockPush = vi.fn();
const mockUseCurrentAppUser = vi.fn();
const mockRenameRoster = vi.fn();
const mockDeleteRoster = vi.fn();
const mockCreateSession = vi.fn();
const mockStopSession = vi.fn();
const mockResumeSession = vi.fn();

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");

  return {
    ...actual,
    use: (value: unknown) => value,
  };
});

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/components/use-current-app-user", () => ({
  useCurrentAppUser: () => mockUseCurrentAppUser(),
}));

vi.mock("@/components/clerk-header-controls", () => ({
  ClerkHeaderControls: () => null,
}));

vi.mock("@/components/confirm-dialog", () => ({
  ConfirmDialog: () => null,
}));

const rosterDetail = {
  roster: {
    _id: "roster-1",
    name: "Homeroom",
    createdAt: 1_710_000_000_000,
  },
  students: [
    {
      _id: "student-1",
      studentId: "1002",
      rawName: "Baker, Alice",
      firstName: "Alice",
      lastName: "Baker",
      displayName: "Alice Baker",
      active: true,
    },
    {
      _id: "student-2",
      studentId: "1001",
      rawName: "Able, John",
      firstName: "John",
      lastName: "Able",
      displayName: "John Able",
      active: true,
    },
  ],
  sessions: [
    {
      _id: "session-1",
      title: "Homeroom",
      date: "2026-03-29",
      isOpen: true,
      editorToken: "editor-token-1",
      createdAt: 1_710_000_000_000,
    },
  ],
};

const sessionExport = {
  roster: {
    _id: "roster-1",
    name: "Homeroom",
  },
  session: {
    _id: "session-1",
    title: "Homeroom",
    date: "2026-03-29",
    isOpen: true,
  },
  rows: [
    {
      studentId: "1002",
      rawName: "Baker, Alice",
      displayName: "Alice Baker",
      firstName: "Alice",
      lastName: "Baker",
      present: true,
      markedAt: 1_710_000_000_000,
      modifiedAt: 1_710_000_000_000,
    },
    {
      studentId: "1001",
      rawName: "Able, John",
      displayName: "John Able",
      firstName: "John",
      lastName: "Able",
      present: false,
      markedAt: undefined,
      modifiedAt: 1_710_000_000_000,
    },
  ],
};

function renderPage() {
  return render(<RosterDetailPage params={{ rosterId: "roster-1" } as never} />);
}

describe("RosterDetailPage actions", () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
    mockUseMutation.mockReset();
    mockPush.mockReset();
    mockUseCurrentAppUser.mockReset();
    mockRenameRoster.mockReset();
    mockDeleteRoster.mockReset();
    mockCreateSession.mockReset();
    mockStopSession.mockReset();
    mockResumeSession.mockReset();

    mockUseCurrentAppUser.mockReturnValue({
      currentAppUser: {
        _id: "app-user-1",
        displayName: "Teacher One",
        createdAt: 1_710_000_000_000,
      },
      bootstrapError: null,
      isReady: true,
    });

    mockUseQuery.mockImplementation((_: unknown, args: unknown) => {
      if (args && typeof args === "object" && "rosterId" in args) {
        return rosterDetail;
      }

      if (args && typeof args === "object" && "sessionId" in args) {
        return sessionExport;
      }

      return undefined;
    });

    mockRenameRoster.mockResolvedValue(undefined);
    mockDeleteRoster.mockResolvedValue(undefined);
    mockCreateSession.mockResolvedValue(undefined);
    mockStopSession.mockResolvedValue(undefined);
    mockResumeSession.mockResolvedValue(undefined);
    mockUseMutation
      .mockReturnValueOnce(mockRenameRoster)
      .mockReturnValueOnce(mockDeleteRoster)
      .mockReturnValueOnce(mockCreateSession)
      .mockReturnValueOnce(mockStopSession)
      .mockReturnValueOnce(mockResumeSession);

    Object.defineProperty(window.navigator, "userAgentData", {
      configurable: true,
      value: { mobile: false },
    });
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    Object.defineProperty(window.navigator, "share", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(window.navigator, "canShare", {
      configurable: true,
      value: vi.fn().mockReturnValue(true),
    });

    vi.spyOn(window, "open").mockReturnValue({} as Window);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:attendance");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(window, "prompt").mockImplementation(() => null);
  });

  it("uses desktop copy and download fallbacks while keeping the same visible actions", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Open collection link" }));
    expect(window.open).toHaveBeenCalledWith(
      "http://localhost:3000/s/edit/editor-token-1",
      "_blank",
      "noopener,noreferrer",
    );

    fireEvent.click(screen.getByRole("button", { name: "Share or copy collection link" }));

    await waitFor(() => {
      expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith(
        "http://localhost:3000/s/edit/editor-token-1",
      );
    });
    expect(window.navigator.share).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Send or download attendance results" }));

    await waitFor(() => {
      expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    });
    expect(window.navigator.share).not.toHaveBeenCalled();
  });

  it("uses mobile share flows for the same visible actions", async () => {
    Object.defineProperty(window.navigator, "userAgentData", {
      configurable: true,
      value: { mobile: true },
    });

    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Share or copy collection link" }));

    await waitFor(() => {
      expect(window.navigator.share).toHaveBeenCalledWith({
        title: "Homeroom attendance link",
        url: "http://localhost:3000/s/edit/editor-token-1",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Send or download attendance results" }));

    await waitFor(() => {
      expect(window.navigator.share).toHaveBeenCalledTimes(2);
    });

    const secondCall = vi.mocked(window.navigator.share).mock.calls[1]?.[0] as {
      files?: File[];
      title?: string;
    };

    expect(secondCall.title).toBe("homeroom-2026-03-29-attendance.csv");
    expect(secondCall.files?.[0]?.name).toBe("homeroom-2026-03-29-attendance.csv");
  });

  it("stops the active session immediately without a confirmation dialog", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => {
      expect(mockStopSession).toHaveBeenCalledWith({ sessionId: "session-1" });
    });
  });

  it("sorts ascending by the selected column and uses the compact ID header", () => {
    renderPage();

    expect(screen.getByLabelText("1 of 2 students marked present")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "First" }));

    let rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Alice");
    expect(rows[2]).toHaveTextContent("John");

    fireEvent.click(screen.getByRole("button", { name: "ID" }));

    rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("1001");
    expect(rows[2]).toHaveTextContent("1002");
    expect(screen.queryByText("Student ID")).not.toBeInTheDocument();
    expect(screen.queryByText("↑")).not.toBeInTheDocument();
    expect(screen.queryByText("↓")).not.toBeInTheDocument();
  });

  it("sorts status descending first, then toggles to ascending on a second tap", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Status" }));

    let rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Alice");
    expect(rows[1]).toHaveTextContent("Present");
    expect(rows[2]).toHaveTextContent("John");
    expect(rows[2]).toHaveTextContent("Absent");

    fireEvent.click(screen.getByRole("button", { name: "Status" }));

    rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("John");
    expect(rows[1]).toHaveTextContent("Absent");
    expect(rows[2]).toHaveTextContent("Alice");
    expect(rows[2]).toHaveTextContent("Present");
  });
});
