"use client";

import { useMutation, useQuery } from "convex/react";
import { Search } from "lucide-react";
import Link from "next/link";
import type { Dispatch, SetStateAction } from "react";
import { useDeferredValue, useState } from "react";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { cn } from "@/lib/cn";
import { getCurrentTimestamp } from "@/lib/time";

type SessionAttendanceScreenProps = {
  token: string;
};

type SortMode = "last" | "first" | "id";

const ATTENDANCE_TAP_EXIT_MS = 160;

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
}: SessionAttendanceScreenProps) {
  const session = useQuery(api.attendance.getEditorSessionByToken, { token });
  const studentGridTemplateColumns = "minmax(0, 1fr) minmax(0, 1fr) minmax(7rem, 0.9fr)";

  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("last");
  const [error, setError] = useState<string | null>(null);
  const [exitingStudentRefs, setExitingStudentRefs] = useState<Set<Id<"students">>>(() => new Set());
  const [submittingStudentRefs, setSubmittingStudentRefs] = useState<Set<Id<"students">>>(
    () => new Set(),
  );
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
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-950">
            This attendance link is not available.
          </h1>
          <Link
            href="/login"
            className="mt-6 inline-flex h-11 items-center justify-center rounded-full border border-slate-300 px-5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
          >
            Sign in to manage rosters
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

  const sortedStudents = [...filteredStudents].sort((left, right) => {
    if (sortMode === "id") {
      return left.studentId.localeCompare(right.studentId, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }

    if (sortMode === "first") {
      return (
        left.firstName.localeCompare(right.firstName, undefined, { sensitivity: "base" }) ||
        left.lastName.localeCompare(right.lastName, undefined, { sensitivity: "base" }) ||
        left.studentId.localeCompare(right.studentId, undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );
    }

    return (
      left.lastName.localeCompare(right.lastName, undefined, { sensitivity: "base" }) ||
      left.firstName.localeCompare(right.firstName, undefined, { sensitivity: "base" }) ||
      left.studentId.localeCompare(right.studentId, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
  });

  const notYetMarked = sortedStudents.filter((student) => !student.present);
  const presentStudents = sortedStudents.filter((student) => student.present);

  function handleSort(nextSortMode: SortMode) {
    setSortMode(nextSortMode);
  }

  function setStudentTransitionState(
    studentRef: Id<"students">,
    setter: Dispatch<SetStateAction<Set<Id<"students">>>>,
    active: boolean,
  ) {
    setter((current) => {
      const next = new Set(current);

      if (active) {
        next.add(studentRef);
      } else {
        next.delete(studentRef);
      }

      return next;
    });
  }

  async function handleToggle(studentRef: Id<"students">) {
    if (submittingStudentRefs.has(studentRef)) {
      return;
    }

    setError(null);
    setStudentTransitionState(studentRef, setSubmittingStudentRefs, true);
    setStudentTransitionState(studentRef, setExitingStudentRefs, true);

    try {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, ATTENDANCE_TAP_EXIT_MS);
      });

      setStudentTransitionState(studentRef, setExitingStudentRefs, false);
      await toggleAttendance({
        token,
        studentRef,
        clientNow: getCurrentTimestamp(),
      });
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Unable to update attendance.");
    } finally {
      setStudentTransitionState(studentRef, setExitingStudentRefs, false);
      setStudentTransitionState(studentRef, setSubmittingStudentRefs, false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-3 py-3 sm:px-6">
      <div className="rounded-[30px] border border-emerald-100 bg-[linear-gradient(180deg,#ffffff_0%,#f2fbf7_100%)] px-4 py-4 shadow-sm ring-1 ring-slate-950/5">
        <h1 className="font-heading truncate text-center text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">
          {session.session.title}
        </h1>
        <div className="mt-4 flex items-stretch gap-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name or student ID"
              className="h-12 w-full rounded-2xl border border-slate-300 bg-white pl-11 pr-4 text-base text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
            />
          </div>
          <div
            aria-label={`${session.presentCount} of ${session.totalCount} students marked present`}
            className="inline-flex shrink-0 items-stretch overflow-hidden rounded-full bg-slate-950 text-white shadow-sm"
          >
            <span className="flex min-w-14 items-center justify-center px-4 text-2xl font-semibold leading-none">
              {session.presentCount}
            </span>
            <span className="flex min-w-12 items-center justify-center border-l border-slate-700 bg-slate-700 px-4 text-lg font-medium leading-none text-slate-200">
              {session.totalCount}
            </span>
          </div>
        </div>
        {error ? (
          <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
      </div>

      <div className="sticky top-0 z-10 mt-4">
        <div className="px-4 py-0">
          <div
            className="grid items-center gap-3 px-2 text-left font-semibold uppercase tracking-[0.16em]"
            style={{ gridTemplateColumns: studentGridTemplateColumns }}
          >
            <button
              type="button"
              onClick={() => handleSort("first")}
              className={`truncate border-b-2 py-0.5 text-left leading-none transition ${
                sortMode === "first"
                  ? "border-slate-300 text-base text-slate-950"
                  : "border-transparent text-base text-slate-500 hover:text-slate-950"
              }`}
            >
              First
            </button>
            <button
              type="button"
              onClick={() => handleSort("last")}
              className={`truncate border-b-2 py-0.5 text-left leading-none transition ${
                sortMode === "last"
                  ? "border-slate-300 text-base text-slate-950"
                  : "border-transparent text-base text-slate-500 hover:text-slate-950"
              }`}
            >
              Last
            </button>
            <button
              type="button"
              onClick={() => handleSort("id")}
              className={`border-b-2 py-0.5 text-left leading-none transition ${
                sortMode === "id"
                  ? "border-slate-300 text-base text-slate-950"
                  : "border-transparent text-base text-slate-500 hover:text-slate-950"
              }`}
            >
              Student ID
            </button>
          </div>
        </div>
      </div>

      <section className="mt-4">
        <div className="space-y-1.5">
          {notYetMarked.map((student) => (
            <button
              key={student.studentRef}
              type="button"
              onClick={() => void handleToggle(student.studentRef)}
              disabled={submittingStudentRefs.has(student.studentRef)}
              aria-busy={submittingStudentRefs.has(student.studentRef)}
              className={cn(
                "grid min-h-13 w-full items-center gap-3 rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition-[transform,opacity,background-color,border-color] duration-180 ease-out hover:border-emerald-300 hover:bg-emerald-50/60 active:scale-[0.99] disabled:cursor-wait",
                exitingStudentRefs.has(student.studentRef) && "pointer-events-none translate-y-1 scale-[0.985] opacity-0",
              )}
              style={{ gridTemplateColumns: studentGridTemplateColumns }}
            >
              <div className="min-w-0 text-base font-semibold text-slate-950">
                <span className="block truncate">{student.firstName || " "}</span>
              </div>
              <div className="min-w-0 text-base font-semibold text-slate-950">
                <span className="block truncate">{student.lastName || student.displayName}</span>
              </div>
              <div className="text-left text-sm font-medium text-slate-500">{student.studentId}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-6 pb-8">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-emerald-700">
            Present
          </h2>
          <span className="text-sm text-slate-500">{presentStudents.length}</span>
        </div>
        <div className="space-y-1.5">
          {presentStudents.map((student) => (
            <button
              key={student.studentRef}
              type="button"
              onClick={() => void handleToggle(student.studentRef)}
              disabled={submittingStudentRefs.has(student.studentRef)}
              aria-busy={submittingStudentRefs.has(student.studentRef)}
              className={cn(
                "grid min-h-13 w-full items-center gap-3 rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-left shadow-sm transition-[transform,opacity,background-color,border-color] duration-180 ease-out hover:border-emerald-300 hover:bg-emerald-100/70 active:scale-[0.99] disabled:cursor-wait",
                exitingStudentRefs.has(student.studentRef) && "pointer-events-none translate-y-1 scale-[0.985] opacity-0",
              )}
              style={{ gridTemplateColumns: studentGridTemplateColumns }}
            >
              <div className="min-w-0 text-base font-semibold text-slate-950">
                <span className="block truncate">{student.firstName || " "}</span>
              </div>
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-slate-950">
                  {student.lastName || student.displayName}
                </div>
                <div className="mt-1 text-xs font-medium text-emerald-700">
                  Present{student.markedAt ? ` • ${formatMarkedTime(student.markedAt)}` : ""}
                </div>
              </div>
              <div className="text-left text-sm font-medium text-emerald-700/80">{student.studentId}</div>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
