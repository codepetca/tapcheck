"use client";

import { Check, CircleHelp, Copy, Pencil, Play, Share, Square, User } from "lucide-react";
import Papa from "papaparse";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { getStudentSessionStatus } from "@/lib/roster-status";
import { buildAbsoluteUrl, buildEditorPath } from "@/lib/session-links";

type SortColumn = "firstName" | "lastName" | "studentId" | "status";
type SortDirection = "asc" | "desc";

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

export default function RosterDetailPage({
  params,
}: {
  params: Promise<{ rosterId: string }>;
}) {
  const resolved = use(params);
  const router = useRouter();
  const data = useQuery(api.rosters.getById, {
    rosterId: resolved.rosterId as Id<"rosters">,
  });
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
  const [isStopDialogOpen, setIsStopDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isHelpDialogOpen, setIsHelpDialogOpen] = useState(false);
  const [canShareCsvFile, setCanShareCsvFile] = useState(false);
  const [canShareEditorLink, setCanShareEditorLink] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>("lastName");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const latestSessionId = data && data !== null ? (data.sessions[0]?._id ?? null) : null;
  const sessionExport = useQuery(
    api.attendance.getSessionExport,
    latestSessionId ? { sessionId: latestSessionId } : "skip",
  );

  useEffect(() => {
    if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
      setCanShareEditorLink(false);
      return;
    }

    const mobileLikeUserAgent = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const coarsePointer =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;

    setCanShareEditorLink(mobileLikeUserAgent || coarsePointer);
  }, []);

  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      typeof navigator.share !== "function" ||
      typeof navigator.canShare !== "function"
    ) {
      setCanShareCsvFile(false);
      return;
    }

    const probeFile = new File(["attendance"], "attendance.csv", {
      type: "text/csv;charset=utf-8;",
    });

    const mobileLikeUserAgent = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const coarsePointer =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;

    setCanShareCsvFile(
      (mobileLikeUserAgent || coarsePointer) && navigator.canShare({ files: [probeFile] }),
    );
  }, []);

  if (data === undefined) {
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
  const editorLinkControlLabel = canShareEditorLink
    ? "Send attendance link"
    : copiedLink
      ? "Copied collection link"
      : "Collection link";
  const exportControlLabel = isExporting
    ? canShareCsvFile
      ? "Opening share sheet"
      : "Downloading attendance CSV"
    : canShareCsvFile
      ? "Share attendance CSV"
      : "Download attendance CSV";
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
      const direction = sortDirection === "asc" ? 1 : -1;

      switch (sortColumn) {
        case "firstName":
          return (
            left.firstName.localeCompare(right.firstName, undefined, { sensitivity: "base" }) *
              direction ||
            left.lastName.localeCompare(right.lastName, undefined, { sensitivity: "base" }) *
              direction ||
            left.originalIndex - right.originalIndex
          );
        case "lastName":
          return (
            left.lastName.localeCompare(right.lastName, undefined, { sensitivity: "base" }) *
              direction ||
            left.firstName.localeCompare(right.firstName, undefined, { sensitivity: "base" }) *
              direction ||
            left.originalIndex - right.originalIndex
          );
        case "studentId":
          return (
            left.studentId.localeCompare(right.studentId, undefined, { sensitivity: "base" }) *
              direction ||
            left.originalIndex - right.originalIndex
          );
        case "status":
          return (
            left.statusLabel.localeCompare(right.statusLabel, undefined, { sensitivity: "base" }) *
              direction ||
            left.lastName.localeCompare(right.lastName, undefined, { sensitivity: "base" }) *
              direction ||
            left.firstName.localeCompare(right.firstName, undefined, { sensitivity: "base" }) *
              direction ||
            left.originalIndex - right.originalIndex
          );
      }
    });
  const presentCount = students.filter((student) => student.statusTone === "present").length;
  const absentCount = students.filter((student) => student.statusTone === "absent").length;

  function toggleSort(nextColumn: SortColumn) {
    if (sortColumn === nextColumn) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortColumn(nextColumn);
    setSortDirection("asc");
  }

  function sortIndicator(column: SortColumn) {
    if (sortColumn !== column) {
      return " ";
    }

    return sortDirection === "asc" ? " ↑" : " ↓";
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

  async function handleEditorLinkAction() {
    if (!editorUrl) {
      return;
    }

    if (canShareEditorLink && typeof navigator !== "undefined" && typeof navigator.share === "function") {
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

    await navigator.clipboard.writeText(editorUrl);
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
      setIsStopDialogOpen(false);
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

      downloadCsvFile(csv, fileName);
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
        open={isStopDialogOpen}
        title="Stop Session?"
        description="You can resume it later."
        confirmLabel="Stop session"
        tone="danger"
        busy={isStoppingSession}
        onConfirm={() => void handleStopSession()}
        onCancel={() => setIsStopDialogOpen(false)}
      />
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
            How Attendance Sharing Works
          </h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
            <p>
              1. Tap <span className="font-semibold text-slate-950">Start</span>.
            </p>
            <p>
              2. Share the <span className="font-semibold text-slate-950">Collection Link</span>.
            </p>
            <p>
              3. Take attendance.
            </p>
          </div>
          <div className="mt-6">
            <button
              type="button"
              onClick={() => setIsHelpDialogOpen(false)}
              className="inline-flex h-11 w-full items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </Card>
      </Dialog>
      <section className="space-y-3">
        <div className="space-y-3">
          {activeSession ? (
            <div className="grid w-full grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setIsStopDialogOpen(true)}
                disabled={isStoppingSession}
                aria-label={stopControlLabel}
                title={stopControlLabel}
                className="inline-flex h-[68px] w-full items-center justify-center gap-2 rounded-full bg-rose-600 px-4 sm:px-5 text-sm font-medium text-white transition hover:bg-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:cursor-not-allowed disabled:bg-rose-200"
              >
                <Square className="h-4 w-4" />
                <span className="hidden sm:inline">{stopControlLabel}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleEditorLinkAction()}
                aria-label={editorLinkControlLabel}
                title={editorLinkControlLabel}
                className="inline-flex h-[68px] w-full items-center justify-center gap-2 rounded-full border border-emerald-200 bg-white/90 px-4 text-sm font-medium text-emerald-950 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                {canShareEditorLink ? (
                  <Share aria-hidden="true" className="h-4 w-4" />
                ) : copiedLink ? (
                  <Check aria-hidden="true" className="h-4 w-4 text-emerald-700" />
                ) : (
                  <Copy aria-hidden="true" className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">{canShareEditorLink ? "Send link" : copiedLink ? "Copied" : "Collection Link"}</span>
              </button>
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
              <span>{data.students.length}</span>
              <User aria-hidden="true" className="h-4 w-4" />
            </span>
          </div>
          <div className="flex flex-wrap gap-3">
            {latestSession ? (
              <button
                type="button"
                onClick={() => void handleExportCsv()}
                disabled={!sessionExport || isExporting}
                aria-label={exportControlLabel}
                title={exportControlLabel}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
              >
                <Share aria-hidden="true" className="h-4 w-4" />
                <span className="hidden sm:inline">
                  {canShareCsvFile ? "Send Attendance" : "Download Attendance"}
                </span>
              </button>
            ) : null}

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
        </div>

        <div className="max-h-[32rem] overflow-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                <th className="px-4 py-3 font-medium text-slate-600">
                  <button
                    type="button"
                    onClick={() => toggleSort("firstName")}
                    className="transition hover:text-slate-950"
                  >
                    First{sortIndicator("firstName")}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium text-slate-600">
                  <button
                    type="button"
                    onClick={() => toggleSort("lastName")}
                    className="transition hover:text-slate-950"
                  >
                    Last{sortIndicator("lastName")}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium text-slate-600">
                  <button
                    type="button"
                    onClick={() => toggleSort("studentId")}
                    className="transition hover:text-slate-950"
                  >
                    Student ID{sortIndicator("studentId")}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium text-slate-600">
                  <button
                    type="button"
                    onClick={() => toggleSort("status")}
                    className="inline-flex items-center gap-2 transition hover:text-slate-950"
                  >
                    Status{sortIndicator("status")}
                    <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                      {presentCount}
                    </span>
                    <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
                      {absentCount}
                    </span>
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
