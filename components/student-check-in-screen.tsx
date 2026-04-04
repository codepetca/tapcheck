"use client";

import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCurrentAppUser } from "@/components/use-current-app-user";
import { Card } from "@/components/ui/card";
import { api } from "@/convex/api";

type StudentCheckInScreenProps = {
  token: string;
};

export function StudentCheckInScreen({ token }: StudentCheckInScreenProps) {
  const context = useQuery(api.sessions.getCheckInContext, { token });
  const checkIn = useMutation(api.attendance.studentCheckIn);
  const { bootstrapError, isReady } = useCurrentAppUser();
  const [result, setResult] = useState<Awaited<ReturnType<typeof checkIn>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasSubmittedRef = useRef(false);

  useEffect(() => {
    if (!isReady || context === undefined || context === null || hasSubmittedRef.current || bootstrapError) {
      return;
    }

    hasSubmittedRef.current = true;

    void checkIn({ token })
      .then((response) => {
        setResult(response);
      })
      .catch((checkInError) => {
        setError(checkInError instanceof Error ? checkInError.message : "Could not complete check-in.");
      });
  }, [bootstrapError, checkIn, context, isReady, token]);

  const tone = result?.tone ?? (error ? "red" : null);
  const toneClasses =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50/90 text-emerald-900"
      : tone === "yellow"
        ? "border-amber-200 bg-amber-50/90 text-amber-900"
        : tone === "red"
          ? "border-rose-200 bg-rose-50/90 text-rose-900"
          : "border-white/70 bg-white/90 text-slate-950";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-8">
      <Card className={`w-full px-6 py-8 text-center ${toneClasses}`}>
        {tone === "green" ? (
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-700" />
        ) : tone === "yellow" ? (
          <AlertTriangle className="mx-auto h-10 w-10 text-amber-700" />
        ) : tone === "red" ? (
          <XCircle className="mx-auto h-10 w-10 text-rose-700" />
        ) : null}

        <div className="mt-4">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            {result?.title ??
              (error
                ? "Check-in failed"
                : context === null
                  ? "Check-in link is invalid"
                  : "Checking you in")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-current/80">
            {result?.description ??
              error ??
              (bootstrapError
                ? bootstrapError
                : context === null
                  ? "Ask your teacher for the current classroom QR code."
                  : context === undefined || !isReady
                    ? "Verifying your account for this attendance session."
                    : `${context.session.title} · ${context.roster.name}`)}
          </p>
        </div>

        {context && context !== null ? (
          <div className="mt-6 rounded-[24px] border border-current/10 bg-white/60 px-4 py-4 text-left text-sm text-slate-700">
            <div className="font-semibold text-slate-950">{context.session.title}</div>
            <div className="mt-1">{context.roster.name}</div>
            <div className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">
              {context.session.status === "open" ? "Session open" : "Session closed"}
            </div>
          </div>
        ) : null}
      </Card>
    </main>
  );
}
