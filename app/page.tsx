"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageShell } from "@/components/page-shell";
import { api } from "@/convex/api";
import { generateRosterName } from "@/lib/roster-names";

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(timestamp);
}

export default function HomePage() {
  const router = useRouter();
  const rosters = useQuery(api.rosters.list, {});
  const createEmpty = useMutation(api.rosters.createEmpty);

  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreateEmpty() {
    setError(null);

    setIsCreating(true);
    try {
      const rosterId = await createEmpty({ name: generateRosterName() });
      router.push(`/rosters/${rosterId}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create roster.");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <PageShell title="Tapcheck" subtitle="Mobile-first attendance taking">
      <section className="space-y-4">
        <div className="rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-sm">
          <h2 className="font-heading text-lg font-semibold tracking-tight text-slate-950">
            Create a New Roster
          </h2>
          <div className="mt-4 flex flex-col gap-3">
            <Link
              href="/rosters/import"
              className="inline-flex h-14 items-center justify-center rounded-full bg-emerald-600 px-6 text-base font-semibold text-white transition hover:bg-emerald-500"
            >
              Import SchoolCash CSV
            </Link>
            <button
              type="button"
              onClick={() => void handleCreateEmpty()}
              disabled={isCreating}
              className="inline-flex h-14 items-center justify-center rounded-full bg-slate-950 px-6 text-base font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isCreating ? "Creating..." : "Create empty roster"}
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

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
              <Link
                key={roster._id}
                href={`/rosters/${roster._id}`}
                className="block rounded-[24px] border border-slate-200 bg-slate-50/90 px-4 py-4 transition hover:border-emerald-300 hover:bg-emerald-50/60"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">{roster.name}</h3>
                    <p className="mt-1 text-sm text-slate-500">Created {formatDate(roster.createdAt)}</p>
                  </div>
                  <div className="text-right text-sm text-slate-500">
                    <div>{roster.studentCount} students</div>
                    <div>{roster.sessionCount} sessions</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </PageShell>
  );
}
