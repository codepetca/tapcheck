"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { createShareToken } from "@/lib/session-links";

function today() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function SessionCreationPage({
  params,
}: {
  params: Promise<{ rosterId: string }>;
}) {
  const resolved = use(params);
  const router = useRouter();
  const roster = useQuery(api.rosters.getById, {
    rosterId: resolved.rosterId as Id<"rosters">,
  });
  const createSession = useMutation(api.sessions.create);

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (roster && !title) {
      setTitle(`${roster.roster.name} Attendance`);
    }
  }, [roster, title]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roster) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const sessionId = await createSession({
        rosterId: roster.roster._id,
        title: title.trim(),
        date,
        editorToken: createShareToken(),
        viewerToken: createShareToken(),
      });
      router.push(`/sessions/${sessionId}/share`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create session.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (roster === undefined) {
    return (
      <PageShell title="Create session" backHref={`/rosters/${resolved.rosterId}`} backLabel="Roster">
        <div className="h-40 animate-pulse rounded-[28px] bg-white/80" />
      </PageShell>
    );
  }

  if (roster === null) {
    return (
      <PageShell title="Create session" backHref="/" backLabel="All rosters">
        <div className="rounded-[28px] border border-white/70 bg-white/90 px-5 py-8 text-sm text-slate-600 shadow-sm">
          This roster does not exist.
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Create live session"
      subtitle={`Start a mobile attendance session for ${roster.roster.name}.`}
      backHref={`/rosters/${roster.roster._id}`}
      backLabel="Roster"
    >
      <form
        onSubmit={handleSubmit}
        className="rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-sm"
      >
        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Session title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Date</span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
            />
          </label>

          {error ? (
            <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSubmitting ? "Creating..." : "Create session"}
          </button>
        </div>
      </form>
    </PageShell>
  );
}
