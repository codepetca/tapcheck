"use client";

import {
  Check,
  CircleHelp,
  ExternalLink,
  Pencil,
  Play,
  Share,
  Send,
  Square,
} from "lucide-react";
import Papa from "papaparse";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageShell } from "@/components/page-shell";
import { PresentTotalPill } from "@/components/present-total-pill";
import { useCurrentAppUser } from "@/components/use-current-app-user";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { getStudentSessionStatus } from "@/lib/roster-status";
import { buildAbsoluteUrl, buildEditorPath } from "@/lib/session-links";

type SortColumn = "firstName" | "lastName" | "studentId" | "status";
type StatusSortDirection = "asc" | "desc";
type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    mobile?: boolean;
  };
};

function today() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sanitizeFilePart(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function downloadCsvFile(csv: string, fileName: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function copyTextFallback(text: string) {
  if (typeof document === "undefined") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  const didCopy = document.execCommand("copy");
  textarea.remove();
  return didCopy;
}

function openCsvInNewTab(csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const openedWindow = window.open(url, "_blank", "noopener,noreferrer");

  window.setTimeout(() => {
    window.URL.revokeObjectURL(url);
  }, 60_000);

  return Boolean(openedWindow);
}

function shouldUseMobileShareFlow() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const navigatorWithUserAgentData = navigator as NavigatorWithUserAgentData;
  if (typeof navigatorWithUserAgentData.userAgentData?.mobile === "boolean") {
    return navigatorWithUserAgentData.userAgentData.mobile;
  }

  const userAgent = navigator.userAgent;
  const isTouchMac = /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1;

  return /Android|iPhone|iPad|iPod/i.test(userAgent) || isTouchMac;
}

export default function RosterDetailPage({
  params,
}: {
  params: Promise<{ rosterId: string }>;
}) {
  const resolved = use(params);
  const router = useRouter();
  const { bootstrapError, isReady } = useCurrentAppUser();
  const data = useQuery(
    api.rosters.getById,
    isReady ? { rosterId: resolved.rosterId as Id<"rosters"> } : "skip",
  );
  const renameRoster = useMutation(api.rosters.rename);
  const deleteRoster = useMutation(api.rosters.remove);
  const createSession = useMutation(api.sessions.create);
  const stopSession = useMutation(api.sessions.stop);
  const resumeSession = useMutation(api.sessions.resume);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isStoppingSession, setIsStoppingSession] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isDeletingRoster, setIsDeletingRoster] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isHelpDialogOpen, setIsHelpDialogOpen] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>("lastName");
  const [statusSortDirection, setStatusSortDirection] = useState<StatusSortDirection>("desc");
  const latestSessionId = data && data !== null ? (data.sessions[0]?._id ?? null) : null;
  const sessionExport = useQuery(
    api.attendance.getSessionExport,
    isReady && latestSessionId ? { sessionId: latestSessionId } : "skip",
  );

  if (bootstrapError) {
    return (
      <PageShell title="Roster" backHref="/">
        <div className="rounded-[28px] border border-rose-200 bg-rose-50/90 px-5 py-8 text-sm text-rose-800 shadow-sm">
          {bootstrapError}
        </div>
      </PageShell>
    );
  }

  if (!isReady || data === undefined) {
    return (
      <PageShell title="Roster" backHref="/">
        <div className="h-40 animate-pulse rounded-[28px] bg-white/80" />
      </PageShell>
    );
  }

  if (data === null) {
    return (
      <PageShell title="Roster not found" backHref="/">
        <div className="rounded-[28px] border border-white/70 bg-white/90 px-5 py-8 text-sm text-slate-600 shadow-sm">
          This roster does not exist.
        </div>
      </PageShell>
    );
  }

  const roster = data.roster;
  const latestSession = data.sessions[0] ?? null;
  const activeSession = data.sessions.find((session) => session.isOpen) ?? null;
  const hasStudents = data.students.length > 0;
  const editorPath = activeSession ? buildEditorPath(activeSession.editorToken) : "";
  const editorUrl =
    activeSession && typeof window !== "undefined"
      ? buildAbsoluteUrl(window.location.origin, editorPath)
      : editorPath;
  const startControlLabel = isStartingSession
    ? "Starting"
    : hasStudents
      ? "Start"
      : "Add students to start";
  const stopControlLabel = isStoppingSession ? "Stopping" : "Stop";
  const openEditorLinkControlLabel = "Open collection link";
  const shareEditorLinkControlLabel = copiedLink
    ? "Copied collection link"
    : "Share or copy collection link";
  const exportControlLabel = isExporting
    ? "Preparing attendance results"
    : "Send or download attendance results";
  const isSessionExportLoading = latestSession !== null && sessionExport === undefined;
  const attendanceByStudentId = new Map(
    sessionExport?.rows.map((row) => [row.studentId, row.present]) ?? [],
  );
  const students = data.students
    .map((student, index) => {
      const present = attendanceByStudentId.get(student.studentId);
      const status = getStudentSessionStatus({
        hasLatestSession: latestSession !== null,
        isSessionExportLoading,
        present,
      });

      return {
        ...student,
        originalIndex: index,
        statusLabel: status.label,
        statusTone: status.tone,
      };
    })
    .sort((left, right) => {
      const compareByStatus = () =>
        left.statusLabel.localeCompare(right.statusLabel, undefined, { sensitivity: "base" });
      const compareByLastName = () =>
        left.lastName.localeCompare(right.lastName, undefined, { sensitivity: "base" });
      const compareByFirstName = () =>
        left.firstName.localeCompare(right.firstName, undefined, { sensitivity: "base" });
      const compareByStudentId = () =>
        left.studentId.localeCompare(right.studentId, undefined, {
          sensitivity: "base",
        });

      switch (sortColumn) {
        case "firstName":
          return (
            compareByFirstName() ||
            compareByLastName() ||
            compareByStudentId() ||
            compareByStatus() ||
            left.originalIndex - right.originalIndex
          );
        case "lastName":
          return (
            compareByLastName() ||
            compareByFirstName() ||
            compareByStudentId() ||
            compareByStatus() ||
            left.originalIndex - right.originalIndex
          );
        case "studentId":
          return (
            compareByStudentId() ||
            compareByLastName() ||
            compareByFirstName() ||
            compareByStatus() ||
            left.originalIndex - right.originalIndex
          );
        case "status":
          if (statusSortDirection === "desc") {
            return (
              -compareByStatus() ||
              compareByLastName() ||
              compareByFirstName() ||
              compareByStudentId() ||
              left.originalIndex - right.originalIndex
            );
          }

          return (
            compareByStatus() ||
            compareByLastName() ||
            compareByFirstName() ||
            compareByStudentId() ||
            left.originalIndex - right.originalIndex
          );
      }
    });
  const presentCount = students.filter((student) => student.statusTone === "present").length;
  const totalCount = data.students.length;

  function toggleSort(nextColumn: SortColumn) {
    if (nextColumn === "status") {
      if (sortColumn === "status") {
        setStatusSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }

      setSortColumn("status");
      setStatusSortDirection("desc");
      return;
    }

    setSortColumn(nextColumn);
  }

  async function handleTitleSave() {
    const nextName = draftTitle.trim();
    if (!nextName) {
      setTitleError("Roster name is required.");
      return;
    }

    if (nextName === roster.name) {
      setIsEditingTitle(false);
      setTitleError(null);
      return;
    }

    setIsSavingTitle(true);
    setTitleError(null);
    try {
      await renameRoster({
        rosterId: roster._id,
        name: nextName,
      });
      setIsEditingTitle(false);
    } catch (error) {
      setTitleError(error instanceof Error ? error.message : "Could not rename roster.");
    } finally {
      setIsSavingTitle(false);
    }
  }

  async function handleStartSession() {
    setSessionError(null);
    setIsStartingSession(true);
    try {
      await createSession({
        rosterId: roster._id,
        date: today(),
      });
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Could not start session.");
    } finally {
      setIsStartingSession(false);
    }
  }

  async function handleResumeSession() {
    if (!latestSession) {
      return;
    }

    setSessionError(null);
    setIsStartingSession(true);
    try {
      await resumeSession({ sessionId: latestSession._id });
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Could not resume session.");
    } finally {
      setIsStartingSession(false);
    }
  }

  function handleOpenEditorLink() {
    if (!editorUrl || typeof window === "undefined") {
      return;
    }

    const openedWindow = window.open(editorUrl, "_blank", "noopener,noreferrer");
    if (!openedWindow) {
      void handleShareEditorLinkAction();
    }
  }

  async function handleShareEditorLinkAction() {
    if (!editorUrl) {
      return;
    }

    if (shouldUseMobileShareFlow() && typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: `${roster.name} attendance link`,
          url: editorUrl,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setSessionError(error instanceof Error ? error.message : "Could not send attendance link.");
      }
      return;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(editorUrl);
    } else if (!copyTextFallback(editorUrl)) {
      window.prompt("Copy this collection link:", editorUrl);
      return;
    }

    setCopiedLink(true);
    window.setTimeout(() => setCopiedLink(false), 1800);
  }

  async function handleStopSession() {
    if (!activeSession) {
      return;
    }

    setSessionError(null);
    setIsStoppingSession(true);
    try {
      await stopSession({ sessionId: activeSession._id });
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Could not stop session.");
    } finally {
      setIsStoppingSession(false);
    }
  }

  async function handleExportCsv() {
    if (!sessionExport) {
      return;
    }

    setSessionError(null);
    setIsExporting(true);
    try {
      const fileName = `${sanitizeFilePart(sessionExport.roster.name)}-${sessionExport.session.date}-attendance.csv`;
      const csv = Papa.unparse([
        ["Date", sessionExport.session.date],
        [],
        ["Student ID", "Student Name", "Status"],
        ...sessionExport.rows.map((row) => [
          row.studentId,
          row.displayName || row.rawName,
          row.present ? "Present" : "Absent",
        ]),
      ]);

      const file = new File([csv], fileName, {
        type: "text/csv;charset=utf-8;",
      });

      if (
        shouldUseMobileShareFlow() &&
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] })
      ) {
        try {
          await navigator.share({
            title: fileName,
            files: [file],
          });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }

          // Some browsers expose file-sharing but reject at runtime. Fall back to a download.
          if (
            error instanceof DOMException &&
            (error.name === "NotAllowedError" || error.name === "SecurityError")
          ) {
            downloadCsvFile(csv, fileName);
            return;
          }

          if (
            error instanceof Error &&
            error.message.toLocaleLowerCase().includes("permission denied")
          ) {
            downloadCsvFile(csv, fileName);
            return;
          }

          throw error;
        }
      }

      if (shouldUseMobileShareFlow()) {
        if (!openCsvInNewTab(csv)) {
          downloadCsvFile(csv, fileName);
        }
      } else {
        downloadCsvFile(csv, fileName);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      setSessionError(error instanceof Error ? error.message : "Could not export attendance CSV.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleDeleteRoster() {
    setSessionError(null);
    setIsDeletingRoster(true);
    try {
      await deleteRoster({ rosterId: roster._id });
      setIsDeleteDialogOpen(false);
      router.push("/");
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Could not delete roster.");
      setIsDeletingRoster(false);
    }
  }

  return (
    <PageShell
      headerAction={
        <button
          type="button"
          onClick={() => setIsHelpDialogOpen(true)}
          aria-label="How attendance sharing works"
          title="How attendance sharing works"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          <CircleHelp aria-hidden="true" className="h-4 w-4" />
        </button>
      }
      title={
        <div>
          {isEditingTitle ? (
            <div className="space-y-3">
              <input
                autoFocus
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleTitleSave();
                  }
                  if (event.key === "Escape") {
                    setIsEditingTitle(false);
                    setTitleError(null);
                  }
                }}
                className="font-heading h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-2xl font-semibold tracking-tight text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
              />
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleTitleSave()}
                  disabled={isSavingTitle}
                  className="inline-flex h-10 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isSavingTitle ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingTitle(false);
                    setDraftTitle(data.roster.name);
                    setTitleError(null);
                  }}
                  className="inline-flex h-10 items-center justify-center rounded-full border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
                >
                  Cancel
                </button>
              </div>
              {titleError ? <p className="text-sm text-rose-700">{titleError}</p> : null}
            </div>
          ) : (
            <div>
              <button
                type="button"
                onClick={() => {
                  setDraftTitle(roster.name);
                  setIsEditingTitle(true);
                  setTitleError(null);
                }}
                className="font-heading text-left text-3xl font-semibold tracking-tight text-slate-950 transition hover:text-emerald-700"
              >
                {roster.name}
              </button>
            </div>
          )}
        </div>
      }
      backHref="/"
    >
      <ConfirmDialog
        open={isDeleteDialogOpen}
        title="Delete Roster?"
        description={`Delete roster "${roster.name}"? This permanently removes its students, session, and attendance records.`}
        confirmLabel="Delete roster"
        tone="danger"
        busy={isDeletingRoster}
        onConfirm={() => void handleDeleteRoster()}
        onCancel={() => setIsDeleteDialogOpen(false)}
      />
      <Dialog open={isHelpDialogOpen} onClose={() => setIsHelpDialogOpen(false)}>
        <Card className="w-full border border-white/70 bg-white shadow-xl ring-0">
          <h2 className="font-heading text-xl font-semibold tracking-tight text-slate-950">
            How to Take Attendance
          </h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
            <p>
              1. Tap{" "}
              <span className="inline-flex items-center gap-1 font-semibold text-slate-950">
                <span>Start</span>
                <Play aria-hidden="true" className="h-4 w-4 fill-current text-emerald-700" />
              </span>
              .
            </p>
            <p>
              2. Open the collection{" "}
              <span className="inline-flex items-center gap-1 font-semibold text-slate-950">
                <span>link</span>
                <ExternalLink aria-hidden="true" className="h-4 w-4 text-emerald-700" />
              </span>{" "}
              or{" "}
              <span className="inline-flex items-center gap-1 font-semibold text-slate-950">
                <span>share</span>
                <Share aria-hidden="true" className="h-4 w-4 text-emerald-700" />
              </span>{" "}
              it with whoever is taking attendance.
            </p>
            <p>
              3. When finished, tap{" "}
              <span className="inline-flex items-center gap-1 font-semibold text-slate-950">
                <span>Stop</span>
                <Square aria-hidden="true" className="h-4 w-4 fill-current text-rose-600" />
              </span>{" "}
              and send attendance{" "}
              <span className="inline-flex items-center gap-1 font-semibold text-slate-950">
                <span>results</span>
                <Send aria-hidden="true" className="h-4 w-4 text-emerald-700" />
              </span>
              .
            </p>
          </div>
        </Card>
      </Dialog>
      <section className="space-y-3">
        <div className="space-y-3">
          {activeSession ? (
            <div className="grid w-full grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => void handleStopSession()}
                disabled={isStoppingSession}
                aria-label={stopControlLabel}
                title={stopControlLabel}
                className="inline-flex h-[68px] w-full items-center justify-center gap-2 rounded-full bg-rose-600 px-4 sm:px-5 text-sm font-medium text-white transition hover:bg-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:cursor-not-allowed disabled:bg-rose-200"
              >
                <Square className="h-4 w-4" />
                <span className="hidden sm:inline">{stopControlLabel}</span>
              </button>

              <div className="flex h-[68px] w-full overflow-hidden rounded-full border border-emerald-200 bg-white/90">
                <button
                  type="button"
                  onClick={handleOpenEditorLink}
                  aria-label={openEditorLinkControlLabel}
                  title={openEditorLinkControlLabel}
                  className="inline-flex min-w-0 flex-1 items-center justify-center gap-2 px-4 text-sm font-medium text-emerald-950 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
                >
                  <ExternalLink aria-hidden="true" className="h-4 w-4" />
                  <span className="hidden sm:inline">Open link</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleShareEditorLinkAction()}
                  aria-label={shareEditorLinkControlLabel}
                  title={shareEditorLinkControlLabel}
                  className="inline-flex w-14 shrink-0 items-center justify-center border-l border-emerald-200 text-emerald-950 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
                >
                  {copiedLink ? (
                    <Check aria-hidden="true" className="h-4 w-4 text-emerald-700" />
                  ) : (
                    <Share aria-hidden="true" className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() =>
                void (latestSession ? handleResumeSession() : handleStartSession())
              }
              disabled={isStartingSession || !hasStudents}
              aria-label={startControlLabel}
              title={startControlLabel}
              className="inline-flex h-[68px] w-full items-center justify-center gap-2 rounded-full bg-emerald-600 px-4 sm:px-5 text-sm font-medium text-white transition hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-200"
            >
              <Play className="h-4 w-4 fill-current" />
              <span className="hidden sm:inline">{startControlLabel}</span>
            </button>
          )}

          {sessionError ? (
            <p className="text-sm text-rose-700">{sessionError}</p>
          ) : null}

          {!hasStudents ? (
            <p className="text-sm text-slate-500">Add students before starting a session.</p>
          ) : null}
        </div>
      </section>

      <section className="overflow-hidden rounded-[28px] border border-white/70 bg-white/90 shadow-sm">
        <div className="grid grid-cols-3 items-center gap-3 border-b border-slate-200 px-5 py-4">
          <div className="justify-self-start">
            <Link
              href={`/rosters/import?rosterId=${roster._id}`}
              aria-label="Edit roster"
              title="Edit roster"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              <Pencil aria-hidden="true" className="h-4 w-4" />
              <span className="hidden sm:inline">Edit Roster</span>
            </Link>
          </div>
          <div className="justify-self-center">
            <PresentTotalPill presentCount={presentCount} totalCount={totalCount} />
          </div>
          <div className="justify-self-end">
            {latestSession ? (
              <button
                type="button"
                onClick={() => void handleExportCsv()}
                disabled={!sessionExport || isExporting}
                aria-label={exportControlLabel}
                title={exportControlLabel}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
              >
                <Send aria-hidden="true" className="h-4 w-4" />
                <span className="hidden sm:inline">Send Attendance</span>
              </button>
            ) : null}
          </div>
        </div>

        <div className="max-h-[32rem] overflow-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                <th
                  className={`px-4 py-3 font-medium ${
                    sortColumn === "firstName" ? "bg-slate-200 text-slate-950" : "text-slate-600"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort("firstName")}
                    className="w-full py-1 text-left transition hover:text-slate-950"
                  >
                    First
                  </button>
                </th>
                <th
                  className={`px-4 py-3 font-medium ${
                    sortColumn === "lastName" ? "bg-slate-200 text-slate-950" : "text-slate-600"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort("lastName")}
                    className="w-full py-1 text-left transition hover:text-slate-950"
                  >
                    Last
                  </button>
                </th>
                <th
                  className={`px-4 py-3 font-medium ${
                    sortColumn === "studentId" ? "bg-slate-200 text-slate-950" : "text-slate-600"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort("studentId")}
                    className="w-full py-1 text-left transition hover:text-slate-950"
                  >
                    ID
                  </button>
                </th>
                <th
                  className={`px-4 py-3 font-medium ${
                    sortColumn === "status" ? "bg-slate-200 text-slate-950" : "text-slate-600"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort("status")}
                    className="w-full py-1 text-left transition hover:text-slate-950"
                  >
                    Status
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {students.map((student) => (
                <tr key={student._id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{student.firstName}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{student.lastName}</td>
                  <td className="px-4 py-3 text-slate-700">{student.studentId}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                        student.statusTone === "present"
                          ? "bg-emerald-100 text-emerald-800"
                          : student.statusTone === "absent"
                            ? "bg-rose-100 text-rose-700"
                            : student.statusTone === "loading"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {student.statusLabel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <button
          type="button"
          onClick={() => setIsDeleteDialogOpen(true)}
          disabled={isDeletingRoster}
          className="inline-flex h-11 w-full items-center justify-center rounded-full border border-rose-300 bg-white px-4 text-sm font-medium text-rose-700 transition hover:border-rose-400 hover:text-rose-800 disabled:cursor-not-allowed disabled:border-rose-200 disabled:text-rose-300"
        >
          {isDeletingRoster ? "Deleting..." : "Delete roster"}
        </button>
      </section>

    </PageShell>
  );
}
