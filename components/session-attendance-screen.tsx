"use client";

import { useMutation, useQuery } from "convex/react";
import { Search, X } from "lucide-react";
import Link from "next/link";
import type { Dispatch, SetStateAction } from "react";
import { useDeferredValue, useState } from "react";
import { PresentTotalPill } from "@/components/present-total-pill";
import { Card } from "@/components/ui/card";
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
  const [exitingStudentRefs, setExitingStudentRefs] = useState<Set<Id<"participants">>>(() => new Set());
  const [submittingStudentRefs, setSubmittingStudentRefs] = useState<Set<Id<"participants">>>(
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
    studentRef: Id<"participants">,
    setter: Dispatch<SetStateAction<Set<Id<"participants">>>>,
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

  async function handleToggle(studentRef: Id<"participants">) {
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
      setSearch("");
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Unable to update attendance.");
    } finally {
      setStudentTransitionState(studentRef, setExitingStudentRefs, false);
      setStudentTransitionState(studentRef, setSubmittingStudentRefs, false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-3 py-3 sm:px-6">
      <Card className="rounded-[30px] border-emerald-100 bg-[linear-gradient(180deg,#ffffff_0%,#f2fbf7_100%)] px-4 py-4">
        <h1 className="font-heading truncate text-center text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">
          {session.session.title}
        </h1>
      </Card>

      <div className="sticky top-3 z-10 mt-4">
        <Card className="rounded-[30px] bg-white px-4 py-4">
          <div className="flex items-stretch gap-3">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name or student ID"
                className="h-12 w-full rounded-2xl border border-slate-300 bg-white pl-11 pr-12 text-base text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <PresentTotalPill presentCount={session.presentCount} totalCount={session.totalCount} />
          </div>
          {error ? (
            <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
          <div className="mt-4">
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
              ID
            </button>
          </div>
          </div>
        </Card>
      </div>

      <section className="mt-4">
        <div>
          {notYetMarked.map((student) => {
            const isSubmitting = submittingStudentRefs.has(student.studentRef);
            const isExiting = exitingStudentRefs.has(student.studentRef);

            return (
              <div
                key={student.studentRef}
                className={cn(
                  "grid overflow-hidden transition-[grid-template-rows,margin-bottom,opacity] duration-180 ease-in",
                  isExiting ? "mb-0 grid-rows-[0fr] opacity-80" : "mb-1.5 grid-rows-[1fr] opacity-100 last:mb-0",
                )}
              >
                <div className="min-h-0">
                  <button
                    type="button"
                    onClick={() => void handleToggle(student.studentRef)}
                    disabled={isSubmitting}
                    aria-busy={isSubmitting}
                    className={cn(
                      "grid min-h-13 w-full origin-top items-center gap-3 rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition-[transform,opacity,background-color,border-color] duration-180 ease-out hover:border-emerald-300 hover:bg-emerald-50/60 active:scale-[0.99] disabled:cursor-wait",
                      isExiting && "pointer-events-none scale-y-75 opacity-40",
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
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-6 pb-8">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-emerald-700">
            Present
          </h2>
          <span className="text-sm text-slate-500">{presentStudents.length}</span>
        </div>
        <div>
          {presentStudents.map((student) => {
            const isSubmitting = submittingStudentRefs.has(student.studentRef);
            const isExiting = exitingStudentRefs.has(student.studentRef);

            return (
              <div
                key={student.studentRef}
                className={cn(
                  "grid overflow-hidden transition-[grid-template-rows,margin-bottom,opacity] duration-180 ease-in",
                  isExiting ? "mb-0 grid-rows-[0fr] opacity-80" : "mb-1.5 grid-rows-[1fr] opacity-100 last:mb-0",
                )}
              >
                <div className="min-h-0">
                  <button
                    type="button"
                    onClick={() => void handleToggle(student.studentRef)}
                    disabled={isSubmitting}
                    aria-busy={isSubmitting}
                    className={cn(
                      "grid min-h-13 w-full origin-top items-center gap-3 rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-left shadow-sm transition-[transform,opacity,background-color,border-color] duration-180 ease-out hover:border-emerald-300 hover:bg-emerald-100/70 active:scale-[0.99] disabled:cursor-wait",
                      isExiting && "pointer-events-none scale-y-75 opacity-40",
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
                      {student.markedAt ? (
                        <div className="mt-1 text-xs font-medium text-emerald-700">
                          {formatMarkedTime(student.markedAt)}
                        </div>
                      ) : null}
                    </div>
                    <div className="text-left text-sm font-medium text-emerald-700/80">{student.studentId}</div>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
