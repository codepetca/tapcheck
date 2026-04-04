"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowUpRight, Search, Square, TimerReset, UserCheck, UserRoundX } from "lucide-react";
import Link from "next/link";
import QRCode from "react-qr-code";
import { useDeferredValue, useEffect, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { PageShell } from "@/components/page-shell";
import { PresentTotalPill } from "@/components/present-total-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { buildSessionDisplayPath, getConfiguredAppOrigin, resolveCheckInUrl } from "@/lib/session-links";

type SessionAttendanceScreenProps = {
  rosterId: string;
  sessionId: string;
};

type ManualAttendanceStatus = "present" | "late" | "unmarked";

function formatTimestamp(timestamp?: number) {
  if (!timestamp) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function getStatusClasses(status: "unmarked" | "present" | "late" | "absent") {
  if (status === "present") {
    return "bg-emerald-100 text-emerald-800";
  }

  if (status === "late") {
    return "bg-amber-100 text-amber-800";
  }

  if (status === "absent") {
    return "bg-rose-100 text-rose-700";
  }

  return "bg-slate-100 text-slate-600";
}

function getLinkStatusClasses(status: "linked" | "unlinked" | "ambiguous" | "review_needed") {
  if (status === "linked") {
    return "bg-emerald-50 text-emerald-700";
  }

  if (status === "review_needed" || status === "ambiguous") {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-slate-100 text-slate-600";
}

export function SessionAttendanceScreen({
  rosterId,
  sessionId,
}: SessionAttendanceScreenProps) {
  const session = useQuery(api.attendance.getLiveSessionRows, {
    sessionId: sessionId as Id<"sessions">,
  });
  const closeSession = useMutation(api.sessions.close);
  const markManual = useMutation(api.attendance.markManual);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());
  const configuredOrigin = getConfiguredAppOrigin();
  const [runtimeOrigin, setRuntimeOrigin] = useState(configuredOrigin ?? "");

  useEffect(() => {
    if (configuredOrigin || typeof window === "undefined") {
      return;
    }

    setRuntimeOrigin(window.location.origin);
  }, [configuredOrigin]);

  const displayHref = buildSessionDisplayPath(rosterId, sessionId);

  async function handleManualMark(participantId: Id<"participants">, nextStatus: ManualAttendanceStatus) {
    setError(null);
    const nextBusyKey = `${participantId}:${nextStatus}`;
    setBusyKey(nextBusyKey);

    try {
      await markManual({
        sessionId: sessionId as Id<"sessions">,
        participantId,
        nextStatus,
      });
    } catch (markError) {
      setError(markError instanceof Error ? markError.message : "Could not update attendance.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleCloseSession() {
    setError(null);
    setBusyKey("close-session");
    try {
      await closeSession({ sessionId: sessionId as Id<"sessions"> });
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : "Could not close session.");
    } finally {
      setBusyKey(null);
    }
  }

  if (session === undefined) {
    return (
      <PageShell title="Session" backHref={`/rosters/${rosterId}`}>
        <div className="h-56 animate-pulse rounded-[28px] bg-white/80" />
      </PageShell>
    );
  }

  if (session === null) {
    return (
      <PageShell title="Session not found" backHref={`/rosters/${rosterId}`}>
        <Card className="px-5 py-8 text-sm text-slate-600">This session does not exist.</Card>
      </PageShell>
    );
  }

  const filteredRows = session.rows.filter((row) => {
    if (!deferredSearch) {
      return true;
    }

    const haystack = `${row.displayName} ${row.studentId} ${row.schoolEmail ?? ""}`.toLocaleLowerCase();
    return haystack.includes(deferredSearch);
  });

  return (
    <PageShell
      title={session.session.title}
      subtitle={session.session.status === "open" ? "Live attendance session" : "Closed session"}
      backHref={`/rosters/${rosterId}`}
      headerAction={
        session.session.status === "open" ? (
          <Button
            variant="danger"
            size="sm"
            disabled={busyKey === "close-session"}
            onClick={() => void handleCloseSession()}
          >
            <Square className="mr-1 h-4 w-4" />
            Close
          </Button>
        ) : undefined
      }
    >
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.9fr)]">
        <Card className="px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, ID, or email"
                className="h-12 w-full rounded-2xl border border-slate-300 bg-white pl-11 pr-4 text-base text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
              />
            </div>
            <PresentTotalPill presentCount={session.counts.present} totalCount={session.counts.total} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              {session.counts.late} late
            </span>
            <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              {session.counts.unmarked} unmarked
            </span>
            <span className="inline-flex rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">
              {session.counts.absent} absent
            </span>
          </div>
          {error ? (
            <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
        </Card>

        <Card className="px-4 py-4">
          <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
            <div className="mx-auto max-w-[220px] rounded-[20px] bg-white p-4">
              <QRCode
                value={resolveCheckInUrl(session.session.checkInToken, runtimeOrigin)}
                className="h-auto w-full"
              />
            </div>
          </div>
          <div className="mt-4 space-y-2 text-sm text-slate-600">
            <p>Students scan this QR code to check in with their signed-in account.</p>
            <div className="flex flex-wrap gap-2">
              {runtimeOrigin ? (
                <CopyButton value={resolveCheckInUrl(session.session.checkInToken, runtimeOrigin)} />
              ) : null}
              <Link href={displayHref} className="inline-flex">
                <Button variant="outline">
                  <ArrowUpRight className="mr-1 h-4 w-4" />
                  Open display
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      </section>

      {session.unresolvedEvents.length > 0 ? (
        <Card className="px-4 py-4">
          <h2 className="font-heading text-lg font-semibold tracking-tight text-slate-950">
            Needs Review
          </h2>
          <div className="mt-3 space-y-2">
            {session.unresolvedEvents.map((event, index) => (
              <div
                key={`${event.createdAt}-${index}`}
                className="rounded-[20px] border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900"
              >
                <div className="font-medium">
                  {event.participantName ?? "Unmatched student"}{" "}
                  {event.reasonCode ? `· ${event.reasonCode.replace(/_/g, " ")}` : ""}
                </div>
                <div className="mt-1 text-xs uppercase tracking-[0.14em] text-amber-700">
                  {new Intl.DateTimeFormat(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(event.createdAt)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <section className="space-y-3">
        {filteredRows.map((row) => (
          <Card key={row.participantId} className="px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-base font-semibold text-slate-950">{row.displayName}</h2>
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusClasses(row.status)}`}>
                    {row.status}
                  </span>
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getLinkStatusClasses(row.linkStatus)}`}>
                    {row.linkStatus.replace("_", " ")}
                  </span>
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  {row.studentId || "No student ID"}
                  {row.schoolEmail ? ` · ${row.schoolEmail}` : ""}
                </div>
                {row.lastMarkedAt ? (
                  <div className="mt-2 text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                    Last marked {formatTimestamp(row.lastMarkedAt)}
                  </div>
                ) : null}
              </div>

              <div className="grid shrink-0 grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={session.session.status !== "open" || busyKey !== null}
                  onClick={() => void handleManualMark(row.participantId, "present")}
                  className={`inline-flex h-11 items-center justify-center rounded-full px-3 text-sm font-medium transition ${
                    row.status === "present"
                      ? "bg-emerald-600 text-white"
                      : "border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                  }`}
                >
                  <UserCheck className="mr-1 h-4 w-4" />
                  Present
                </button>
                <button
                  type="button"
                  disabled={session.session.status !== "open" || busyKey !== null}
                  onClick={() => void handleManualMark(row.participantId, "late")}
                  className={`inline-flex h-11 items-center justify-center rounded-full px-3 text-sm font-medium transition ${
                    row.status === "late"
                      ? "bg-amber-500 text-white"
                      : "border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                  }`}
                >
                  <TimerReset className="mr-1 h-4 w-4" />
                  Late
                </button>
                <button
                  type="button"
                  disabled={session.session.status !== "open" || busyKey !== null}
                  onClick={() => void handleManualMark(row.participantId, "unmarked")}
                  className={`inline-flex h-11 items-center justify-center rounded-full px-3 text-sm font-medium transition ${
                    row.status === "unmarked"
                      ? "bg-slate-900 text-white"
                      : "border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:text-slate-950"
                  }`}
                >
                  <UserRoundX className="mr-1 h-4 w-4" />
                  Reset
                </button>
              </div>
            </div>
          </Card>
        ))}
      </section>
    </PageShell>
  );
}
