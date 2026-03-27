import { describe, expect, it } from "vitest";
import { getSessionStatusBadge, getStudentSessionStatus } from "./roster-status";

describe("getSessionStatusBadge", () => {
  it("shows the active badge only when a roster has an active session", () => {
    expect(getSessionStatusBadge(true)).toEqual({
      label: "Active",
      className: "bg-emerald-100 text-emerald-800",
    });
  });

  it("shows no badge for inactive rosters, even if they have past sessions", () => {
    expect(getSessionStatusBadge(false)).toBeNull();
  });
});

describe("getStudentSessionStatus", () => {
  it("marks a student present when the latest session export includes a present record", () => {
    expect(
      getStudentSessionStatus({
        hasLatestSession: true,
        isSessionExportLoading: false,
        present: true,
      }),
    ).toEqual({
      label: "Present",
      tone: "present",
    });
  });

  it("marks a student absent when the latest session export includes an absent record", () => {
    expect(
      getStudentSessionStatus({
        hasLatestSession: true,
        isSessionExportLoading: false,
        present: false,
      }),
    ).toEqual({
      label: "Absent",
      tone: "absent",
    });
  });

  it("shows loading only while the latest session export is still unresolved", () => {
    expect(
      getStudentSessionStatus({
        hasLatestSession: true,
        isSessionExportLoading: true,
        present: undefined,
      }),
    ).toEqual({
      label: "Loading",
      tone: "loading",
    });
  });

  it("shows not in session when a student was added after the latest session", () => {
    expect(
      getStudentSessionStatus({
        hasLatestSession: true,
        isSessionExportLoading: false,
        present: undefined,
      }),
    ).toEqual({
      label: "Not in session",
      tone: "none",
    });
  });

  it("shows no session when no session exists yet", () => {
    expect(
      getStudentSessionStatus({
        hasLatestSession: false,
        isSessionExportLoading: false,
        present: undefined,
      }),
    ).toEqual({
      label: "No session",
      tone: "none",
    });
  });
});
