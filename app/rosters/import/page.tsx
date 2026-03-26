import { Suspense } from "react";
import { PageShell } from "@/components/page-shell";
import { RosterImportForm } from "@/components/roster-import-form";

export default function RosterImportPage() {
  return (
    <PageShell title="Import roster" backHref="/">
      <Suspense
        fallback={<div className="h-64 animate-pulse rounded-[28px] border border-white/70 bg-white/90" />}
      >
        <RosterImportForm />
      </Suspense>
    </PageShell>
  );
}
