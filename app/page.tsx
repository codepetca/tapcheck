"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { api } from "@/convex/api";
import { getSessionStatusBadge } from "@/lib/roster-status";

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(timestamp);
}

export default function HomePage() {
  const rosters = useQuery(api.rosters.list, {});

  return (
    <PageShell title="Tapcheck" subtitle="Mobile-first attendance taking">
      <section className="space-y-4">
        <div className="overflow-hidden rounded-[28px] border border-white/70 bg-white/90 shadow-sm">
          <Link
            href="/rosters/import"
            className="inline-flex h-16 w-full items-center justify-center bg-slate-950 px-6 text-base font-semibold text-white transition hover:bg-slate-800"
          >
            Create a New Roster
          </Link>
        </div>
      </section>

      {rosters !== undefined && rosters.length > 0 ? (
        <section className="rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-heading text-lg font-semibold tracking-tight text-slate-950">
                Manage a Roster
              </h2>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {rosters.map((roster) => (
              (() => {
                const sessionStatus = getSessionStatusBadge(roster.hasActiveSession === true);

                return (
                  <Link
                    key={roster._id}
                    href={`/rosters/${roster._id}`}
                    className={`block rounded-[24px] px-4 py-4 transition ${
                      roster.hasActiveSession
                        ? "border border-emerald-200 bg-emerald-100/80 hover:bg-emerald-100"
                        : "border border-slate-200 bg-slate-50/90 hover:border-emerald-300 hover:bg-emerald-50/60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-base font-semibold text-slate-950">{roster.name}</h3>
                        <p className="mt-1 text-sm text-slate-500">Created {formatDate(roster.createdAt)}</p>
                      </div>
                      <div className="text-right text-sm text-slate-500">
                        <div>{roster.studentCount} students</div>
                        {sessionStatus ? (
                          <div className="mt-1">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${sessionStatus.className}`}
                            >
                              {sessionStatus.label}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </Link>
                );
              })()
            ))}
          </div>
        </section>
      ) : null}
    </PageShell>
  );
}
