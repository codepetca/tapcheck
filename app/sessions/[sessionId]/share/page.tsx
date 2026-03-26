"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { use } from "react";
import { CopyButton } from "@/components/copy-button";
import { PageShell } from "@/components/page-shell";
import { api } from "@/convex/api";
import type { Id } from "@/convex/model";
import {
  buildAbsoluteUrl,
  buildEditorPath,
  buildViewerPath,
} from "@/lib/session-links";

function ShareLinkCard({
  label,
  description,
  path,
  fullUrl,
}: {
  label: string;
  description: string;
  path: string;
  fullUrl: string;
}) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-slate-50/90 p-4">
      <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
      <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 break-all">
        {fullUrl}
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <CopyButton value={fullUrl} />
        <Link
          href={path}
          target="_blank"
          className="inline-flex h-11 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          Open
        </Link>
      </div>
    </div>
  );
}

export default function SessionSharePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const resolved = use(params);
  const data = useQuery(api.sessions.getSharePageData, {
    sessionId: resolved.sessionId as Id<"sessions">,
  });
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  if (data === undefined) {
    return (
      <PageShell title="Share session" backHref="/" backLabel="All rosters">
        <div className="h-40 animate-pulse rounded-[28px] bg-white/80" />
      </PageShell>
    );
  }

  if (data === null) {
    return (
      <PageShell title="Share session" backHref="/" backLabel="All rosters">
        <div className="rounded-[28px] border border-white/70 bg-white/90 px-5 py-8 text-sm text-slate-600 shadow-sm">
          This session could not be found.
        </div>
      </PageShell>
    );
  }

  const editorPath = buildEditorPath(data.session.editorToken);
  const viewerPath = buildViewerPath(data.session.viewerToken);
  const editorUrl = origin ? buildAbsoluteUrl(origin, editorPath) : editorPath;
  const viewerUrl = origin ? buildAbsoluteUrl(origin, viewerPath) : viewerPath;

  return (
    <PageShell
      title="Share links"
      subtitle={`${data.session.title} • ${data.roster.name}`}
      backHref={`/rosters/${data.roster._id}`}
      backLabel="Roster"
    >
      <section className="rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-sm">
        <h2 className="text-lg font-semibold tracking-tight text-slate-950">Session ready</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Share the editor link with anyone taking attendance. Share the viewer link for a read-only live view.
        </p>
      </section>

      <section className="grid gap-4">
        <ShareLinkCard
          label="Editor link"
          description="Can mark students present or undo attendance in realtime."
          path={editorPath}
          fullUrl={editorUrl}
        />
        <ShareLinkCard
          label="Viewer link"
          description="Read-only live attendance display."
          path={viewerPath}
          fullUrl={viewerUrl}
        />
      </section>
    </PageShell>
  );
}
