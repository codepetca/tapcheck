import { PageShell } from "@/components/page-shell";
import { AuthSetupNotice } from "@/components/auth-setup-notice";
import { HomePageContent } from "@/components/home-page-content";
import { SignOutForm } from "@/components/sign-out-form";
import { isWorkosConfigured, requireAuthenticatedPage } from "@/lib/workos-auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!isWorkosConfigured()) {
    return (
      <PageShell title="Tapcheck" subtitle="Mobile-first attendance taking">
        <AuthSetupNotice />
      </PageShell>
    );
  }

  const user = await requireAuthenticatedPage("/");
  const userLabel = user.email?.trim() || "authenticated account";

  return (
    <PageShell
      title="Tapcheck"
      subtitle={`Signed in as ${userLabel}`}
      headerAction={<SignOutForm className="px-4" />}
    >
      <HomePageContent />
    </PageShell>
  );
}
