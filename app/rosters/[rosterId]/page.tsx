"use client";

import { Check, Play, Square, User } from "lucide-react";
import Papa from "papaparse";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageShell } from "@/components/page-shell";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { buildAbsoluteUrl, buildEditorPath } from "@/lib/session-links";

function today() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function sanitizeFilePart(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
  const latestSessionId = data && data !== null ? (data.sessions[0]?._id ?? null) : null;
  const sessionExport = useQuery(
    api.attendance.getSessionExport,
    latestSessionId ? { sessionId: latestSessionId } : "skip",
  );

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

  async function handleCopyEditorLink() {
    if (!editorUrl) {
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

  function handleExportCsv() {
    if (!sessionExport) {
      return;
    }

    setIsExporting(true);
    try {
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

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${sanitizeFilePart(sessionExport.roster.name)}-${sessionExport.session.date}-attendance.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
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
              )}
        </div>
      }
      backHref="/"
    >
      <ConfirmDialog
        open={isStopDialogOpen}
        title="Stop Session?"
        description="The session will stop now, but you can resume it later with the same link."
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
      <section className="rounded-[24px] border border-white/70 bg-white/90 p-5 shadow-sm">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {activeSession ? (
              <button
                type="button"
                onClick={() => setIsStopDialogOpen(true)}
                disabled={isStoppingSession}
                className="inline-flex h-11 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <Square className="mr-2 h-4 w-4" />
                {isStoppingSession ? "Stopping..." : "Stop session"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  void (latestSession ? handleResumeSession() : handleStartSession())
                }
                disabled={isStartingSession || !hasStudents}
                className="inline-flex h-11 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <Play className="mr-2 h-4 w-4 fill-current" />
                {isStartingSession
                  ? latestSession
                    ? "Resuming..."
                    : "Starting..."
                  : hasStudents
                    ? latestSession
                      ? "Resume session"
                      : "Start session"
                    : "Add students to start"}
              </button>
            )}

            {latestSession ? (
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={!sessionExport || isExporting}
                className="inline-flex h-11 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
              >
                {isExporting ? "Exporting..." : "Export attendance CSV"}
              </button>
            ) : null}
          </div>

          {latestSession ? (
            <div
              className={`rounded-[24px] border px-4 py-4 ${
                latestSession.isOpen
                  ? "border-emerald-200 bg-emerald-50/80"
                  : "border-slate-200 bg-slate-50/90"
              }`}
            >
              <div>
                <div
                  className={`text-xs font-semibold uppercase tracking-[0.16em] ${
                    latestSession.isOpen ? "text-emerald-700" : "text-slate-500"
                  }`}
                >
                  {latestSession.isOpen ? "Active session" : "Inactive session"}
                </div>
                <div className="mt-1 font-semibold text-slate-950">{latestSession.title}</div>
                <div className="mt-1 text-sm text-slate-600">{formatDate(latestSession.date)}</div>
              </div>
              {latestSession.isOpen ? (
                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopyEditorLink()}
                    title="Copy editor link"
                    className={`min-w-0 flex-1 rounded-2xl border px-4 py-3 text-left text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                      copiedLink
                        ? "border-emerald-400 bg-emerald-100 text-emerald-950"
                        : "border-emerald-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-100/60 hover:text-slate-950 active:scale-[0.99]"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="block min-w-0">
                        <span className="block truncate font-medium">{editorUrl}</span>
                        {copiedLink ? (
                          <span className="mt-1 block text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
                            Copied to clipboard
                          </span>
                        ) : null}
                      </span>
                      {copiedLink ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
                          <Check aria-hidden="true" className="h-3.5 w-3.5" />
                          Copied
                        </span>
                      ) : (
                        <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                          Copy
                        </span>
                      )}
                    </span>
                  </button>
                  <Link
                    href={editorPath}
                    target="_blank"
                    className="inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
                  >
                    Open
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}

          {sessionError ? (
            <p className="text-sm text-rose-700">{sessionError}</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-950">
            <User aria-hidden="true" className="h-5 w-5 text-slate-500" />
            <span>{data.students.length}</span>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href={`/rosters/import?rosterId=${roster._id}`}
              className="inline-flex h-11 items-center justify-center rounded-full border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
            >
              Update roster
            </Link>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-[24px] border border-slate-200">
          <div className="max-h-[32rem] overflow-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-slate-600">Student</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Student ID</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Raw import</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {data.students.map((student) => (
                  <tr key={student._id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{student.displayName}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{student.studentId}</td>
                    <td className="px-4 py-3 text-slate-500">{student.rawName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-rose-200 bg-rose-50/80 p-5 shadow-sm">
        <h2 className="font-heading text-lg font-semibold tracking-tight text-rose-900">Danger</h2>
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setIsDeleteDialogOpen(true)}
            disabled={isDeletingRoster}
            className="inline-flex h-11 items-center justify-center rounded-full border border-rose-300 bg-white px-4 text-sm font-medium text-rose-700 transition hover:border-rose-400 hover:text-rose-800 disabled:cursor-not-allowed disabled:border-rose-200 disabled:text-rose-300"
          >
            {isDeletingRoster ? "Deleting..." : "Delete roster"}
          </button>
        </div>
      </section>

    </PageShell>
  );
}
