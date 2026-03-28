import { RosterDetailPageClient } from "@/components/roster-detail-page-client";
import { AuthSetupNotice } from "@/components/auth-setup-notice";
import { PageShell } from "@/components/page-shell";
import { isWorkosConfigured, requireAuthenticatedPage } from "@/lib/workos-auth";

export const dynamic = "force-dynamic";

export default async function RosterDetailPage({
  params,
}: {
  params: Promise<{ rosterId: string }>;
}) {
  const { rosterId } = await params;

  if (!isWorkosConfigured()) {
    return (
      <PageShell title="Tapcheck" subtitle="Roster management">
        <AuthSetupNotice />
      </PageShell>
    );
  }

  const user = await requireAuthenticatedPage(`/rosters/${rosterId}`);

  return <RosterDetailPageClient rosterId={rosterId} viewerEmail={user.email?.trim() || null} />;
}
