"use client";

import { useMutation, useQuery } from "convex/react";
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { getCurrentTimestamp } from "@/lib/time";

type SessionAttendanceScreenProps = {
  token: string;
};

type SortMode = "last" | "first" | "id";

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

  const [search, setSearch] = useState("");
  const [hidePresent, setHidePresent] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("last");
  const [showFilters, setShowFilters] = useState(false);
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
          <h1 className="font-heading mt-3 text-2xl font-semibold tracking-tight text-slate-950">
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

  async function handleToggle(studentRef: Id<"students">) {
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
          <h1 className="font-heading min-w-0 text-2xl font-semibold tracking-tight text-slate-950">
            {session.session.title}
          </h1>
          <div className="shrink-0 rounded-2xl bg-slate-950 px-3 py-3 text-white shadow-sm">
            <div className="flex items-center gap-2 whitespace-nowrap">
              <span className="text-2xl font-semibold leading-none">{session.presentCount}</span>
              <span className="px-1 text-sm font-medium leading-none text-slate-300">
                {session.totalCount}
              </span>
            </div>
          </div>
        </div>
        {error ? (
          <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
      </div>

      <div className="sticky top-0 z-10 mt-4 rounded-[28px] border border-white/70 bg-white/90 px-4 py-4 shadow-sm backdrop-blur">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name or student ID"
            className="h-12 w-full rounded-2xl border border-slate-300 bg-white pl-11 pr-4 text-base text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
          />
        </div>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowFilters((current) => !current)}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Options
            <ChevronDown
              className={`h-4 w-4 transition ${showFilters ? "rotate-180" : ""}`}
            />
          </button>
        </div>
        {showFilters ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">Sort</span>
              <div className="flex rounded-full border border-slate-200 bg-slate-50 p-1">
                {(
                  [
                    { value: "last", label: "Last" },
                    { value: "first", label: "First" },
                    { value: "id", label: "ID" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSortMode(option.value)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition ${
                      sortMode === option.value
                        ? "bg-white text-slate-950 shadow-sm"
                        : "text-slate-500"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={hidePresent}
                onChange={(event) => setHidePresent(event.target.checked)}
                className="h-5 w-5 accent-emerald-600"
              />
              <span>Hide marked</span>
            </label>
          </div>
        ) : null}
      </div>

      <section className="mt-4">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
            Not Yet Marked
          </h2>
          <span className="text-sm text-slate-500">{notYetMarked.length}</span>
        </div>
        <div className="space-y-1.5">
          {notYetMarked.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-slate-300 bg-white/80 px-4 py-6 text-center text-sm text-slate-500">
              No students in this section.
            </div>
          ) : null}
          {notYetMarked.map((student) => (
            <button
              key={student.studentRef}
              type="button"
              onClick={() => void handleToggle(student.studentRef)}
              className="flex min-h-13 w-full items-center rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50/60 active:scale-[0.99]"
            >
              <div>
                <div className="text-base font-semibold text-slate-950">
                  {student.displayName}
                  <span className="ml-2 text-sm font-medium text-slate-500">#{student.studentId}</span>
                </div>
              </div>
            </button>
          ))}
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
          <div className="space-y-1.5">
            {presentStudents.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-slate-300 bg-white/80 px-4 py-6 text-center text-sm text-slate-500">
                No students marked present yet.
              </div>
            ) : null}
            {presentStudents.map((student) => (
              <button
                key={student.studentRef}
                type="button"
                onClick={() => void handleToggle(student.studentRef)}
                className="flex min-h-13 w-full items-center rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-left shadow-sm transition hover:border-emerald-300 hover:bg-emerald-100/70 active:scale-[0.99]"
              >
                <div>
                  <div className="text-base font-semibold text-slate-950">
                    {student.displayName}
                    <span className="ml-2 text-sm font-medium text-emerald-700/80">#{student.studentId}</span>
                  </div>
                  <div className="mt-1 text-sm text-emerald-700">
                    Present{student.markedAt ? ` • ${formatMarkedTime(student.markedAt)}` : ""}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
