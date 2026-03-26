"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { use } from "react";
import { PageShell } from "@/components/page-shell";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";

function formatDate(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

export default function RosterDetailPage({
  params,
}: {
  params: Promise<{ rosterId: string }>;
}) {
  const resolved = use(params);
  const data = useQuery(api.rosters.getById, {
    rosterId: resolved.rosterId as Id<"rosters">,
  });

  if (data === undefined) {
    return (
      <PageShell title="Roster" backHref="/" backLabel="All rosters">
        <div className="h-40 animate-pulse rounded-[28px] bg-white/80" />
      </PageShell>
    );
  }

  if (data === null) {
    return (
      <PageShell title="Roster not found" backHref="/" backLabel="All rosters">
        <div className="rounded-[28px] border border-white/70 bg-white/90 px-5 py-8 text-sm text-slate-600 shadow-sm">
          This roster does not exist.
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={data.roster.name}
      subtitle={`${data.students.length} students • ${data.sessions.length} sessions`}
      backHref="/"
      backLabel="All rosters"
    >
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-[24px] border border-white/70 bg-white/90 p-5 shadow-sm">
          <div className="text-sm text-slate-500">Students</div>
          <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
            {data.students.length}
          </div>
        </div>
        <div className="rounded-[24px] border border-white/70 bg-white/90 p-5 shadow-sm">
          <div className="text-sm text-slate-500">Sessions</div>
          <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
            {data.sessions.length}
          </div>
        </div>
        <div className="rounded-[24px] border border-white/70 bg-white/90 p-5 shadow-sm">
          <div className="text-sm text-slate-500">Actions</div>
          <div className="mt-3 flex flex-col gap-3">
            <Link
              href={`/rosters/${data.roster._id}/sessions/new`}
              className="inline-flex h-11 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              Start session
            </Link>
            <Link
              href="/rosters/import"
              className="inline-flex h-11 items-center justify-center rounded-full border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
            >
              Import another roster
            </Link>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-950">Students</h2>
            <p className="mt-1 text-sm text-slate-600">Alphabetical by last name, then first name.</p>
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

      <section className="rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-sm">
        <h2 className="text-lg font-semibold tracking-tight text-slate-950">Recent sessions</h2>
        {data.sessions.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No sessions yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {data.sessions.map((session) => (
              <Link
                key={session._id}
                href={`/sessions/${session._id}/share`}
                className="flex items-center justify-between rounded-[24px] border border-slate-200 bg-slate-50/90 px-4 py-4 transition hover:border-emerald-300 hover:bg-emerald-50/60"
              >
                <div>
                  <div className="font-semibold text-slate-950">{session.title}</div>
                  <div className="mt-1 text-sm text-slate-500">{formatDate(session.date)}</div>
                </div>
                <span className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Share links
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </PageShell>
  );
}
