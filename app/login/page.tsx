import { PageShell } from "@/components/page-shell";
import { AuthSetupNotice } from "@/components/auth-setup-notice";
import { buttonVariants } from "@/components/ui/button";
import {
  getAuthEntryPath,
  isWorkosConfigured,
  redirectAuthenticatedUser,
  sanitizeReturnPath,
} from "@/lib/workos-auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isWorkosConfigured()) {
    return (
      <PageShell title="Tapcheck" subtitle="Sign in">
        <AuthSetupNotice />
      </PageShell>
    );
  }

  const resolvedSearchParams = await searchParams;
  const returnToParam = resolvedSearchParams.returnTo;
  const returnTo = sanitizeReturnPath(
    Array.isArray(returnToParam) ? returnToParam[0] : returnToParam,
  );

  await redirectAuthenticatedUser(returnTo);
  const signInUrl = getAuthEntryPath("sign-in", returnTo);
  const signUpUrl = getAuthEntryPath("sign-up", returnTo);

  return (
    <PageShell title="Tapcheck" subtitle="Sign in to manage your rosters">
      <section className="space-y-3">
        <a href={signInUrl} className={buttonVariants({ className: "w-full" })}>
          Sign in
        </a>
        <a href={signUpUrl} className={buttonVariants({ variant: "outline", className: "w-full" })}>
          Create account
        </a>
      </section>
    </PageShell>
  );
}
