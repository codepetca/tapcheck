"use client";

import { ArrowRight, Link2, Pencil, Play, Sparkles, Trash2, Unlink2 } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { getStudentSessionStatus } from "@/lib/roster-status";
import { buildStaffSessionPath } from "@/lib/session-links";

function today() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLinkStatusClasses(status: "linked" | "unlinked" | "ambiguous" | "review_needed") {
  if (status === "linked") {
    return "bg-emerald-100 text-emerald-800";
  }

  if (status === "ambiguous" || status === "review_needed") {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-slate-100 text-slate-600";
}

export default function RosterDetailPage({
  params,
}: {
  params: Promise<{ rosterId: string }>;
}) {
  const { rosterId } = use(params);
  const router = useRouter();
  const data = useQuery(api.rosters.getById, { rosterId: rosterId as Id<"rosters"> });
  const renameRoster = useMutation(api.rosters.rename);
  const deleteRoster = useMutation(api.rosters.remove);
  const autoLinkParticipants = useMutation(api.participants.autoLinkRosterParticipants);
  const linkParticipantToAppUser = useMutation(api.participants.linkParticipantToAppUser);
  const unlinkParticipant = useMutation(api.participants.unlinkParticipant);
  const startSession = useMutation(api.sessions.start);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isDeleting = busyKey === "delete";
  const rosterQueryArgs =
    data !== undefined && data !== null && !isDeleting ? { rosterId: rosterId as Id<"rosters"> } : "skip";
  const linkSummary = useQuery(api.participants.getRosterLinkSummary, rosterQueryArgs);
  const linkIssues = useQuery(api.participants.listLinkIssues, rosterQueryArgs);

  const latestSessionId = data?.sessions[0]?._id;
  const activeSession = data?.sessions.find((session) => session.status === "open") ?? null;
  const sessionExport = useQuery(
    api.attendance.getSessionExport,
    latestSessionId && !isDeleting ? { sessionId: latestSessionId } : "skip",
  );

  async function handleRename() {
    if (!data) {
      return;
    }

    const nextName = draftTitle.trim();
    if (!nextName) {
      setError("Roster name is required.");
      return;
    }

    setBusyKey("rename");
    setError(null);
    try {
      await renameRoster({
        rosterId: data.roster._id,
        name: nextName,
      });
      setIsEditingTitle(false);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Could not rename roster.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleStartSession() {
    if (!data) {
      return;
    }

    setBusyKey("start");
    setError(null);
    try {
      const sessionId = await startSession({
        rosterId: data.roster._id,
        date: today(),
      });
      router.push(buildStaffSessionPath(data.roster._id, sessionId));
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start session.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleAutoLink() {
    if (!data) {
      return;
    }

    setBusyKey("autolink");
    setError(null);
    try {
      await autoLinkParticipants({ rosterId: data.roster._id });
    } catch (autoLinkError) {
      setError(autoLinkError instanceof Error ? autoLinkError.message : "Could not auto-link roster participants.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleLinkParticipant(participantId: Id<"participants">, appUserId: Id<"app_users">) {
    setBusyKey(`link:${participantId}`);
    setError(null);
    try {
      await linkParticipantToAppUser({ participantId, appUserId });
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "Could not link this participant.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleUnlinkParticipant(participantId: Id<"participants">) {
    setBusyKey(`unlink:${participantId}`);
    setError(null);
    try {
      await unlinkParticipant({ participantId });
    } catch (unlinkError) {
      setError(unlinkError instanceof Error ? unlinkError.message : "Could not unlink this participant.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDeleteRoster() {
    if (!data) {
      return;
    }

    setBusyKey("delete");
    setError(null);
    try {
      await deleteRoster({ rosterId: data.roster._id });
      router.push("/");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete roster.");
      setBusyKey(null);
    }
  }

  if (data === undefined) {
    return (
      <PageShell title="Roster" backHref="/">
        <div className="h-56 animate-pulse rounded-[28px] bg-white/80" />
      </PageShell>
    );
  }

  if (data === null) {
    return (
      <PageShell title="Roster not found" backHref="/">
        <Card className="px-5 py-8 text-sm text-slate-600">This roster does not exist.</Card>
      </PageShell>
    );
  }

  if (linkSummary === undefined || linkIssues === undefined) {
    return (
      <PageShell title="Roster" backHref="/">
        <div className="h-56 animate-pulse rounded-[28px] bg-white/80" />
      </PageShell>
    );
  }

  if (linkSummary === null || linkIssues === null) {
    return (
      <PageShell title="Roster not found" backHref="/">
        <Card className="px-5 py-8 text-sm text-slate-600">This roster does not exist.</Card>
      </PageShell>
    );
  }

  const attendanceByStudentId = new Map(sessionExport?.rows.map((row) => [row.studentId, row.present]) ?? []);
  const students = data.students.map((student) => {
    const present = attendanceByStudentId.get(student.studentId);
    const status = getStudentSessionStatus({
      hasLatestSession: Boolean(latestSessionId),
      isSessionExportLoading: latestSessionId !== undefined && sessionExport === undefined,
      present,
    });

    return {
      ...student,
      latestStatusLabel: status.label,
      latestStatusTone: status.tone,
    };
  });

  return (
    <PageShell
      title={
        isEditingTitle ? (
          <div className="space-y-3">
            <input
              autoFocus
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              className="font-heading h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-2xl font-semibold tracking-tight text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void handleRename()} disabled={busyKey === "rename"}>
                Save
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setIsEditingTitle(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2">
            <span>{data.roster.name}</span>
            <button
              type="button"
              onClick={() => {
                setDraftTitle(data.roster.name);
                setIsEditingTitle(true);
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
            >
              <Pencil className="h-4 w-4" />
            </button>
          </div>
        )
      }
      backHref="/"
    >
      <ConfirmDialog
        open={deleteOpen}
        title="Delete Roster?"
        description={`Delete roster "${data.roster.name}"? This removes its students, sessions, and attendance history.`}
        confirmLabel="Delete roster"
        tone="danger"
        busy={busyKey === "delete"}
        onConfirm={() => void handleDeleteRoster()}
        onCancel={() => setDeleteOpen(false)}
      />

      <Card className="px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-semibold tracking-tight text-slate-950">
              Attendance Session
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {activeSession
                ? "A live session is open for this roster."
                : "Start a new session when the class is ready to check in."}
            </p>
          </div>
          {activeSession ? (
            <Link href={buildStaffSessionPath(data.roster._id, activeSession._id)}>
              <Button>
                Open session
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          ) : (
            <Button onClick={() => void handleStartSession()} disabled={busyKey === "start" || data.students.length === 0}>
              <Play className="mr-1 h-4 w-4 fill-current" />
              Start session
            </Button>
          )}
        </div>
      </Card>

      <Card className="px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-semibold tracking-tight text-slate-950">
              Participant Linking
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Match roster participants to shared student accounts before or during check-in.
            </p>
          </div>
          <Button variant="outline" onClick={() => void handleAutoLink()} disabled={busyKey === "autolink"}>
            <Sparkles className="mr-1 h-4 w-4" />
            Auto-link
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
            {linkSummary.linkedCount} linked
          </span>
          <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {linkSummary.unlinkedCount} unlinked
          </span>
          <span className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
            {linkSummary.ambiguousCount} ambiguous
          </span>
          <span className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
            {linkSummary.reviewNeededCount} review needed
          </span>
        </div>

        {linkIssues.length > 0 ? (
          <div className="mt-4 space-y-3">
            {linkIssues.map((issue) => (
              <div key={issue.participantId} className="rounded-[24px] border border-slate-200 bg-slate-50/90 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-950">{issue.displayName}</div>
                    <div className="mt-1 text-sm text-slate-500">
                      {issue.studentId || "No student ID"}
                      {issue.schoolEmail ? ` · ${issue.schoolEmail}` : ""}
                    </div>
                  </div>
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getLinkStatusClasses(issue.linkStatus)}`}>
                    {issue.linkStatus.replace("_", " ")}
                  </span>
                </div>

                {issue.candidates.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {issue.candidates.map((candidate) => (
                      <button
                        key={candidate.appUserId}
                        type="button"
                        disabled={busyKey === `link:${issue.participantId}`}
                        onClick={() => void handleLinkParticipant(issue.participantId, candidate.appUserId)}
                        className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-emerald-800 transition hover:bg-emerald-50"
                      >
                        <Link2 className="mr-1 h-4 w-4" />
                        Link {candidate.displayName}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-slate-500">
                    {issue.suggestedReasonCode
                      ? issue.suggestedReasonCode.replace(/_/g, " ")
                      : "No candidate match found yet."}
                  </div>
                )}

                {issue.linkedAppUserId ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      disabled={busyKey === `unlink:${issue.participantId}`}
                      onClick={() => void handleUnlinkParticipant(issue.participantId)}
                      className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
                    >
                      <Unlink2 className="mr-1 h-4 w-4" />
                      Unlink
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 text-sm text-slate-600">All active participants are linked cleanly.</div>
        )}
      </Card>

      {error ? (
        <Card className="border border-rose-200 bg-rose-50/90 px-5 py-4 text-sm text-rose-700">
          {error}
        </Card>
      ) : null}

      <Card className="overflow-hidden px-0 py-0">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-heading text-lg font-semibold tracking-tight text-slate-950">
            Participants
          </h2>
        </div>
        <div className="max-h-[32rem] overflow-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                <th className="px-4 py-3 font-medium text-slate-600">Name</th>
                <th className="px-4 py-3 font-medium text-slate-600">ID</th>
                <th className="px-4 py-3 font-medium text-slate-600">Link</th>
                <th className="px-4 py-3 font-medium text-slate-600">Latest</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {students.map((student) => (
                <tr key={student._id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{student.displayName}</td>
                  <td className="px-4 py-3 text-slate-700">{student.studentId}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getLinkStatusClasses(student.linkStatus)}`}>
                      {student.linkStatus.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                        student.latestStatusTone === "present"
                          ? "bg-emerald-100 text-emerald-800"
                          : student.latestStatusTone === "absent"
                            ? "bg-rose-100 text-rose-700"
                            : student.latestStatusTone === "loading"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {student.latestStatusLabel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <section>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="inline-flex h-11 w-full items-center justify-center rounded-full border border-rose-300 bg-white px-4 text-sm font-medium text-rose-700 transition hover:border-rose-400 hover:text-rose-800"
        >
          <Trash2 className="mr-1 h-4 w-4" />
          Delete roster
        </button>
      </section>
    </PageShell>
  );
}
