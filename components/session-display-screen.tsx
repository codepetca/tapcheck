"use client";

import { useQuery } from "convex/react";
import QRCode from "react-qr-code";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import { getConfiguredAppOrigin, resolveCheckInUrl } from "@/lib/session-links";

type SessionDisplayScreenProps = {
  sessionId: string;
};

export function SessionDisplayScreen({ sessionId }: SessionDisplayScreenProps) {
  const displayContext = useQuery(api.sessions.getDisplayContext, {
    sessionId: sessionId as Id<"sessions">,
  });
  const liveSession = useQuery(api.attendance.getLiveSessionRows, {
    sessionId: sessionId as Id<"sessions">,
  });
  const configuredOrigin = getConfiguredAppOrigin();
  const [runtimeOrigin, setRuntimeOrigin] = useState(configuredOrigin ?? "");

  useEffect(() => {
    if (configuredOrigin || typeof window === "undefined") {
      return;
    }

    setRuntimeOrigin(window.location.origin);
  }, [configuredOrigin]);

  if (displayContext === undefined || liveSession === undefined) {
    return <div className="h-64 animate-pulse rounded-[28px] bg-white/80" />;
  }

  if (displayContext === null || liveSession === null) {
    return <Card className="px-6 py-8 text-center text-sm text-slate-600">This session is unavailable.</Card>;
  }

  const checkInUrl = resolveCheckInUrl(displayContext.checkInToken, runtimeOrigin);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-4 py-8">
      <Card className="px-6 py-8 text-center">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
          {displayContext.rosterName}
        </div>
        <h1 className="font-heading mt-3 text-4xl font-semibold tracking-tight text-slate-950">
          {displayContext.title}
        </h1>
        <div className="mt-6 flex justify-center">
          <div className="rounded-[28px] bg-white p-5 shadow-sm">
            <QRCode value={checkInUrl} className="h-auto w-[280px] max-w-full" />
          </div>
        </div>
        <div className="mt-6 flex justify-center gap-3 text-sm font-semibold">
          <span className="rounded-full bg-emerald-100 px-4 py-2 text-emerald-800">
            {liveSession.counts.present} present
          </span>
          <span className="rounded-full bg-amber-100 px-4 py-2 text-amber-800">
            {liveSession.counts.late} late
          </span>
          <span className="rounded-full bg-slate-100 px-4 py-2 text-slate-600">
            {liveSession.counts.unmarked} unmarked
          </span>
        </div>
      </Card>
    </main>
  );
}
