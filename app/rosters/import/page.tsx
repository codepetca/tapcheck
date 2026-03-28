import { Suspense } from "react";
import { AuthSetupNotice } from "@/components/auth-setup-notice";
import { PageShell } from "@/components/page-shell";
import { RosterImportForm } from "@/components/roster-import-form";
import { isWorkosConfigured, requireAuthenticatedPage } from "@/lib/workos-auth";

export const dynamic = "force-dynamic";

export default async function RosterImportPage() {
  if (!isWorkosConfigured()) {
    return (
      <PageShell title="Import roster" backHref="/">
        <AuthSetupNotice />
      </PageShell>
    );
  }

  await requireAuthenticatedPage("/rosters/import");

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
