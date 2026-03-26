"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { PageShell } from "@/components/page-shell";
import { api } from "@/convex/api";

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
  const seedDemo = useMutation(api.rosters.seedDemo);

  const [rosterName, setRosterName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreateEmpty(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!rosterName.trim()) {
      setError("Roster name is required.");
      return;
    }

    setIsCreating(true);
    try {
      const rosterId = await createEmpty({ name: rosterName.trim() });
      router.push(`/rosters/${rosterId}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create roster.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleSeedDemo() {
    setError(null);
    setIsSeeding(true);
    try {
      const rosterId = await seedDemo({});
      router.push(`/rosters/${rosterId}`);
    } catch (seedError) {
      setError(seedError instanceof Error ? seedError.message : "Could not create demo roster.");
    } finally {
      setIsSeeding(false);
    }
  }

  return (
    <PageShell
      title="Tapcheck"
      subtitle="Mobile-first realtime attendance for teachers taking attendance at the classroom door."
    >
      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-sm">
          <h2 className="text-lg font-semibold tracking-tight text-slate-950">Create roster</h2>
          <form onSubmit={handleCreateEmpty} className="mt-4 space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Roster name</span>
              <input
                value={rosterName}
                onChange={(event) => setRosterName(event.target.value)}
                placeholder="Period 2 Science"
                className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
              />
            </label>
            <button
              type="submit"
              disabled={isCreating}
              className="inline-flex h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isCreating ? "Creating..." : "Create empty roster"}
            </button>
          </form>
        </div>

        <div className="rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-sm">
          <h2 className="text-lg font-semibold tracking-tight text-slate-950">Quick start</h2>
          <div className="mt-4 flex flex-col gap-3">
            <Link
              href="/rosters/import"
              className="inline-flex h-12 items-center justify-center rounded-full bg-emerald-600 px-5 text-sm font-medium text-white transition hover:bg-emerald-500"
            >
              Import SchoolCash CSV
            </Link>
            <button
              type="button"
              onClick={() => void handleSeedDemo()}
              disabled={isSeeding}
              className="inline-flex h-12 items-center justify-center rounded-full border border-slate-300 px-5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
            >
              {isSeeding ? "Creating demo..." : "Seed demo roster"}
            </button>
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-600">
            CSV import includes column mapping and duplicate student ID warnings before anything is saved.
          </p>
        </div>
      </section>

      {error ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <section className="rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-950">Rosters</h2>
            <p className="mt-1 text-sm text-slate-600">Choose a roster to start a live session or review imported students.</p>
          </div>
        </div>

        {rosters === undefined ? (
          <div className="mt-4 h-20 animate-pulse rounded-[24px] bg-slate-100" />
        ) : rosters.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No rosters yet"
              description="Create an empty roster, import a CSV, or seed the demo class to start testing the attendance flow."
            />
          </div>
        ) : (
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
        )}
      </section>
    </PageShell>
  );
}
