export type SessionStatusBadge =
  | {
      label: "Active";
      className: "bg-emerald-100 text-emerald-800";
    }
  | null;

export type StudentSessionStatus =
  | {
      label: "Present";
      tone: "present";
    }
  | {
      label: "Absent";
      tone: "absent";
    }
  | {
      label: "Loading";
      tone: "loading";
    }
  | {
      label: "Not in session";
      tone: "none";
    }
  | {
      label: "No session";
      tone: "none";
    };

export function getSessionStatusBadge(hasActiveSession: boolean): SessionStatusBadge {
  return hasActiveSession
    ? {
        label: "Active",
        className: "bg-emerald-100 text-emerald-800",
      }
    : null;
}

export function getStudentSessionStatus(args: {
  hasLatestSession: boolean;
  isSessionExportLoading: boolean;
  present: boolean | undefined;
}): StudentSessionStatus {
  if (args.present !== undefined) {
    return args.present
      ? {
          label: "Present",
          tone: "present",
        }
      : {
          label: "Absent",
          tone: "absent",
        };
  }

  if (args.isSessionExportLoading) {
    return {
      label: "Loading",
      tone: "loading",
    };
  }

  if (args.hasLatestSession) {
    return {
      label: "Not in session",
      tone: "none",
    };
  }

  return {
    label: "No session",
    tone: "none",
  };
}
