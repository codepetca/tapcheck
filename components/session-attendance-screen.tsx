"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { getCurrentTimestamp } from "@/lib/time";

type SessionAttendanceScreenProps = {
  token: string;
  mode: "editor" | "viewer";
};

function formatMarkedTime(timestamp?: number) {
  if (!timestamp) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

export function SessionAttendanceScreen({
  token,
  mode,
}: SessionAttendanceScreenProps) {
  const editorSession = useQuery(
    api.attendance.getEditorSessionByToken,
    mode === "editor" ? { token } : "skip",
  );
  const viewerSession = useQuery(
    api.attendance.getViewerSessionByToken,
    mode === "viewer" ? { token } : "skip",
  );
  const session = mode === "editor" ? editorSession : viewerSession;

  const [search, setSearch] = useState("");
  const [hidePresent, setHidePresent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());

  const toggleAttendance = useMutation(api.attendance.toggleByEditorToken).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.attendance.getEditorSessionByToken, {
        token: args.token,
      });

      if (!current) {
        return;
      }

      const row = current.students.find((student) => student.studentRef === args.studentRef);
      if (!row) {
        return;
      }

      const now = args.clientNow;
      const nextPresent = !row.present;

      localStore.setQuery(
        api.attendance.getEditorSessionByToken,
        { token: args.token },
        {
          ...current,
          presentCount: current.presentCount + (nextPresent ? 1 : -1),
          students: current.students.map((student) =>
            student.studentRef === args.studentRef
              ? {
                  ...student,
                  present: nextPresent,
                  markedAt: nextPresent ? now : undefined,
                  modifiedAt: now,
                  lastModifiedAt: now,
                }
              : student,
          ),
        },
      );
    },
  );

  if (session === undefined) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-4 sm:px-6">
        <div className="rounded-[28px] border border-white/70 bg-white/90 px-5 py-6 shadow-sm">
          <div className="h-6 w-44 animate-pulse rounded-full bg-slate-200" />
          <div className="mt-3 h-4 w-28 animate-pulse rounded-full bg-slate-200" />
        </div>
      </main>
    );
  }

  if (session === null) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-4 py-8 sm:px-6">
        <div className="rounded-[28px] border border-white/70 bg-white px-6 py-10 text-center shadow-sm">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-400">
            Invalid link
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
            This attendance link is not available.
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Check the link and try again. If the problem continues, create a new session
            share link.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex h-11 items-center justify-center rounded-full border border-slate-300 px-5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
          >
            Go to rosters
          </Link>
        </div>
      </main>
    );
  }

  const filteredStudents = session.students.filter((student) => {
    if (!deferredSearch) {
      return true;
    }

    const haystack = `${student.displayName} ${student.studentId} ${student.rawName}`.toLocaleLowerCase();
    return haystack.includes(deferredSearch);
  });

  const notYetMarked = filteredStudents.filter((student) => !student.present);
  const presentStudents = filteredStudents.filter((student) => student.present);

  async function handleToggle(studentRef: Id<"students">) {
    if (mode !== "editor") {
      return;
    }

    setError(null);
    try {
      await toggleAttendance({
        token,
        studentRef,
        clientNow: getCurrentTimestamp(),
      });
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Unable to update attendance.");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-3 py-3 sm:px-6">
      <div className="rounded-[30px] border border-emerald-100 bg-[linear-gradient(180deg,#ffffff_0%,#f2fbf7_100%)] px-5 py-5 shadow-sm ring-1 ring-slate-950/5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">
              {mode === "editor" ? "Editor" : "Viewer"}
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              {session.session.title}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {session.roster.name} • {session.session.date}
            </p>
          </div>
          <div className="rounded-2xl bg-slate-950 px-4 py-3 text-right text-white shadow-sm">
            <div className="text-2xl font-semibold leading-none">{session.presentCount}</div>
            <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-300">
              of {session.totalCount} present
            </div>
          </div>
        </div>
        {mode === "viewer" ? (
          <p className="mt-4 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-600">
            Read-only live view. Attendance updates will appear automatically.
          </p>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
      </div>

      <div className="sticky top-0 z-10 mt-4 rounded-[28px] border border-white/70 bg-white/90 px-4 py-4 shadow-sm backdrop-blur">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Search</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name or student ID"
            className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
          />
        </label>
        <label className="mt-3 flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <span>Hide present students</span>
          <input
            type="checkbox"
            checked={hidePresent}
            onChange={(event) => setHidePresent(event.target.checked)}
            className="h-5 w-5 accent-emerald-600"
          />
        </label>
      </div>

      <section className="mt-4">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
            Not Yet Marked
          </h2>
          <span className="text-sm text-slate-500">{notYetMarked.length}</span>
        </div>
        <div className="space-y-3">
          {notYetMarked.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-slate-300 bg-white/80 px-4 py-6 text-center text-sm text-slate-500">
              No students in this section.
            </div>
          ) : null}
          {notYetMarked.map((student) =>
            mode === "editor" ? (
              <button
                key={student.studentRef}
                type="button"
                onClick={() => void handleToggle(student.studentRef)}
                className="flex min-h-16 w-full items-center justify-between rounded-[24px] border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50/60 active:scale-[0.99]"
              >
                <div>
                  <div className="text-base font-semibold text-slate-950">{student.displayName}</div>
                  <div className="mt-1 text-sm text-slate-500">#{student.studentId}</div>
                </div>
                <span className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Tap to mark
                </span>
              </button>
            ) : (
              <div
                key={student.studentRef}
                className="flex min-h-16 items-center justify-between rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-sm"
              >
                <div>
                  <div className="text-base font-semibold text-slate-950">{student.displayName}</div>
                  <div className="mt-1 text-sm text-slate-500">#{student.studentId}</div>
                </div>
              </div>
            ),
          )}
        </div>
      </section>

      {!hidePresent ? (
        <section className="mt-6 pb-8">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-emerald-700">
              Present
            </h2>
            <span className="text-sm text-slate-500">{presentStudents.length}</span>
          </div>
          <div className="space-y-3">
            {presentStudents.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-slate-300 bg-white/80 px-4 py-6 text-center text-sm text-slate-500">
                No students marked present yet.
              </div>
            ) : null}
            {presentStudents.map((student) =>
              mode === "editor" ? (
                <button
                  key={student.studentRef}
                  type="button"
                  onClick={() => void handleToggle(student.studentRef)}
                  className="flex min-h-16 w-full items-center justify-between rounded-[24px] border border-emerald-200 bg-emerald-50 px-4 py-4 text-left shadow-sm transition hover:border-emerald-300 hover:bg-emerald-100/70 active:scale-[0.99]"
                >
                  <div>
                    <div className="text-base font-semibold text-slate-950">{student.displayName}</div>
                    <div className="mt-1 text-sm text-emerald-700">
                      Present{student.markedAt ? ` • ${formatMarkedTime(student.markedAt)}` : ""}
                    </div>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
                    Tap to undo
                  </span>
                </button>
              ) : (
                <div
                  key={student.studentRef}
                  className="flex min-h-16 items-center justify-between rounded-[24px] border border-emerald-200 bg-emerald-50 px-4 py-4 shadow-sm"
                >
                  <div>
                    <div className="text-base font-semibold text-slate-950">{student.displayName}</div>
                    <div className="mt-1 text-sm text-emerald-700">
                      Present{student.markedAt ? ` • ${formatMarkedTime(student.markedAt)}` : ""}
                    </div>
                  </div>
                </div>
              ),
            )}
          </div>
        </section>
      ) : null}
    </main>
  );
}
